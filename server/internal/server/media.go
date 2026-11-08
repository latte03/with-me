package server

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/disintegration/imaging"
)

const (
	maxAttachment      = 20 << 20
	maxClipImage       = 30 << 20
	maxClipLive        = 60 << 20
	maxClipVideo       = 200 << 20
	maxAttachmentTotal = 200 << 20
)

var (
	errQuota      = errors.New("quota exceeded")
	errMediaEmpty = errors.New("empty media")
)

type mediaFetcher func(context.Context, string, int64) ([]byte, string, error)

type savedAttachment struct {
	Hash      string
	Size      int64
	Mime      string
	Kind      string
	ThumbHash string
}

var mediaClient = &http.Client{
	Timeout: 90 * time.Second,
	CheckRedirect: func(req *http.Request, via []*http.Request) error {
		if len(via) >= 4 {
			return errors.New("too many redirects")
		}
		if !allowedMediaHost(req.URL.Hostname()) {
			return errors.New("redirect host not allowed")
		}
		return nil
	},
}

func fetchXHSMedia(ctx context.Context, rawURL string, maxSize int64) ([]byte, string, error) {
	rawURL = httpsURL(rawURL)
	u, err := url.Parse(rawURL)
	if err != nil || !allowedMediaHost(u.Hostname()) {
		return nil, "", fmt.Errorf("media host not allowed")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, "", err
	}
	req.Header.Set("User-Agent", clipUA)
	req.Header.Set("Accept", "image/*,video/*,*/*;q=0.8")
	req.Header.Set("Referer", "https://www.xiaohongshu.com/")
	resp, err := mediaClient.Do(req)
	if err != nil {
		return nil, "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, "", fmt.Errorf("media status %d", resp.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxSize+1))
	if err != nil {
		return nil, "", err
	}
	if len(body) == 0 {
		return nil, "", errMediaEmpty
	}
	if int64(len(body)) > maxSize {
		return nil, "", fmt.Errorf("media exceeds %d bytes", maxSize)
	}
	return body, resp.Header.Get("Content-Type"), nil
}

// saveAttachment stores a blob (deduplicated by sha256) and its image thumbnail.
// It serializes quota checks and writes; callers pass an already size-capped payload.
func (s *Server) saveAttachment(userID string, data []byte, filename, mimeHint string) (savedAttachment, error) {
	var out savedAttachment
	if len(data) == 0 {
		return out, errMediaEmpty
	}
	if len(data) > maxAttachmentTotal {
		return out, fmt.Errorf("attachment too large")
	}
	sum := sha256.Sum256(data)
	hash := hex.EncodeToString(sum[:])
	out.Hash = hash

	s.mediaMu.Lock()
	defer s.mediaMu.Unlock()

	err := s.db.QueryRow(`SELECT size, mime, kind, thumb_hash FROM attachments WHERE user_id = ? AND hash = ?`,
		userID, hash).Scan(&out.Size, &out.Mime, &out.Kind, &out.ThumbHash)
	if err == nil {
		return out, nil
	}
	if err != sql.ErrNoRows {
		return out, err
	}

	var quota, used int64
	s.db.QueryRow(`SELECT quota_bytes FROM users WHERE id = ?`, userID).Scan(&quota)
	s.db.QueryRow(`SELECT COALESCE(SUM(size), 0) FROM attachments WHERE user_id = ?`, userID).Scan(&used)
	if quota > 0 && used+int64(len(data)) > quota {
		return out, errQuota
	}

	mimeT := http.DetectContentType(data)
	if base, _, _ := mime.ParseMediaType(mimeT); base == "application/octet-stream" || base == "text/plain" {
		if hint, _, err := mime.ParseMediaType(mimeHint); err == nil {
			switch {
			case strings.HasPrefix(hint, "image/"), strings.HasPrefix(hint, "video/"), strings.HasPrefix(hint, "audio/"):
				mimeT = hint
			}
		}
		if base, _, _ := mime.ParseMediaType(mimeT); base == "application/octet-stream" || base == "text/plain" {
			if ext := filepath.Ext(filename); ext != "" {
				if byExt := mime.TypeByExtension(ext); byExt != "" {
					mimeT = byExt
				}
			}
		}
	}
	if hint, _, err := mime.ParseMediaType(mimeHint); err == nil {
		if strings.HasPrefix(hint, "image/") || strings.HasPrefix(hint, "video/") || strings.HasPrefix(hint, "audio/") {
			// Prefer a concrete CDN hint when byte sniffing only yields a generic type.
			if base, _, _ := mime.ParseMediaType(mimeT); base == "application/octet-stream" || base == "text/plain" {
				mimeT = hint
			}
		}
	}
	kind := "file"
	switch {
	case strings.HasPrefix(mimeT, "image/"):
		kind = "image"
	case strings.HasPrefix(mimeT, "video/"):
		kind = "video"
	case strings.HasPrefix(mimeT, "audio/"):
		kind = "audio"
	}

	dir := filepath.Join(s.dataDir, "blobs", userID)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return out, err
	}
	blobPath := filepath.Join(dir, hash)
	if err := os.WriteFile(blobPath, data, 0o644); err != nil {
		return out, err
	}
	if kind == "image" {
		if img, err := imaging.Decode(bytes.NewReader(data)); err == nil {
			thumb := imaging.Fit(img, 512, 512, imaging.Lanczos)
			var buf bytes.Buffer
			if err := imaging.Encode(&buf, thumb, imaging.JPEG, imaging.JPEGQuality(85)); err == nil {
				tsum := sha256.Sum256(buf.Bytes())
				out.ThumbHash = hex.EncodeToString(tsum[:])
				if err := os.WriteFile(blobPath+".thumb", buf.Bytes(), 0o644); err != nil {
					out.ThumbHash = ""
				}
			}
		}
	}
	if _, err := s.db.Exec(`INSERT INTO attachments(user_id, hash, size, mime, kind, thumb_hash, blob_path, created_at)
		VALUES(?,?,?,?,?,?,?,?)`, userID, hash, len(data), mimeT, kind, out.ThumbHash, blobPath, nowUTC()); err != nil {
		return out, err
	}
	out.Size = int64(len(data))
	out.Mime = mimeT
	out.Kind = kind
	return out, nil
}
