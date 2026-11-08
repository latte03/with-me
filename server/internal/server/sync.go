package server

import (
	"bytes"
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
			Kind      string `json:"kind"`
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
		if p.Kind != "" && p.Kind != "clips" {
			return fmt.Errorf("invalid role kind %q", p.Kind)
		}
		_, err := tx.Exec(`INSERT INTO roles(user_id, id, name, avatar, color, kind, pinned, hidden, deleted, created_at, updated_at, version)
			VALUES(?,?,?,?,?,?,?,?,0,?,?,?)
			ON CONFLICT(user_id, id) DO UPDATE SET name=excluded.name, avatar=excluded.avatar, color=excluded.color,
			kind=excluded.kind, pinned=excluded.pinned, hidden=excluded.hidden, deleted=0, updated_at=excluded.updated_at, version=excluded.version`,
			userID, p.ID, p.Name, p.Avatar, p.Color, p.Kind, p.Pinned, p.Hidden, p.CreatedAt, p.UpdatedAt, cursor)
		return err
	case "message.create":
		var p struct {
			ID            string          `json:"id"`
			RoleID        string          `json:"role_id"`
			Type          string          `json:"type"`
			Text          string          `json:"text"`
			AttachmentRef string          `json:"attachment_ref"`
			Meta          json.RawMessage `json:"meta"`
			Side          string          `json:"side"`
			TodoDone      bool            `json:"todo_done"`
			CreatedAt     string          `json:"created_at"`
			UpdatedAt     string          `json:"updated_at"`
		}
		if err := json.Unmarshal(payload, &p); err != nil {
			return err
		}
		if p.ID == "" || p.RoleID == "" {
			return fmt.Errorf("message.create requires id and role_id")
		}
		if p.Type != "text" && p.Type != "image" && p.Type != "todo" && p.Type != "clip" {
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
		metaJSON, platform, noteID := "", "", ""
		if p.Type == "clip" {
			m, err := validateClipMeta(tx, userID, p.Meta)
			if err != nil {
				return err
			}
			metaJSON = string(m)
			platform = clipMetaString(p.Meta, "platform")
			noteID = clipMetaString(p.Meta, "note_id")
		} else if len(p.Meta) > 0 && string(p.Meta) != "null" {
			return fmt.Errorf("meta is only allowed for clip messages")
		}
		_, err := tx.Exec(`INSERT INTO messages(user_id, id, role_id, type, text, todo_done, attachment_ref, meta, side, deleted, created_at, updated_at, version)
			VALUES(?,?,?,?,?,?,?,?,?,0,?,?,?)
			ON CONFLICT(user_id, id) DO UPDATE SET role_id=excluded.role_id, type=excluded.type, text=excluded.text,
			todo_done=excluded.todo_done, attachment_ref=excluded.attachment_ref, meta=excluded.meta, side=excluded.side, deleted=0,
			updated_at=excluded.updated_at, version=excluded.version`,
			userID, p.ID, p.RoleID, p.Type, p.Text, p.TodoDone, p.AttachmentRef, metaJSON, p.Side, p.CreatedAt, p.UpdatedAt, cursor)
		if err != nil {
			return err
		}
		if platform != "" && noteID != "" {
			return upsertClip(tx, userID, platform, noteID, p.ID, p.UpdatedAt)
		}
		return nil
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
			f, err := extractFields(p.Fields, map[string]string{"name": "string", "avatar": "string", "color": "string", "kind": "string", "pinned": "bool", "hidden": "bool"})
			if err != nil {
				return err
			}
			if k, ok := f["kind"].(string); ok && k != "" && k != "clips" {
				return fmt.Errorf("invalid role kind %q", k)
			}
			fields = f
		case "message.update":
			f, err := extractFields(p.Fields, map[string]string{"text": "string", "todo_done": "bool"})
			if err != nil {
				return err
			}
			fields = f
			if raw, ok := p.Fields["meta"]; ok {
				var msgType string
				if err := tx.QueryRow(`SELECT type FROM messages WHERE user_id = ? AND id = ? AND deleted = 0`, userID, p.ID).Scan(&msgType); err != nil {
					return fmt.Errorf("message not found")
				}
				if msgType != "clip" {
					return fmt.Errorf("meta is only allowed for clip messages")
				}
				m, err := validateClipMeta(tx, userID, raw)
				if err != nil {
					return err
				}
				fields["meta"] = string(m)
			}
		case "role.delete", "message.delete":
			fields["deleted"] = true
		case "todo.set_done":
			if p.Done == nil {
				return fmt.Errorf("todo.set_done requires done")
			}
			fields["todo_done"] = *p.Done
		}
		if err := mergeProjection(tx, table, userID, p.ID, fields, p.UpdatedAt, cursor); err != nil {
			return err
		}
		if typ == "message.delete" {
			// Only remove the dedup mapping if it still belongs to this message.
			tx.Exec(`DELETE FROM clips WHERE user_id = ? AND message_id = ?`, userID, p.ID)
		}
		if typ == "message.update" {
			if raw, ok := p.Fields["meta"]; ok {
				platform := clipMetaString(raw, "platform")
				noteID := clipMetaString(raw, "note_id")
				if platform != "" && noteID != "" {
					return upsertClip(tx, userID, platform, noteID, p.ID, p.UpdatedAt)
				}
			}
		}
		return nil
	default:
		return fmt.Errorf("unknown op type %q", typ)
	}
}

const maxClipMeta = 64 << 10

// validateClipMeta checks the minimum shape and that referenced blobs belong to the user.
func validateClipMeta(tx *sql.Tx, userID string, raw json.RawMessage) (json.RawMessage, error) {
	if len(raw) == 0 || len(raw) > maxClipMeta {
		return nil, fmt.Errorf("clip meta required (max %d bytes)", maxClipMeta)
	}
	var m struct {
		Platform string `json:"platform"`
		NoteID   string `json:"note_id"`
		Media    []struct {
			Hash      string `json:"hash"`
			LiveHash  string `json:"live_hash"`
			CoverHash string `json:"cover_hash"`
		} `json:"media"`
	}
	if err := json.Unmarshal(raw, &m); err != nil {
		return nil, fmt.Errorf("invalid clip meta: %w", err)
	}
	if m.Platform == "" || m.NoteID == "" {
		return nil, fmt.Errorf("clip meta requires platform and note_id")
	}
	for _, media := range m.Media {
		for _, h := range []string{media.Hash, media.LiveHash, media.CoverHash} {
			if h == "" {
				continue
			}
			if !validHash(h) {
				return nil, fmt.Errorf("clip meta has invalid blob hash")
			}
			var one int
			if err := tx.QueryRow(`SELECT 1 FROM attachments WHERE user_id = ? AND hash = ?`, userID, h).Scan(&one); err != nil {
				return nil, fmt.Errorf("clip meta references an unknown attachment")
			}
		}
	}
	var buf bytes.Buffer
	if err := json.Compact(&buf, raw); err != nil {
		return nil, fmt.Errorf("invalid clip meta: %w", err)
	}
	return buf.Bytes(), nil
}

func clipMetaString(raw json.RawMessage, key string) string {
	var m map[string]any
	if json.Unmarshal(raw, &m) != nil {
		return ""
	}
	v, _ := m[key].(string)
	return v
}

func upsertClip(tx *sql.Tx, userID, platform, noteID, messageID, updatedAt string) error {
	if updatedAt == "" {
		updatedAt = nowUTC()
	}
	_, err := tx.Exec(`INSERT INTO clips(user_id, platform, note_id, message_id, updated_at)
		VALUES(?,?,?,?,?)
		ON CONFLICT(user_id, platform, note_id)
		DO UPDATE SET message_id=excluded.message_id, updated_at=excluded.updated_at`,
		userID, platform, noteID, messageID, updatedAt)
	return err
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
		all["name"], all["avatar"], all["color"], all["kind"], all["pinned"], all["hidden"] = "", "", "", "", false, false
	} else {
		all["role_id"], all["type"], all["text"], all["todo_done"], all["attachment_ref"], all["meta"], all["side"] = "", "text", "", false, "", "", "right"
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
