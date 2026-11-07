package server

import (
	"bytes"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"fmt"
	"io"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/disintegration/imaging"
)

const maxAttachment = 20 << 20

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
	var size int64
	var mimeT, kind, thumbHash, blobPath string
	err = s.db.QueryRow(`SELECT size, mime, kind, thumb_hash, blob_path FROM attachments WHERE user_id = ? AND hash = ?`,
		a.userID, hash).Scan(&size, &mimeT, &kind, &thumbHash, &blobPath)
	if err == nil {
		writeJSON(w, http.StatusOK, map[string]any{"hash": hash, "size": size, "mime": mimeT, "kind": kind, "thumb_hash": thumbHash})
		return
	}
	if err != sql.ErrNoRows {
		writeErr(w, http.StatusInternalServerError, "query failed")
		return
	}
	var quota, used int64
	s.db.QueryRow(`SELECT quota_bytes FROM users WHERE id = ?`, a.userID).Scan(&quota)
	s.db.QueryRow(`SELECT COALESCE(SUM(size), 0) FROM attachments WHERE user_id = ?`, a.userID).Scan(&used)
	if used+int64(len(data)) > quota {
		writeErr(w, http.StatusInsufficientStorage, "quota exceeded")
		return
	}
	mimeT = http.DetectContentType(data)
	if base, _, _ := strings.Cut(mimeT, ";"); base == "application/octet-stream" {
		if ext := filepath.Ext(fh.Filename); ext != "" {
			if byExt := mime.TypeByExtension(ext); byExt != "" {
				mimeT = byExt
			}
		}
	}
	kind = "file"
	switch {
	case strings.HasPrefix(mimeT, "image/"):
		kind = "image"
	case strings.HasPrefix(mimeT, "audio/"):
		kind = "audio"
	}
	dir := filepath.Join(s.dataDir, "blobs", a.userID)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		writeErr(w, http.StatusInternalServerError, "mkdir failed")
		return
	}
	blobPath = filepath.Join(dir, hash)
	if err := os.WriteFile(blobPath, data, 0o644); err != nil {
		writeErr(w, http.StatusInternalServerError, "write failed")
		return
	}
	if kind == "image" {
		if img, err := imaging.Decode(bytes.NewReader(data)); err == nil {
			thumb := imaging.Fit(img, 512, 512, imaging.Lanczos)
			var buf bytes.Buffer
			if err := imaging.Encode(&buf, thumb, imaging.JPEG, imaging.JPEGQuality(85)); err == nil {
				tsum := sha256.Sum256(buf.Bytes())
				thumbHash = hex.EncodeToString(tsum[:])
				if err := os.WriteFile(blobPath+".thumb", buf.Bytes(), 0o644); err != nil {
					thumbHash = ""
				}
			}
		}
	}
	if _, err := s.db.Exec(`INSERT INTO attachments(user_id, hash, size, mime, kind, thumb_hash, blob_path, created_at)
		VALUES(?,?,?,?,?,?,?,?)`, a.userID, hash, len(data), mimeT, kind, thumbHash, blobPath, nowUTC()); err != nil {
		writeErr(w, http.StatusInternalServerError, "save meta failed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"hash": hash, "size": len(data), "mime": mimeT, "kind": kind, "thumb_hash": thumbHash,
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
	st, _ := f.Stat()
	w.Header().Set("Content-Type", mimeT)
	w.Header().Set("Content-Length", fmt.Sprint(st.Size()))
	w.Header().Set("Cache-Control", "private, max-age=31536000, immutable")
	io.Copy(w, f)
}