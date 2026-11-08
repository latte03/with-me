package server

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"net/http"
	"os"
	"strings"
)

func validHash(h string) bool {
	if len(h) != 64 {
		return false
	}
	_, err := hex.DecodeString(h)
	return err == nil
}

func (s *Server) handleBlobUpload(w http.ResponseWriter, r *http.Request) {
	a := authFrom(r)
	r.Body = http.MaxBytesReader(w, r.Body, maxAttachment+(1<<20))
	if err := r.ParseMultipartForm(8 << 20); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid multipart body or too large")
		return
	}
	defer r.MultipartForm.RemoveAll()
	hash := strings.ToLower(r.FormValue("hash"))
	if !validHash(hash) {
		writeErr(w, http.StatusBadRequest, "hash must be sha256 hex")
		return
	}
	f, fh, err := r.FormFile("file")
	if err != nil {
		writeErr(w, http.StatusBadRequest, "file required")
		return
	}
	defer f.Close()
	data, err := io.ReadAll(io.LimitReader(f, maxAttachment+1))
	if err != nil {
		writeErr(w, http.StatusBadRequest, "read failed")
		return
	}
	if len(data) > maxAttachment {
		writeErr(w, http.StatusRequestEntityTooLarge, "attachment exceeds 20MB")
		return
	}
	sum := sha256.Sum256(data)
	if hex.EncodeToString(sum[:]) != hash {
		writeErr(w, http.StatusBadRequest, "hash mismatch")
		return
	}
	saved, err := s.saveAttachment(a.userID, data, fh.Filename, "")
	if errors.Is(err, errQuota) {
		writeErr(w, http.StatusInsufficientStorage, "quota exceeded")
		return
	}
	if err != nil {
		writeErr(w, http.StatusInternalServerError, "save attachment failed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"hash": saved.Hash, "size": saved.Size, "mime": saved.Mime, "kind": saved.Kind, "thumb_hash": saved.ThumbHash,
	})
}

func (s *Server) handleBlobGet(w http.ResponseWriter, r *http.Request) {
	a := authFrom(r)
	hash := strings.ToLower(r.PathValue("hash"))
	var mimeT, thumbHash, blobPath string
	err := s.db.QueryRow(`SELECT mime, thumb_hash, blob_path FROM attachments WHERE user_id = ? AND hash = ?`,
		a.userID, hash).Scan(&mimeT, &thumbHash, &blobPath)
	if err != nil {
		writeErr(w, http.StatusNotFound, "blob not found")
		return
	}
	if r.URL.Query().Get("variant") == "thumb" && thumbHash != "" {
		blobPath += ".thumb"
		mimeT = "image/jpeg"
	}
	f, err := os.Open(blobPath)
	if err != nil {
		writeErr(w, http.StatusNotFound, "blob missing on disk")
		return
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil {
		writeErr(w, http.StatusNotFound, "blob missing on disk")
		return
	}
	w.Header().Set("Content-Type", mimeT)
	w.Header().Set("Cache-Control", "private, max-age=31536000, immutable")
	// ServeContent adds Accept-Ranges / Content-Range; needed for in-app video seeking.
	http.ServeContent(w, r, hash, st.ModTime(), f)
}
