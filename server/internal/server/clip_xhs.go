package server

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"path"
	"strconv"
	"strings"
	"time"
)

const (
	maxClipHTML = 6 << 20
	clipUA      = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
)

type clipFetcher func(context.Context, string) (body []byte, finalURL string, err error)

// clipError carries an HTTP status and a user-facing Chinese message.
type clipError struct {
	status int
	msg    string
}

func (e *clipError) Error() string { return e.msg }

func clipErr(status int, msg string) error { return &clipError{status: status, msg: msg} }

var xhsClient = &http.Client{
	Timeout: 25 * time.Second,
	CheckRedirect: func(req *http.Request, via []*http.Request) error {
		if len(via) >= 6 {
			return errors.New("too many redirects")
		}
		if !allowedXHSHost(req.URL.Hostname()) {
			return errors.New("redirect host not allowed")
		}
		return nil
	},
}

func allowedXHSHost(host string) bool {
	host = strings.ToLower(host)
	return host == "xiaohongshu.com" || strings.HasSuffix(host, ".xiaohongshu.com") ||
		host == "xhslink.cn" || strings.HasSuffix(host, ".xhslink.cn") ||
		host == "xhslink.com" || strings.HasSuffix(host, ".xhslink.com")
}

func allowedMediaHost(host string) bool {
	host = strings.ToLower(host)
	return host == "xhscdn.com" || strings.HasSuffix(host, ".xhscdn.com")
}

func validateXHSInput(raw string) error {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") {
		return clipErr(http.StatusBadRequest, "请粘贴完整的小红书分享链接")
	}
	if !allowedXHSHost(u.Hostname()) {
		return clipErr(http.StatusBadRequest, "目前只支持小红书链接")
	}
	return nil
}

func fetchXHS(ctx context.Context, raw string) ([]byte, string, error) {
	if err := validateXHSInput(raw); err != nil {
		return nil, "", err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, strings.TrimSpace(raw), nil)
	if err != nil {
		return nil, "", clipErr(http.StatusBadRequest, "链接格式不正确")
	}
	req.Header.Set("User-Agent", clipUA)
	req.Header.Set("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
	req.Header.Set("Accept-Language", "zh-CN,zh;q=0.9")
	req.Header.Set("Referer", "https://www.xiaohongshu.com/")
	resp, err := xhsClient.Do(req)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			return nil, "", clipErr(http.StatusGatewayTimeout, "解析超时，请稍后重试")
		}
		return nil, "", clipErr(http.StatusBadGateway, "无法连接小红书，请检查 NAS 网络")
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxClipHTML+1))
	if err != nil {
		return nil, "", clipErr(http.StatusBadGateway, "读取小红书页面失败")
	}
	if len(body) > maxClipHTML {
		return nil, "", clipErr(http.StatusRequestEntityTooLarge, "页面过大，暂不支持")
	}
	final := resp.Request.URL.String()
	switch resp.StatusCode {
	case http.StatusOK:
		return body, final, nil
	case http.StatusNotFound:
		return nil, "", clipErr(http.StatusUnprocessableEntity, "链接已失效，请在 App 重新复制分享链接")
	case http.StatusForbidden, 461, 471:
		return nil, "", clipErr(http.StatusTooManyRequests, "小红书拒绝了这次访问，请稍后重试")
	default:
		return nil, "", clipErr(http.StatusBadGateway, fmt.Sprintf("小红书返回 %d，请稍后重试", resp.StatusCode))
	}
}

func parseXHSURL(ctx context.Context, fetch clipFetcher, raw string) (*ParsedClip, error) {
	if fetch == nil {
		fetch = fetchXHS
	}
	body, final, err := fetch(ctx, raw)
	if err != nil {
		return nil, err
	}
	return parseXHSHTML(body, final)
}

// parseXHSHTML extracts the public share page's embedded note state.
// It performs no network I/O, which keeps it easy to test with fixtures.
func parseXHSHTML(body []byte, finalURL string) (*ParsedClip, error) {
	u, _ := url.Parse(finalURL)
	if u != nil && strings.Contains(u.Path, "/404/") {
		return nil, clipErr(http.StatusUnprocessableEntity, "链接已失效，请在 App 重新复制分享链接")
	}
	if u != nil && strings.Contains(u.Path, "/login") {
		return nil, clipErr(http.StatusForbidden, "需要登录才能查看这条笔记")
	}
	state, err := decodeInitialState(body)
	if err != nil {
		return nil, clipErr(http.StatusBadGateway, "小红书页面结构变了，暂不支持")
	}
	note := asMap(dig(state, "noteData", "data", "noteData"))
	if note == nil {
		note = asMap(dig(state, "noteData", "noteData"))
	}
	if note == nil {
		note = asMap(dig(state, "note", "noteDetailMap"))
		if note != nil {
			// Desktop shape: noteDetailMap[id].note
			for _, v := range note {
				if n := asMap(dig(v, "note")); n != nil {
					note = n
					break
				}
				if n := asMap(v); n != nil && asString(n["noteId"]) != "" {
					note = n
					break
				}
			}
		}
	}
	if note == nil || asString(note["noteId"]) == "" {
		return nil, clipErr(http.StatusUnprocessableEntity, "这条笔记不可见或已被删除")
	}

	noteType := asString(note["type"])
	if noteType != "normal" && noteType != "video" {
		return nil, clipErr(http.StatusUnprocessableEntity, "这条笔记暂不支持（仅支持图文/视频笔记）")
	}
	noteID := asString(note["noteId"])
	sourceURL := canonicalNoteURL(finalURL, noteID)
	preload := asMap(state["normalNotePreloadData"])
	if preload == nil {
		preload = asMap(dig(state, "noteData", "normalNotePreloadData"))
	}
	mediaHost, ext := preloadExt(preload)

	clip := &ParsedClip{
		Platform:  "xhs",
		NoteID:    noteID,
		SourceURL: sourceURL,
		NoteType:  "image",
		Title:     strings.TrimSpace(asString(note["title"])),
		Body:      strings.TrimSpace(asString(note["desc"])),
		Images:    []ClipImage{},
		Tags:      []string{},
		Author: ClipAuthor{
			UserID:    asString(dig(note, "user", "userId")),
			Name:      asString(dig(note, "user", "nickName")),
			AvatarURL: httpsURL(asString(dig(note, "user", "avatar"))),
		},
		PublishedAt:   isoFromMS(asInt(note["time"])),
		NoteUpdatedAt: isoFromMS(asInt(note["lastUpdateTime"])),
		Stats: ClipStats{
			Likes:    asString(dig(note, "interactInfo", "likedCount")),
			Collects: asString(dig(note, "interactInfo", "collectedCount")),
			Comments: asString(dig(note, "interactInfo", "commentCount")),
			Shares:   asString(dig(note, "interactInfo", "shareCount")),
		},
		ContentDeclaration: asString(dig(note, "illegalInfo", "desc")),
	}
	for _, tv := range asSlice(note["tagList"]) {
		if name := asString(asMap(tv)["name"]); name != "" {
			clip.Tags = append(clip.Tags, name)
		}
	}

	images := make([]ClipImage, 0, len(asSlice(note["imageList"])))
	for _, iv := range asSlice(note["imageList"]) {
		im := asMap(iv)
		fileID := asString(im["fileId"])
		if fileID == "" {
			continue
		}
		w, h := int(asInt(im["width"])), int(asInt(im["height"]))
		if w <= 0 {
			w = 1080
		}
		preview := httpsURL(asString(im["url"]))
		if preview == "" {
			preview = firstInfoURL(im)
		}
		orig := originalImageURL(mediaHost, fileID, w, ext)
		watermarked := false
		if orig == "" {
			orig = preview
			watermarked = true
		}
		ci := ClipImage{
			FileID:      fileID,
			Width:       w,
			Height:      h,
			PreviewURL:  preview,
			Watermarked: watermarked,
			originalURL: orig,
		}
		if asBool(im["livePhoto"]) {
			if liveURL, size, ok := pickStream(asMap(im["stream"]), "h264"); ok {
				ci.Live = true
				ci.LiveSize = size
				ci.liveURL = liveURL
			}
		}
		images = append(images, ci)
	}

	if noteType == "video" {
		clip.NoteType = "video"
		v := asMap(note["video"])
		var stream map[string]any
		if v != nil {
			stream = asMap(dig(v, "media", "stream"))
		}
		videoURL, size, ok := pickStream(stream, "h264")
		streamMap := chosenStream(stream, "h264")
		if !ok {
			videoURL, size, ok = pickStream(stream, "h265")
			streamMap = chosenStream(stream, "h265")
		}
		if !ok || videoURL == "" {
			return nil, clipErr(http.StatusUnprocessableEntity, "这条视频暂时拿不到播放地址")
		}
		duration := asInt(streamMap["duration"])
		if duration == 0 {
			duration = asInt(dig(v, "media", "video", "duration")) * 1000
		}
		w, h := int(asInt(streamMap["width"])), int(asInt(streamMap["height"]))
		clip.Video = &ClipVideo{
			FileID:      asString(dig(v, "media", "video", "bizId")),
			Width:       w,
			Height:      h,
			DurationMS:  duration,
			Size:        size,
			originalURL: videoURL,
		}
		if len(images) > 0 {
			cover := images[0]
			clip.Video.CoverFileID = cover.FileID
			clip.Video.CoverWidth = cover.Width
			clip.Video.CoverHeight = cover.Height
			clip.Video.PreviewURL = cover.PreviewURL
			clip.Video.Watermarked = cover.Watermarked
			clip.Video.coverURL = cover.originalURL
		}
		for _, cv := range asSlice(dig(v, "consumer", "chapters")) {
			cm := asMap(cv)
			clip.Chapters = append(clip.Chapters, ClipChapter{
				Text:   asString(cm["text"]),
				TimeMS: asInt(cm["time"]),
			})
		}
	} else {
		clip.Images = images
	}
	if len(clip.Images) == 0 && clip.Video == nil {
		return nil, clipErr(http.StatusUnprocessableEntity, "这条笔记没有可提取的内容")
	}
	if clip.Title == "" {
		clip.Title = "小红书笔记 " + noteID
	}
	return clip, nil
}

func decodeInitialState(body []byte) (map[string]any, error) {
	idx := bytes.Index(body, []byte("__INITIAL_STATE__"))
	if idx < 0 {
		return nil, errors.New("initial state not found")
	}
	start := bytes.IndexByte(body[idx:], '{')
	if start < 0 {
		return nil, errors.New("initial state object not found")
	}
	start += idx
	obj := extractJSONObject(body[start:])
	if len(obj) == 0 {
		return nil, errors.New("unterminated initial state")
	}
	obj = normalizeJSONLiterals(obj)
	var out map[string]any
	if err := json.Unmarshal(obj, &out); err != nil {
		return nil, err
	}
	return out, nil
}

// extractJSONObject returns a balanced {...} object, ignoring braces inside strings.
func extractJSONObject(b []byte) []byte {
	depth := 0
	inString := false
	escaped := false
	for i, c := range b {
		if inString {
			if escaped {
				escaped = false
				continue
			}
			if c == '\\' {
				escaped = true
			} else if c == '"' {
				inString = false
			}
			continue
		}
		switch c {
		case '"':
			inString = true
		case '{':
			depth++
		case '}':
			depth--
			if depth == 0 {
				return b[:i+1]
			}
		}
	}
	return nil
}

// normalizeJSONLiterals converts JS-only primitives outside strings to JSON null.
func normalizeJSONLiterals(b []byte) []byte {
	out := make([]byte, 0, len(b))
	inString := false
	escaped := false
	for i := 0; i < len(b); i++ {
		c := b[i]
		if inString {
			out = append(out, c)
			if escaped {
				escaped = false
			} else if c == '\\' {
				escaped = true
			} else if c == '"' {
				inString = false
			}
			continue
		}
		if c == '"' {
			inString = true
			out = append(out, c)
			continue
		}
		rest := b[i:]
		switch {
		case bytes.HasPrefix(rest, []byte("undefined")) && boundary(rest, len("undefined")):
			out = append(out, "null"...)
			i += len("undefined") - 1
		case bytes.HasPrefix(rest, []byte("NaN")) && boundary(rest, 3):
			out = append(out, "null"...)
			i += 2
		case bytes.HasPrefix(rest, []byte("Infinity")) && boundary(rest, len("Infinity")):
			out = append(out, "null"...)
			i += len("Infinity") - 1
		default:
			out = append(out, c)
		}
	}
	return out
}

func boundary(b []byte, n int) bool {
	if len(b) <= n {
		return true
	}
	c := b[n]
	return !(c == '_' || c == '$' || c >= '0' && c <= '9' || c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z')
}

func preloadExt(preload map[string]any) (host, ext string) {
	for _, iv := range asSlice(preload["imagesList"]) {
		im := asMap(iv)
		for _, key := range []string{"urlSizeLarge", "url"} {
			u, err := url.Parse(asString(im[key]))
			if err != nil || u.Hostname() == "" {
				continue
			}
			if e := u.Query().Get("ext"); e != "" && allowedMediaHost(u.Hostname()) {
				return u.Hostname(), e
			}
		}
	}
	return "", ""
}

func originalImageURL(host, fileID string, width int, ext string) string {
	if host == "" || ext == "" || fileID == "" {
		return ""
	}
	if width <= 0 {
		width = 1080
	}
	if width > 4096 {
		width = 4096
	}
	fileID = strings.TrimPrefix(fileID, "/")
	return "https://" + host + "/" + fileID + "?imageView2/2/w/" + strconv.Itoa(width) + "/format/jpg&ext=" + url.QueryEscape(ext)
}

func firstInfoURL(im map[string]any) string {
	for _, iv := range asSlice(im["infoList"]) {
		if u := httpsURL(asString(asMap(iv)["url"])); u != "" {
			return u
		}
	}
	return ""
}

func pickStream(stream map[string]any, codec string) (string, int64, bool) {
	arr := asSlice(stream[codec])
	if len(arr) == 0 {
		return "", 0, false
	}
	var best map[string]any
	var bestScore int64 = -1
	for _, sv := range arr {
		sm := asMap(sv)
		if sm == nil {
			continue
		}
		score := asInt(sm["width"])*asInt(sm["height"])*1000 + asInt(sm["size"])
		if score > bestScore {
			best, bestScore = sm, score
		}
	}
	if best == nil {
		return "", 0, false
	}
	u := httpsURL(asString(best["masterUrl"]))
	if u == "" {
		for _, bv := range asSlice(best["backupUrls"]) {
			if u = httpsURL(asString(bv)); u != "" {
				break
			}
		}
	}
	if u == "" {
		return "", 0, false
	}
	return u, asInt(best["size"]), true
}

func chosenStream(stream map[string]any, codec string) map[string]any {
	arr := asSlice(stream[codec])
	var best map[string]any
	var bestScore int64 = -1
	for _, sv := range arr {
		sm := asMap(sv)
		if sm == nil {
			continue
		}
		score := asInt(sm["width"])*asInt(sm["height"])*1000 + asInt(sm["size"])
		if score > bestScore {
			best, bestScore = sm, score
		}
	}
	if best == nil {
		return map[string]any{}
	}
	return best
}

func canonicalNoteURL(finalURL, noteID string) string {
	if noteID == "" {
		if u, err := url.Parse(finalURL); err == nil {
			noteID = path.Base(u.Path)
		}
	}
	token, source := "", "app_share"
	if u, err := url.Parse(finalURL); err == nil {
		token = u.Query().Get("xsec_token")
		if s := u.Query().Get("xsec_source"); s != "" {
			source = s
		}
	}
	q := url.Values{}
	if token != "" {
		q.Set("xsec_token", token)
	}
	q.Set("xsec_source", source)
	return "https://www.xiaohongshu.com/discovery/item/" + url.PathEscape(noteID) + "?" + q.Encode()
}

func httpsURL(raw string) string {
	raw = strings.TrimSpace(raw)
	if strings.HasPrefix(raw, "//") {
		return "https:" + raw
	}
	if strings.HasPrefix(raw, "http://") {
		return "https://" + strings.TrimPrefix(raw, "http://")
	}
	return raw
}

func isoFromMS(ms int64) string {
	if ms <= 0 {
		return ""
	}
	return time.UnixMilli(ms).UTC().Format(time.RFC3339)
}

func asMap(v any) map[string]any {
	m, _ := v.(map[string]any)
	return m
}

func dig(v any, keys ...string) any {
	cur := v
	for _, k := range keys {
		m := asMap(cur)
		if m == nil {
			return nil
		}
		cur = m[k]
	}
	return cur
}

func asSlice(v any) []any {
	a, _ := v.([]any)
	return a
}

func asString(v any) string {
	switch s := v.(type) {
	case string:
		return s
	case json.Number:
		return s.String()
	case float64:
		return strconv.FormatFloat(s, 'f', -1, 64)
	case int64:
		return strconv.FormatInt(s, 10)
	case int:
		return strconv.Itoa(s)
	default:
		return ""
	}
}

func asInt(v any) int64 {
	switch n := v.(type) {
	case float64:
		return int64(n)
	case int64:
		return n
	case int:
		return int64(n)
	case json.Number:
		i, _ := n.Int64()
		return i
	case string:
		i, _ := strconv.ParseInt(strings.TrimSpace(n), 10, 64)
		return i
	default:
		return 0
	}
}

func asBool(v any) bool {
	b, _ := v.(bool)
	return b
}
