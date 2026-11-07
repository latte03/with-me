package server

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

func (s *Server) handleStatic(w http.ResponseWriter, r *http.Request) {
	if strings.HasPrefix(r.URL.Path, "/api/") {
		writeErr(w, http.StatusNotFound, "not found")
		return
	}
	if s.webDir == "" {
		http.NotFound(w, r)
		return
	}
	index := filepath.Join(s.webDir, "index.html")
	if _, err := os.Stat(index); err != nil {
		http.Error(w, "web UI not built yet", http.StatusNotFound)
		return
	}
	clean := filepath.Clean("/" + r.URL.Path)
	fpath := filepath.Join(s.webDir, clean)
	if st, err := os.Stat(fpath); err == nil && !st.IsDir() {
		http.ServeFile(w, r, fpath)
		return
	}
	http.ServeFile(w, r, index)
}