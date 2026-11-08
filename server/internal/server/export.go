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
	rows, err := s.db.Query(`SELECT id, name, avatar, color, kind, pinned, hidden, created_at, updated_at
		FROM roles WHERE user_id = ? AND deleted = 0 ORDER BY pinned DESC, created_at`, userID)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var id, name, avatar, color, kind, createdAt, updatedAt string
		var pinned, hidden bool
		if err := rows.Scan(&id, &name, &avatar, &color, &kind, &pinned, &hidden, &createdAt, &updatedAt); err != nil {
			rows.Close()
			return nil, err
		}
		d.Roles = append(d.Roles, map[string]any{
			"id": id, "name": name, "avatar": avatar, "color": color, "kind": kind,
			"pinned": pinned, "hidden": hidden, "created_at": createdAt, "updated_at": updatedAt,
		})
	}
	rows.Close()
	rows, err = s.db.Query(`SELECT id, role_id, type, text, todo_done, attachment_ref, meta, side, created_at, updated_at
		FROM messages WHERE user_id = ? AND deleted = 0 ORDER BY created_at`, userID)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var id, roleID, typ, text, ref, meta, side, createdAt, updatedAt string
		var done bool
		if err := rows.Scan(&id, &roleID, &typ, &text, &done, &ref, &meta, &side, &createdAt, &updatedAt); err != nil {
			rows.Close()
			return nil, err
		}
		m := map[string]any{
			"id": id, "role_id": roleID, "type": typ, "text": text, "todo_done": done,
			"attachment_ref": ref, "side": side, "created_at": createdAt, "updated_at": updatedAt,
		}
		if meta != "" && json.Valid([]byte(meta)) {
			m["meta"] = json.RawMessage(meta)
		}
		d.Messages = append(d.Messages, m)
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
			case "clip":
				renderClipMarkdown(&b, clock, m["meta"])
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

func renderClipMarkdown(b *strings.Builder, clock string, raw any) {
	var meta struct {
		Platform    string   `json:"platform"`
		Title       string   `json:"title"`
		Body        string   `json:"body"`
		SourceURL   string   `json:"source_url"`
		PublishedAt string   `json:"published_at"`
		Tags        []string `json:"tags"`
		Author      struct {
			Name string `json:"name"`
		} `json:"author"`
		Media []struct {
			Kind      string `json:"kind"`
			Hash      string `json:"hash"`
			LiveHash  string `json:"live_hash"`
			CoverHash string `json:"cover_hash"`
		} `json:"media"`
	}
	switch v := raw.(type) {
	case json.RawMessage:
		_ = json.Unmarshal(v, &meta)
	case string:
		_ = json.Unmarshal([]byte(v), &meta)
	}
	label := "小红书"
	if meta.Platform != "" && meta.Platform != "xhs" {
		label = meta.Platform
	}
	fmt.Fprintf(b, "- %s **【%s】%s**\n", clock, label, meta.Title)
	if meta.Author.Name != "" {
		fmt.Fprintf(b, "  - 作者：%s", meta.Author.Name)
		if meta.PublishedAt != "" {
			fmt.Fprintf(b, " · 发布：%s", meta.PublishedAt)
		}
		b.WriteString("\n")
	}
	if meta.Body != "" {
		for _, line := range strings.Split(meta.Body, "\n") {
			fmt.Fprintf(b, "  > %s\n", line)
		}
	}
	if len(meta.Tags) > 0 {
		fmt.Fprintf(b, "  - 话题：%s\n", strings.Join(meta.Tags, " "))
	}
	if meta.SourceURL != "" {
		fmt.Fprintf(b, "  - 原文：%s\n", meta.SourceURL)
	}
	for _, media := range meta.Media {
		switch media.Kind {
		case "video":
			if media.CoverHash != "" {
				fmt.Fprintf(b, "  - ![封面](blobs/%s)\n", media.CoverHash)
			}
			if media.Hash != "" {
				fmt.Fprintf(b, "  - [视频](blobs/%s)\n", media.Hash)
			}
		default:
			if media.Hash != "" {
				fmt.Fprintf(b, "  - ![图片](blobs/%s)\n", media.Hash)
			}
			if media.LiveHash != "" {
				fmt.Fprintf(b, "  - [实况](blobs/%s)\n", media.LiveHash)
			}
		}
	}
}
