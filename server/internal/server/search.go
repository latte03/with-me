package server

import (
	"database/sql"
	"net/http"
	"strings"
)

func (s *Server) handleSearch(w http.ResponseWriter, r *http.Request) {
	a := authFrom(r)
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	if q == "" {
		writeErr(w, http.StatusBadRequest, "q required")
		return
	}
	// trigram needs >=3 chars; shorter queries fall back to LIKE
	useFTS := s.fts && len([]rune(q)) >= 3
	var rows *sql.Rows
	var err error
	if useFTS {
		match := `"` + strings.ReplaceAll(q, `"`, `""`) + `"`
		rows, err = s.db.Query(`
			SELECT m.id, m.role_id, COALESCE(ro.name, ''), m.text, m.created_at,
			       snippet(messages_fts, 0, '', '', '…', 12)
			FROM messages_fts
			JOIN messages m ON m.rowid = messages_fts.rowid
			LEFT JOIN roles ro ON ro.user_id = m.user_id AND ro.id = m.role_id
			WHERE messages_fts MATCH ? AND m.user_id = ? AND m.deleted = 0
			ORDER BY m.created_at DESC LIMIT 50`, match, a.userID)
	} else {
		like := "%" + escapeLike(q) + "%"
		rows, err = s.db.Query(`
			SELECT m.id, m.role_id, COALESCE(ro.name, ''), m.text, m.created_at, ''
			FROM messages m
			LEFT JOIN roles ro ON ro.user_id = m.user_id AND ro.id = m.role_id
			WHERE m.user_id = ? AND m.deleted = 0 AND m.text LIKE ? ESCAPE '\'
			ORDER BY m.created_at DESC LIMIT 50`, a.userID, like)
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "search failed")
		return
	}
	defer rows.Close()
	results := []map[string]any{}
	for rows.Next() {
		var id, roleID, roleName, text, createdAt, snippet string
		if err := rows.Scan(&id, &roleID, &roleName, &text, &createdAt, &snippet); err != nil {
			writeErr(w, http.StatusInternalServerError, "scan failed")
			return
		}
		if snippet == "" {
			snippet = likeSnippet(text, q)
		}
		results = append(results, map[string]any{
			"message_id": id, "role_id": roleID, "role_name": roleName,
			"text": text, "created_at": createdAt, "snippet": snippet,
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"results": results})
}

func escapeLike(q string) string {
	q = strings.ReplaceAll(q, `\`, `\\`)
	q = strings.ReplaceAll(q, `%`, `\%`)
	q = strings.ReplaceAll(q, `_`, `\_`)
	return q
}

func likeSnippet(text, q string) string {
	runes := []rune(text)
	idx := strings.Index(strings.ToLower(text), strings.ToLower(q))
	if idx < 0 {
		if len(runes) > 60 {
			return string(runes[:60]) + "…"
		}
		return text
	}
	start := len([]rune(text[:idx]))
	lo := max(0, start-15)
	hi := min(len(runes), start+len([]rune(q))+35)
	out := string(runes[lo:hi])
	if lo > 0 {
		out = "…" + out
	}
	if hi < len(runes) {
		out += "…"
	}
	return out
}