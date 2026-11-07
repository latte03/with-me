package server

import (
	"archive/zip"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"
)

type exportAttachment struct {
	Hash     string `json:"hash"`
	Size     int64  `json:"size"`
	Mime     string `json:"mime"`
	blobPath string
}

type exportData struct {
	User        userView           `json:"user"`
	Roles       []map[string]any   `json:"roles"`
	Messages    []map[string]any   `json:"messages"`
	Attachments []exportAttachment `json:"attachments"`
}

func (s *Server) collectExport(userID string) (*exportData, error) {
	d := &exportData{Roles: []map[string]any{}, Messages: []map[string]any{}, Attachments: []exportAttachment{}}
	s.db.QueryRow(`SELECT id, username, is_admin FROM users WHERE id = ?`, userID).
		Scan(&d.User.ID, &d.User.Username, &d.User.IsAdmin)
	rows, err := s.db.Query(`SELECT id, name, avatar, color, pinned, hidden, created_at, updated_at
		FROM roles WHERE user_id = ? AND deleted = 0 ORDER BY pinned DESC, created_at`, userID)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var id, name, avatar, color, createdAt, updatedAt string
		var pinned, hidden bool
		if err := rows.Scan(&id, &name, &avatar, &color, &pinned, &hidden, &createdAt, &updatedAt); err != nil {
			rows.Close()
			return nil, err
		}
		d.Roles = append(d.Roles, map[string]any{
			"id": id, "name": name, "avatar": avatar, "color": color,
			"pinned": pinned, "hidden": hidden, "created_at": createdAt, "updated_at": updatedAt,
		})
	}
	rows.Close()
	rows, err = s.db.Query(`SELECT id, role_id, type, text, todo_done, attachment_ref, side, created_at, updated_at
		FROM messages WHERE user_id = ? AND deleted = 0 ORDER BY created_at`, userID)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var id, roleID, typ, text, ref, side, createdAt, updatedAt string
		var done bool
		if err := rows.Scan(&id, &roleID, &typ, &text, &done, &ref, &side, &createdAt, &updatedAt); err != nil {
			rows.Close()
			return nil, err
		}
		d.Messages = append(d.Messages, map[string]any{
			"id": id, "role_id": roleID, "type": typ, "text": text, "todo_done": done,
			"attachment_ref": ref, "side": side, "created_at": createdAt, "updated_at": updatedAt,
		})
	}
	rows.Close()
	rows, err = s.db.Query(`SELECT hash, size, mime, blob_path FROM attachments WHERE user_id = ? ORDER BY created_at`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var a exportAttachment
		if err := rows.Scan(&a.Hash, &a.Size, &a.Mime, &a.blobPath); err != nil {
			return nil, err
		}
		d.Attachments = append(d.Attachments, a)
	}
	return d, nil
}

func (s *Server) handleExport(w http.ResponseWriter, r *http.Request) {
	a := authFrom(r)
	format := r.URL.Query().Get("format")
	if format == "" {
		format = "json"
	}
	if format != "json" && format != "md" && format != "zip" {
		writeErr(w, http.StatusBadRequest, "format must be json, md or zip")
		return
	}
	d, err := s.collectExport(a.userID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "export failed")
		return
	}
	switch format {
	case "json":
		w.Header().Set("Content-Disposition", `attachment; filename="withme-export.json"`)
		writeJSON(w, http.StatusOK, d)
	case "md":
		w.Header().Set("Content-Type", "text/markdown; charset=utf-8")
		w.Header().Set("Content-Disposition", `attachment; filename="withme-export.md"`)
		io.WriteString(w, renderMarkdown(d))
	case "zip":
		w.Header().Set("Content-Type", "application/zip")
		w.Header().Set("Content-Disposition", `attachment; filename="withme-export.zip"`)
		zw := zip.NewWriter(w)
		defer zw.Close()
		jf, _ := zw.Create("data.json")
		json.NewEncoder(jf).Encode(d)
		mf, _ := zw.Create("data.md")
		io.WriteString(mf, renderMarkdown(d))
		for _, att := range d.Attachments {
			src, err := os.Open(att.blobPath)
			if err != nil {
				continue
			}
			dst, err := zw.Create("blobs/" + att.Hash)
			if err == nil {
				io.Copy(dst, src)
			}
			src.Close()
		}
	}
}

func renderMarkdown(d *exportData) string {
	var b strings.Builder
	fmt.Fprintf(&b, "# with-me 导出 — %s\n\n", d.User.Username)
	roleNames := map[string]string{}
	for _, ro := range d.Roles {
		roleNames[ro["id"].(string)] = ro["name"].(string)
	}
	byRole := map[string][]map[string]any{}
	var roleOrder []string
	for _, m := range d.Messages {
		rid := m["role_id"].(string)
		if _, ok := byRole[rid]; !ok {
			roleOrder = append(roleOrder, rid)
		}
		byRole[rid] = append(byRole[rid], m)
	}
	for _, ro := range d.Roles {
		rid := ro["id"].(string)
		if _, ok := byRole[rid]; !ok {
			roleOrder = append(roleOrder, rid)
		}
	}
	for _, rid := range roleOrder {
		name := roleNames[rid]
		if name == "" {
			name = "(未命名角色)"
		}
		fmt.Fprintf(&b, "## %s\n\n", name)
		lastDate := ""
		for _, m := range byRole[rid] {
			date, clock := splitTime(m["created_at"].(string))
			if date != lastDate {
				fmt.Fprintf(&b, "### %s\n\n", date)
				lastDate = date
			}
			switch m["type"] {
			case "todo":
				box := " "
				if m["todo_done"].(bool) {
					box = "x"
				}
				fmt.Fprintf(&b, "- [%s] %s %s\n", box, clock, m["text"])
			case "image":
				fmt.Fprintf(&b, "- %s ![image](blobs/%s)", clock, m["attachment_ref"])
				if t := m["text"].(string); t != "" {
					fmt.Fprintf(&b, " %s", t)
				}
				b.WriteString("\n")
			default:
				fmt.Fprintf(&b, "- %s %s\n", clock, m["text"])
			}
		}
		b.WriteString("\n")
	}
	return b.String()
}

func splitTime(ts string) (date, clock string) {
	if t, err := time.Parse(time.RFC3339, ts); err == nil {
		return t.Format("2006-01-02"), t.Format("15:04")
	}
	return ts, ""
}