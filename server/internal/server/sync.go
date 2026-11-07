package server

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"strings"
)

type opEnvelope struct {
	OpID            string          `json:"op_id"`
	DeviceID        string          `json:"device_id"`
	Seq             int64           `json:"seq"`
	Type            string          `json:"type"`
	Payload         json.RawMessage `json:"payload"`
	ClientCreatedAt string          `json:"client_created_at"`
}

func (s *Server) handlePush(w http.ResponseWriter, r *http.Request) {
	a := authFrom(r)
	var req struct {
		Ops []opEnvelope `json:"ops"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	tx, err := s.db.Begin()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "tx failed")
		return
	}
	defer tx.Rollback()
	applied := []map[string]any{}
	for _, op := range req.Ops {
		if op.OpID == "" {
			writeErr(w, http.StatusBadRequest, "op_id required")
			return
		}
		var existing int64
		err := tx.QueryRow(`SELECT cursor FROM ops WHERE op_id = ?`, op.OpID).Scan(&existing)
		if err == nil {
			applied = append(applied, map[string]any{"op_id": op.OpID, "cursor": existing})
			continue
		}
		if err != sql.ErrNoRows {
			writeErr(w, http.StatusInternalServerError, "dedup failed")
			return
		}
		var owner string
		var revoked bool
		err = tx.QueryRow(`SELECT user_id, revoked FROM devices WHERE id = ?`, op.DeviceID).Scan(&owner, &revoked)
		if err != nil || owner != a.userID || revoked {
			writeErr(w, http.StatusBadRequest, fmt.Sprintf("op %s: device_id not owned or revoked", op.OpID))
			return
		}
		if len(op.Payload) == 0 {
			writeErr(w, http.StatusBadRequest, fmt.Sprintf("op %s: payload required", op.OpID))
			return
		}
		res, err := tx.Exec(`INSERT INTO ops(op_id, user_id, device_id, seq, type, payload, client_created_at, accepted_at)
			VALUES(?,?,?,?,?,?,?,?)`,
			op.OpID, a.userID, op.DeviceID, op.Seq, op.Type, string(op.Payload), op.ClientCreatedAt, nowUTC())
		if err != nil {
			writeErr(w, http.StatusInternalServerError, "insert op failed")
			return
		}
		cursor, _ := res.LastInsertId()
		if err := applyOp(tx, a.userID, cursor, op.Type, op.Payload); err != nil {
			writeErr(w, http.StatusBadRequest, fmt.Sprintf("op %s: %v", op.OpID, err))
			return
		}
		tx.Exec(`UPDATE devices SET last_seq = MAX(last_seq, ?) WHERE id = ?`, op.Seq, op.DeviceID)
		applied = append(applied, map[string]any{"op_id": op.OpID, "cursor": cursor})
	}
	if err := tx.Commit(); err != nil {
		writeErr(w, http.StatusInternalServerError, "commit failed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"server_cursor": s.serverCursor(), "applied": applied})
}

func (s *Server) serverCursor() int64 {
	var c int64
	s.db.QueryRow(`SELECT COALESCE(MAX(cursor), 0) FROM ops`).Scan(&c)
	return c
}

func (s *Server) handlePull(w http.ResponseWriter, r *http.Request) {
	a := authFrom(r)
	cursor, _ := strconv.ParseInt(r.URL.Query().Get("cursor"), 10, 64)
	limit := 500
	if v, err := strconv.Atoi(r.URL.Query().Get("limit")); err == nil && v > 0 {
		limit = min(v, 5000)
	}
	rows, err := s.db.Query(`SELECT cursor, op_id, device_id, seq, type, payload, client_created_at, accepted_at
		FROM ops WHERE user_id = ? AND cursor > ? ORDER BY cursor LIMIT ?`, a.userID, cursor, limit+1)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "query failed")
		return
	}
	defer rows.Close()
	ops := []map[string]any{}
	for rows.Next() {
		var c, seq int64
		var opID, deviceID, typ, payload, cca, accepted string
		if err := rows.Scan(&c, &opID, &deviceID, &seq, &typ, &payload, &cca, &accepted); err != nil {
			writeErr(w, http.StatusInternalServerError, "scan failed")
			return
		}
		ops = append(ops, map[string]any{
			"cursor": c, "op_id": opID, "device_id": deviceID, "seq": seq, "type": typ,
			"payload": json.RawMessage(payload), "client_created_at": cca, "accepted_at": accepted,
		})
	}
	hasMore := len(ops) > limit
	if hasMore {
		ops = ops[:limit]
	}
	writeJSON(w, http.StatusOK, map[string]any{"ops": ops, "server_cursor": s.serverCursor(), "has_more": hasMore})
}

func applyOp(tx *sql.Tx, userID string, cursor int64, typ string, payload json.RawMessage) error {
	switch typ {
	case "role.create":
		var p struct {
			ID        string `json:"id"`
			Name      string `json:"name"`
			Avatar    string `json:"avatar"`
			Color     string `json:"color"`
			Pinned    bool   `json:"pinned"`
			Hidden    bool   `json:"hidden"`
			CreatedAt string `json:"created_at"`
			UpdatedAt string `json:"updated_at"`
		}
		if err := json.Unmarshal(payload, &p); err != nil {
			return err
		}
		if p.ID == "" || p.Name == "" {
			return fmt.Errorf("role.create requires id and name")
		}
		_, err := tx.Exec(`INSERT INTO roles(user_id, id, name, avatar, color, pinned, hidden, deleted, created_at, updated_at, version)
			VALUES(?,?,?,?,?,?,?,0,?,?,?)
			ON CONFLICT(user_id, id) DO UPDATE SET name=excluded.name, avatar=excluded.avatar, color=excluded.color,
			pinned=excluded.pinned, hidden=excluded.hidden, deleted=0, updated_at=excluded.updated_at, version=excluded.version`,
			userID, p.ID, p.Name, p.Avatar, p.Color, p.Pinned, p.Hidden, p.CreatedAt, p.UpdatedAt, cursor)
		return err
	case "message.create":
		var p struct {
			ID            string `json:"id"`
			RoleID        string `json:"role_id"`
			Type          string `json:"type"`
			Text          string `json:"text"`
			AttachmentRef string `json:"attachment_ref"`
			Side          string `json:"side"`
			TodoDone      bool   `json:"todo_done"`
			CreatedAt     string `json:"created_at"`
			UpdatedAt     string `json:"updated_at"`
		}
		if err := json.Unmarshal(payload, &p); err != nil {
			return err
		}
		if p.ID == "" || p.RoleID == "" {
			return fmt.Errorf("message.create requires id and role_id")
		}
		if p.Type != "text" && p.Type != "image" && p.Type != "todo" {
			return fmt.Errorf("invalid message type %q", p.Type)
		}
		if p.Side == "" {
			p.Side = "right"
		}
		if p.Side != "right" && p.Side != "left" {
			return fmt.Errorf("invalid side %q", p.Side)
		}
		if p.AttachmentRef != "" {
			var one int
			if err := tx.QueryRow(`SELECT 1 FROM attachments WHERE user_id = ? AND hash = ?`, userID, p.AttachmentRef).Scan(&one); err != nil {
				return fmt.Errorf("attachment_ref not owned by user")
			}
		}
		_, err := tx.Exec(`INSERT INTO messages(user_id, id, role_id, type, text, todo_done, attachment_ref, side, deleted, created_at, updated_at, version)
			VALUES(?,?,?,?,?,?,?,?,0,?,?,?)
			ON CONFLICT(user_id, id) DO UPDATE SET role_id=excluded.role_id, type=excluded.type, text=excluded.text,
			todo_done=excluded.todo_done, attachment_ref=excluded.attachment_ref, side=excluded.side, deleted=0,
			updated_at=excluded.updated_at, version=excluded.version`,
			userID, p.ID, p.RoleID, p.Type, p.Text, p.TodoDone, p.AttachmentRef, p.Side, p.CreatedAt, p.UpdatedAt, cursor)
		return err
	case "role.update", "message.update", "role.delete", "message.delete", "todo.set_done":
		table := "roles"
		if strings.HasPrefix(typ, "message.") || typ == "todo.set_done" {
			table = "messages"
		}
		var p struct {
			ID        string                     `json:"id"`
			UpdatedAt string                     `json:"updated_at"`
			Fields    map[string]json.RawMessage `json:"fields"`
			Done      *bool                      `json:"done"`
		}
		if err := json.Unmarshal(payload, &p); err != nil {
			return err
		}
		if p.ID == "" {
			return fmt.Errorf("%s requires id", typ)
		}
		fields := map[string]any{}
		switch typ {
		case "role.update":
			f, err := extractFields(p.Fields, map[string]string{"name": "string", "avatar": "string", "color": "string", "pinned": "bool", "hidden": "bool"})
			if err != nil {
				return err
			}
			fields = f
		case "message.update":
			f, err := extractFields(p.Fields, map[string]string{"text": "string", "todo_done": "bool"})
			if err != nil {
				return err
			}
			fields = f
		case "role.delete", "message.delete":
			fields["deleted"] = true
		case "todo.set_done":
			if p.Done == nil {
				return fmt.Errorf("todo.set_done requires done")
			}
			fields["todo_done"] = *p.Done
		}
		return mergeProjection(tx, table, userID, p.ID, fields, p.UpdatedAt, cursor)
	default:
		return fmt.Errorf("unknown op type %q", typ)
	}
}

func extractFields(raw map[string]json.RawMessage, spec map[string]string) (map[string]any, error) {
	out := map[string]any{}
	for key, kind := range spec {
		v, ok := raw[key]
		if !ok {
			continue
		}
		switch kind {
		case "string":
			var s string
			if err := json.Unmarshal(v, &s); err != nil {
				return nil, fmt.Errorf("field %s must be string", key)
			}
			out[key] = s
		case "bool":
			var b bool
			if err := json.Unmarshal(v, &b); err != nil {
				return nil, fmt.Errorf("field %s must be bool", key)
			}
			out[key] = b
		}
	}
	return out, nil
}

// LWW: ops apply in cursor order, so a plain overwrite is last-write-wins.
func mergeProjection(tx *sql.Tx, table, userID, id string, fields map[string]any, updatedAt string, cursor int64) error {
	cols := make([]string, 0, len(fields)+2)
	args := make([]any, 0, len(fields)+4)
	keys := make([]string, 0, len(fields))
	for k := range fields {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, k := range keys {
		cols = append(cols, k+" = ?")
		args = append(args, fields[k])
	}
	cols = append(cols, "updated_at = ?", "version = ?")
	args = append(args, updatedAt, cursor, userID, id)
	res, err := tx.Exec(fmt.Sprintf("UPDATE %s SET %s WHERE user_id = ? AND id = ?", table, strings.Join(cols, ", ")), args...)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n > 0 {
		return nil
	}
	// update arrived before create (cross-device ordering): insert a skeleton row
	all := map[string]any{"created_at": updatedAt, "updated_at": updatedAt, "version": cursor, "deleted": false}
	if table == "roles" {
		all["name"], all["avatar"], all["color"], all["pinned"], all["hidden"] = "", "", "", false, false
	} else {
		all["role_id"], all["type"], all["text"], all["todo_done"], all["attachment_ref"], all["side"] = "", "text", "", false, "", "right"
	}
	for k, v := range fields {
		all[k] = v
	}
	ks := make([]string, 0, len(all))
	for k := range all {
		ks = append(ks, k)
	}
	sort.Strings(ks)
	placeholders := make([]string, len(ks))
	vals := make([]any, 0, len(ks)+2)
	vals = append(vals, userID, id)
	for i, k := range ks {
		placeholders[i] = "?"
		vals = append(vals, all[k])
	}
	_, err = tx.Exec(fmt.Sprintf("INSERT INTO %s(user_id, id, %s) VALUES(?,?,%s)",
		table, strings.Join(ks, ", "), strings.Join(placeholders, ",")), vals...)
	return err
}