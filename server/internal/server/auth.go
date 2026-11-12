package server

import (
	"database/sql"
	"net/http"

	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"
)

type userView struct {
	ID       string `json:"id"`
	Username string `json:"username"`
	IsAdmin  bool   `json:"is_admin"`
}

func (s *Server) createSession(userID, deviceID, deviceName, fingerprint string) (string, error) {
	id, err := s.resolveDevice(userID, deviceID, deviceName, fingerprint)
	if err != nil {
		return "", err
	}
	token := newToken()
	_, err = s.db.Exec(`INSERT INTO sessions(token_hash, user_id, device_id, created_at) VALUES(?,?,?,?)`,
		hashToken(token), userID, id, nowUTC())
	if err != nil {
		return "", err
	}
	return token, nil
}

// resolveDevice 认设备：先用客户端持久 id，再用指纹。浏览器存储被清空、换入口域名、
// Safari 与主屏 PWA 互换都会让 id 变新，而指纹不变，同一台设备因此只占一行。
func (s *Server) resolveDevice(userID, deviceID, deviceName, fingerprint string) (string, error) {
	if deviceID != "" {
		var owner string
		err := s.db.QueryRow(`SELECT user_id FROM devices WHERE id = ?`, deviceID).Scan(&owner)
		switch {
		case err == nil:
			if owner != userID {
				return "", errDeviceForeign
			}
			return deviceID, s.touchDevice(deviceID, deviceName, fingerprint)
		case err == sql.ErrNoRows:
		default:
			return "", err
		}
	}
	if fingerprint != "" {
		id, err := s.deviceBy(`SELECT id FROM devices WHERE user_id = ? AND fingerprint = ? ORDER BY last_seen DESC LIMIT 1`,
			userID, fingerprint)
		if err != nil {
			return "", err
		}
		if id == "" && deviceName != "" {
			// 旧版本留下的行没有指纹，按名字认领一次，认领后补上指纹
			id, err = s.deviceBy(`SELECT id FROM devices WHERE user_id = ? AND name = ? AND fingerprint = '' ORDER BY last_seen DESC LIMIT 1`,
				userID, deviceName)
			if err != nil {
				return "", err
			}
		}
		if id != "" {
			return id, s.touchDevice(id, deviceName, fingerprint)
		}
	}
	if deviceID == "" {
		deviceID = uuid.NewString()
	}
	_, err := s.db.Exec(`INSERT INTO devices(id, user_id, name, fingerprint, last_seen) VALUES(?,?,?,?,?)`,
		deviceID, userID, deviceName, fingerprint, nowUTC())
	return deviceID, err
}

func (s *Server) deviceBy(query string, args ...any) (string, error) {
	var id string
	err := s.db.QueryRow(query, args...).Scan(&id)
	if err == sql.ErrNoRows {
		return "", nil
	}
	return id, err
}

func (s *Server) touchDevice(id, name, fingerprint string) error {
	_, err := s.db.Exec(`UPDATE devices SET name = ?, revoked = 0, last_seen = ?,
		fingerprint = COALESCE(NULLIF(?, ''), fingerprint) WHERE id = ?`, name, nowUTC(), fingerprint, id)
	return err
}

type errString string

func (e errString) Error() string { return string(e) }

const errDeviceForeign = errString("device belongs to another user")

func (s *Server) handleBootstrap(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Username          string `json:"username"`
		Password          string `json:"password"`
		DeviceID          string `json:"device_id"`
		DeviceName        string `json:"device_name"`
		DeviceFingerprint string `json:"device_fingerprint"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	if req.Username == "" || req.Password == "" {
		writeErr(w, http.StatusBadRequest, "username and password required")
		return
	}
	var n int
	s.db.QueryRow(`SELECT COUNT(*) FROM users`).Scan(&n)
	if n > 0 {
		writeErr(w, http.StatusConflict, "already initialized")
		return
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "hash failed")
		return
	}
	id := uuid.NewString()
	if _, err := s.db.Exec(`INSERT INTO users(id, username, password_hash, is_admin, created_at) VALUES(?,?,?,1,?)`,
		id, req.Username, string(hash), nowUTC()); err != nil {
		writeErr(w, http.StatusInternalServerError, "create user failed")
		return
	}
	token, err := s.createSession(id, req.DeviceID, req.DeviceName, req.DeviceFingerprint)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "create session failed")
		return
	}
	var deviceID string
	s.db.QueryRow(`SELECT device_id FROM sessions WHERE token_hash = ?`, hashToken(token)).Scan(&deviceID)
	writeJSON(w, http.StatusOK, map[string]any{
		"token":     token,
		"user":      userView{id, req.Username, true},
		"device_id": deviceID,
	})
}

func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Username          string `json:"username"`
		Password          string `json:"password"`
		DeviceID          string `json:"device_id"`
		DeviceName        string `json:"device_name"`
		DeviceFingerprint string `json:"device_fingerprint"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	var u userView
	var hash string
	var disabled bool
	err := s.db.QueryRow(`SELECT id, username, is_admin, password_hash, disabled FROM users WHERE username = ?`,
		req.Username).Scan(&u.ID, &u.Username, &u.IsAdmin, &hash, &disabled)
	if err != nil || bcrypt.CompareHashAndPassword([]byte(hash), []byte(req.Password)) != nil {
		writeErr(w, http.StatusUnauthorized, "invalid credentials")
		return
	}
	if disabled {
		writeErr(w, http.StatusUnauthorized, "user disabled")
		return
	}
	token, err := s.createSession(u.ID, req.DeviceID, req.DeviceName, req.DeviceFingerprint)
	if err != nil {
		if err == errDeviceForeign {
			writeErr(w, http.StatusBadRequest, err.Error())
			return
		}
		writeErr(w, http.StatusInternalServerError, "create session failed")
		return
	}
	var deviceID string
	s.db.QueryRow(`SELECT device_id FROM sessions WHERE token_hash = ?`, hashToken(token)).Scan(&deviceID)
	writeJSON(w, http.StatusOK, map[string]any{"token": token, "user": u, "device_id": deviceID})
}

func (s *Server) handlePassword(w http.ResponseWriter, r *http.Request) {
	a := authFrom(r)
	var req struct {
		Old string `json:"old"`
		New string `json:"new"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	if req.New == "" {
		writeErr(w, http.StatusBadRequest, "new password required")
		return
	}
	var hash string
	s.db.QueryRow(`SELECT password_hash FROM users WHERE id = ?`, a.userID).Scan(&hash)
	if bcrypt.CompareHashAndPassword([]byte(hash), []byte(req.Old)) != nil {
		writeErr(w, http.StatusUnauthorized, "wrong old password")
		return
	}
	newHash, err := bcrypt.GenerateFromPassword([]byte(req.New), bcrypt.DefaultCost)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "hash failed")
		return
	}
	s.db.Exec(`UPDATE users SET password_hash = ? WHERE id = ?`, string(newHash), a.userID)
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) handleMe(w http.ResponseWriter, r *http.Request) {
	a := authFrom(r)
	var u userView
	var quota, used int64
	s.db.QueryRow(`SELECT id, username, is_admin, quota_bytes FROM users WHERE id = ?`, a.userID).
		Scan(&u.ID, &u.Username, &u.IsAdmin, &quota)
	s.db.QueryRow(`SELECT COALESCE(SUM(size), 0) FROM attachments WHERE user_id = ?`, a.userID).Scan(&used)
	writeJSON(w, http.StatusOK, map[string]any{
		"user": u, "device_id": a.deviceID, "quota_bytes": quota, "used_bytes": used,
	})
}

func (s *Server) handleDevicesList(w http.ResponseWriter, r *http.Request) {
	a := authFrom(r)
	rows, err := s.db.Query(`SELECT id, name, fingerprint, last_seen, revoked FROM devices WHERE user_id = ? ORDER BY last_seen DESC`, a.userID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "query failed")
		return
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var id, name, fingerprint, lastSeen string
		var revoked bool
		rows.Scan(&id, &name, &fingerprint, &lastSeen, &revoked)
		out = append(out, map[string]any{
			"id": id, "name": name, "fingerprint": fingerprint, "last_seen": lastSeen, "revoked": revoked, "current": id == a.deviceID,
		})
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) handleDeviceRevoke(w http.ResponseWriter, r *http.Request) {
	a := authFrom(r)
	id := r.PathValue("id")
	res, err := s.db.Exec(`UPDATE devices SET revoked = 1 WHERE id = ? AND user_id = ?`, id, a.userID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "revoke failed")
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		writeErr(w, http.StatusNotFound, "device not found")
		return
	}
	s.db.Exec(`DELETE FROM sessions WHERE device_id = ?`, id)
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) handleUsersList(w http.ResponseWriter, r *http.Request) {
	rows, err := s.db.Query(`SELECT id, username, is_admin, disabled, created_at FROM users ORDER BY created_at`)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "query failed")
		return
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var id, username, createdAt string
		var isAdmin, disabled bool
		rows.Scan(&id, &username, &isAdmin, &disabled, &createdAt)
		out = append(out, map[string]any{
			"id": id, "username": username, "is_admin": isAdmin, "disabled": disabled, "created_at": createdAt,
		})
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) handleUserCreate(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	if req.Username == "" || req.Password == "" {
		writeErr(w, http.StatusBadRequest, "username and password required")
		return
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "hash failed")
		return
	}
	id := uuid.NewString()
	createdAt := nowUTC()
	if _, err := s.db.Exec(`INSERT INTO users(id, username, password_hash, created_at) VALUES(?,?,?,?)`,
		id, req.Username, string(hash), createdAt); err != nil {
		writeErr(w, http.StatusConflict, "username taken")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"id": id, "username": req.Username, "is_admin": false, "disabled": false, "created_at": createdAt,
	})
}

func (s *Server) handleUserReset(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var req struct {
		Password string `json:"password"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	if req.Password == "" {
		writeErr(w, http.StatusBadRequest, "password required")
		return
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "hash failed")
		return
	}
	res, _ := s.db.Exec(`UPDATE users SET password_hash = ? WHERE id = ?`, string(hash), id)
	if n, _ := res.RowsAffected(); n == 0 {
		writeErr(w, http.StatusNotFound, "user not found")
		return
	}
	s.db.Exec(`DELETE FROM sessions WHERE user_id = ?`, id)
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) handleUserDisable(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var req struct {
		Disabled *bool `json:"disabled"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	if req.Disabled == nil {
		writeErr(w, http.StatusBadRequest, "disabled required")
		return
	}
	res, _ := s.db.Exec(`UPDATE users SET disabled = ? WHERE id = ?`, *req.Disabled, id)
	if n, _ := res.RowsAffected(); n == 0 {
		writeErr(w, http.StatusNotFound, "user not found")
		return
	}
	if *req.Disabled {
		s.db.Exec(`DELETE FROM sessions WHERE user_id = ?`, id)
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}
