package server

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"strings"
	"time"
)

type Server struct {
	db      *sql.DB
	dataDir string
	webDir  string
	fts     bool
}

func New(db *sql.DB, dataDir, webDir string) *Server {
	s := &Server{db: db, dataDir: dataDir, webDir: webDir}
	if _, err := db.Exec(ftsSchema); err == nil {
		s.fts = true
	}
	return s
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("POST /api/auth/bootstrap", s.handleBootstrap)
	mux.HandleFunc("POST /api/auth/login", s.handleLogin)
	mux.Handle("POST /api/auth/password", s.auth(s.handlePassword))
	mux.Handle("GET /api/me", s.auth(s.handleMe))
	mux.Handle("GET /api/devices", s.auth(s.handleDevicesList))
	mux.Handle("DELETE /api/devices/{id}", s.auth(s.handleDeviceRevoke))
	mux.Handle("GET /api/users", s.auth(s.admin(s.handleUsersList)))
	mux.Handle("POST /api/users", s.auth(s.admin(s.handleUserCreate)))
	mux.Handle("POST /api/users/{id}/reset", s.auth(s.admin(s.handleUserReset)))
	mux.Handle("POST /api/users/{id}/disable", s.auth(s.admin(s.handleUserDisable)))
	mux.Handle("POST /api/sync/push", s.auth(s.handlePush))
	mux.Handle("GET /api/sync/pull", s.auth(s.handlePull))
	mux.Handle("POST /api/blobs", s.auth(s.handleBlobUpload))
	mux.Handle("GET /api/blobs/{hash}", s.auth(s.handleBlobGet))
	mux.Handle("GET /api/search", s.auth(s.handleSearch))
	mux.Handle("GET /api/export", s.auth(s.handleExport))
	mux.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) {
		writeErr(w, http.StatusNotFound, "not found")
	})
	mux.HandleFunc("/", s.handleStatic)
	return mux
}

type ctxKey struct{}

type authInfo struct {
	userID   string
	deviceID string
	isAdmin  bool
}

func authFrom(r *http.Request) authInfo {
	return r.Context().Value(ctxKey{}).(authInfo)
}

func hashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

func newToken() string {
	b := make([]byte, 32)
	rand.Read(b)
	return hex.EncodeToString(b)
}

func nowUTC() string {
	return time.Now().UTC().Format(time.RFC3339)
}

func (s *Server) auth(next http.HandlerFunc) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
		if !ok || token == "" {
			writeErr(w, http.StatusUnauthorized, "missing token")
			return
		}
		var a authInfo
		var disabled, revoked bool
		err := s.db.QueryRow(`
			SELECT u.id, u.is_admin, u.disabled, d.id, d.revoked
			FROM sessions se
			JOIN users u ON u.id = se.user_id
			JOIN devices d ON d.id = se.device_id
			WHERE se.token_hash = ?`, hashToken(token)).
			Scan(&a.userID, &a.isAdmin, &disabled, &a.deviceID, &revoked)
		if err != nil || disabled || revoked {
			writeErr(w, http.StatusUnauthorized, "invalid token")
			return
		}
		s.db.Exec(`UPDATE devices SET last_seen = ? WHERE id = ? AND last_seen < ?`,
			nowUTC(), a.deviceID, time.Now().UTC().Add(-time.Minute).Format(time.RFC3339))
		next(w, r.WithContext(context.WithValue(r.Context(), ctxKey{}, a)))
	})
}

func (s *Server) admin(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !authFrom(r).isAdmin {
			writeErr(w, http.StatusForbidden, "admin required")
			return
		}
		next(w, r)
	}
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, map[string]string{"error": msg})
}

func decodeJSON(w http.ResponseWriter, r *http.Request, v any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 32<<20)
	if err := json.NewDecoder(r.Body).Decode(v); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json body")
		return false
	}
	return true
}