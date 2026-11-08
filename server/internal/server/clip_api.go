package server

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
)

type clipImageDownload struct {
	Index      int    `json:"index"`
	Status     string `json:"status"`
	Hash       string `json:"hash,omitempty"`
	LiveStatus string `json:"live_status,omitempty"`
	LiveHash   string `json:"live_hash,omitempty"`
	Error      string `json:"error,omitempty"`
}

type clipVideoDownload struct {
	Status    string `json:"status"`
	Hash      string `json:"hash,omitempty"`
	CoverHash string `json:"cover_hash,omitempty"`
	Error     string `json:"error,omitempty"`
}

type clipDownloadResult struct {
	Images []clipImageDownload `json:"images"`
	Video  *clipVideoDownload  `json:"video,omitempty"`
}

func (s *Server) handleClipParse(w http.ResponseWriter, r *http.Request) {
	a := authFrom(r)
	var req struct {
		URL string `json:"url"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	req.URL = strings.TrimSpace(req.URL)
	if req.URL == "" || len(req.URL) > 2048 {
		writeErr(w, http.StatusBadRequest, "请粘贴小红书分享链接")
		return
	}
	clip, err := parseXHSURL(r.Context(), s.clipFetch, req.URL)
	if err != nil {
		writeClipErr(w, err)
		return
	}
	var existing string
	s.db.QueryRow(`SELECT message_id FROM clips WHERE user_id = ? AND platform = ? AND note_id = ?`,
		a.userID, clip.Platform, clip.NoteID).Scan(&existing)
	parseID := uuid.NewString()
	s.clipCache.put(parseID, a.userID, clip)
	writeJSON(w, http.StatusOK, clipParseResult{
		ParseID:           parseID,
		ExistingMessageID: existing,
		Clip:              clip,
	})
}

func (s *Server) handleClipDownload(w http.ResponseWriter, r *http.Request) {
	a := authFrom(r)
	var req struct {
		ParseID      string `json:"parse_id"`
		ImageIndices []int  `json:"image_indices"`
		Video        bool   `json:"video"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	clip, ok := s.clipCache.get(req.ParseID, a.userID)
	if !ok {
		writeErr(w, http.StatusGone, "解析结果已过期，请重新解析")
		return
	}
	indices := dedupeIndices(req.ImageIndices, len(clip.Images))
	if len(indices) == 0 && !(req.Video && clip.Video != nil) {
		writeErr(w, http.StatusBadRequest, "请选择要保存的图片或视频")
		return
	}
	// Let downloads finish even if the browser navigates away; bounded server-side.
	ctx, cancel := context.WithTimeout(context.WithoutCancel(r.Context()), 5*time.Minute)
	defer cancel()

	out := clipDownloadResult{Images: make([]clipImageDownload, 0, len(indices))}
	type job struct {
		pos int
		idx int
	}
	jobs := make(chan job, len(indices))
	for pos, idx := range indices {
		jobs <- job{pos: pos, idx: idx}
	}
	close(jobs)
	out.Images = make([]clipImageDownload, len(indices))
	var wg sync.WaitGroup
	sem := make(chan struct{}, 4)
	for j := range jobs {
		wg.Add(1)
		go func(j job) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			img := clip.Images[j.idx]
			res := clipImageDownload{Index: j.idx, Status: "failed"}
			if img.originalURL == "" {
				res.Error = "没有可用的图片地址"
				out.Images[j.pos] = res
				return
			}
			hash, err := s.downloadOne(ctx, a.userID, img.originalURL, maxClipImage, "xhs-image.jpg")
			if err != nil {
				res.Error = mediaErrText(err)
				out.Images[j.pos] = res
				return
			}
			res.Status, res.Hash = "ok", hash
			if img.Live && img.liveURL != "" {
				if liveHash, err := s.downloadOne(ctx, a.userID, img.liveURL, maxClipLive, "xhs-live.mp4"); err == nil {
					res.LiveStatus, res.LiveHash = "ok", liveHash
				} else {
					res.LiveStatus, res.Error = "failed", mediaErrText(err)
				}
			} else if img.Live {
				res.LiveStatus = "skipped"
			}
			out.Images[j.pos] = res
		}(j)
	}
	wg.Wait()

	if req.Video && clip.Video != nil {
		v := clip.Video
		res := &clipVideoDownload{Status: "failed"}
		if v.originalURL == "" {
			res.Error = "没有可用的视频地址"
		} else if hash, err := s.downloadOne(ctx, a.userID, v.originalURL, maxClipVideo, "xhs-video.mp4"); err != nil {
			res.Error = mediaErrText(err)
		} else {
			res.Status, res.Hash = "ok", hash
			if v.coverURL != "" {
				if coverHash, err := s.downloadOne(ctx, a.userID, v.coverURL, maxClipImage, "xhs-cover.jpg"); err == nil {
					res.CoverHash = coverHash
				} else {
					res.Error = mediaErrText(err)
				}
			}
		}
		out.Video = res
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) downloadOne(ctx context.Context, userID, mediaURL string, maxSize int64, filename string) (string, error) {
	if mediaURL == "" {
		return "", errMediaEmpty
	}
	data, mimeHint, err := s.mediaFetch(ctx, mediaURL, maxSize)
	if err != nil {
		return "", err
	}
	saved, err := s.saveAttachment(userID, data, filename, mimeHint)
	if err != nil {
		return "", err
	}
	return saved.Hash, nil
}

func mediaErrText(err error) string {
	switch {
	case errors.Is(err, errQuota):
		return "存储空间不足"
	case errors.Is(err, errMediaEmpty):
		return "没有可用的媒体地址"
	case errors.Is(err, context.DeadlineExceeded):
		return "下载超时"
	default:
		return "媒体下载失败"
	}
}

func dedupeIndices(in []int, n int) []int {
	seen := map[int]bool{}
	out := make([]int, 0, len(in))
	for _, idx := range in {
		if idx >= 0 && idx < n && !seen[idx] {
			seen[idx] = true
			out = append(out, idx)
		}
	}
	return out
}

func writeClipErr(w http.ResponseWriter, err error) {
	var ce *clipError
	if errors.As(err, &ce) {
		writeErr(w, ce.status, ce.msg)
		return
	}
	writeErr(w, http.StatusBadGateway, "解析失败，请稍后重试")
}
