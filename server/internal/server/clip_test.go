package server

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"github.com/google/uuid"
)

func xhsFixture(t *testing.T, video bool) (html []byte, finalURL string) {
	t.Helper()
	imageList := []any{
		map[string]any{
			"fileId": "spectrum/aaa", "width": 1904, "height": 2544, "livePhoto": true,
			"url": "http://sns-webpic-qc.xhscdn.com/20261108/h/spectrum/aaa!h5_1080jpg",
			"stream": map[string]any{"h264": []any{map[string]any{
				"masterUrl": "http://sns-video-v3.xhscdn.com/live-a.mp4", "size": 900000,
				"width": 1080, "height": 1440, "duration": 3200,
			}}},
		},
		map[string]any{
			"fileId": "notes_pre_post/bbb", "width": 1920, "height": 2560, "livePhoto": false,
			"url": "http://sns-webpic-qc.xhscdn.com/20261108/h/notes_pre_post/bbb!h5_1080jpg",
		},
	}
	note := map[string]any{
		"noteId": "6abcdef00000000000000001",
		"type":   "normal",
		"title":  "测试笔记标题",
		"desc":   "第一行\n第二行",
		"time":   int64(1794124857000),
		"user": map[string]any{
			"userId": "u1", "nickName": "测试作者", "avatar": "http://sns-avatar-qc.xhscdn.com/a.jpg",
		},
		"interactInfo": map[string]any{
			"likedCount": "2.5万", "collectedCount": "3446", "commentCount": "693", "shareCount": "9276",
		},
		"tagList":     []any{map[string]any{"name": "tag1"}, map[string]any{"name": "tag2"}},
		"imageList":   imageList,
		"illegalInfo": map[string]any{"desc": "作者声明：含ai生成内容"},
	}
	if video {
		note["type"] = "video"
		note["video"] = map[string]any{
			"media": map[string]any{
				"video": map[string]any{"bizId": "v1"},
				"stream": map[string]any{
					"h264": []any{map[string]any{
						"masterUrl": "http://sns-video-v3.xhscdn.com/video-a.mp4", "size": 4359257,
						"width": 1280, "height": 720, "duration": 56820,
					}},
					"h265": []any{map[string]any{
						"masterUrl": "http://sns-video-v3.xhscdn.com/video-b.mp4", "size": 4532084,
						"width": 1280, "height": 720, "duration": 56820,
					}},
				},
			},
			"consumer": map[string]any{"chapters": []any{
				map[string]any{"text": "开场", "time": 0},
				map[string]any{"text": "结尾", "time": 43000},
			}},
		}
	}
	state := map[string]any{
		"noteData": map[string]any{
			"data": map[string]any{"noteData": note},
			"normalNotePreloadData": map[string]any{"imagesList": []any{map[string]any{
				"urlSizeLarge": "http://sns-na-i2.xhscdn.com/spectrum/aaa?imageView2/2/w/1080/format/webp&ext=EXT-TOKEN",
			}}},
		},
	}
	b, err := json.Marshal(state)
	if err != nil {
		t.Fatal(err)
	}
	html = []byte("<html><script>window.__INITIAL_STATE__=" + string(b) + ";</script></html>")
	finalURL = "https://www.xiaohongshu.com/discovery/item/6abcdef00000000000000001?xsec_token=TOK&xsec_source=app_share&apptime=123"
	return
}

func TestParseXHSHTML(t *testing.T) {
	html, finalURL := xhsFixture(t, false)
	clip, err := parseXHSHTML(html, finalURL)
	if err != nil {
		t.Fatal(err)
	}
	if clip.Platform != "xhs" || clip.NoteID != "6abcdef00000000000000001" {
		t.Fatalf("unexpected identity: %+v", clip)
	}
	if clip.Title != "测试笔记标题" || clip.Author.Name != "测试作者" {
		t.Fatalf("unexpected metadata: %+v", clip)
	}
	if clip.SourceURL != "https://www.xiaohongshu.com/discovery/item/6abcdef00000000000000001?xsec_source=app_share&xsec_token=TOK" {
		t.Fatalf("unexpected source url: %s", clip.SourceURL)
	}
	if len(clip.Images) != 2 || !clip.Images[0].Live || clip.Images[0].LiveSize != 900000 {
		t.Fatalf("unexpected images: %+v", clip.Images)
	}
	if !strings.Contains(clip.Images[0].originalURL, "w/1904") || !strings.Contains(clip.Images[0].originalURL, "ext=EXT-TOKEN") {
		t.Fatalf("original url not built: %s", clip.Images[0].originalURL)
	}
	if !strings.HasPrefix(clip.Images[0].liveURL, "https://sns-video-v3.xhscdn.com/") {
		t.Fatalf("live url not normalized: %s", clip.Images[0].liveURL)
	}
	if clip.ContentDeclaration != "作者声明：含ai生成内容" || len(clip.Tags) != 2 {
		t.Fatalf("unexpected declaration/tags: %+v", clip)
	}
	if clip.Stats.Likes != "2.5万" || clip.Stats.Collects != "3446" {
		t.Fatalf("unexpected stats: %+v", clip.Stats)
	}
	if clip.PublishedAt == "" || clip.NoteUpdatedAt != "" {
		t.Fatalf("unexpected timestamps: %q %q", clip.PublishedAt, clip.NoteUpdatedAt)
	}
}

func TestParseXHSVideo(t *testing.T) {
	html, finalURL := xhsFixture(t, true)
	clip, err := parseXHSHTML(html, finalURL)
	if err != nil {
		t.Fatal(err)
	}
	if clip.NoteType != "video" || clip.Video == nil || len(clip.Images) != 0 {
		t.Fatalf("unexpected video clip: %+v", clip)
	}
	if !strings.Contains(clip.Video.originalURL, "video-a.mp4") || clip.Video.DurationMS != 56820 {
		t.Fatalf("unexpected video: %+v", clip.Video)
	}
	if clip.Video.CoverFileID != "spectrum/aaa" || clip.Video.CoverWidth != 1904 {
		t.Fatalf("unexpected cover: %+v", clip.Video)
	}
	if len(clip.Chapters) != 2 || clip.Chapters[1].TimeMS != 43000 {
		t.Fatalf("unexpected chapters: %+v", clip.Chapters)
	}
}

func TestParseXHSHTMLToleratesUndefined(t *testing.T) {
	html, finalURL := xhsFixture(t, false)
	html = []byte(strings.ReplaceAll(string(html), `"desc":"第一行\n第二行"`, `"desc":undefined`))
	clip, err := parseXHSHTML(html, finalURL)
	if err != nil {
		t.Fatal(err)
	}
	if clip.Body != "" {
		t.Fatalf("expected empty body, got %q", clip.Body)
	}
}

func TestParseXHSHTMLErrors(t *testing.T) {
	if _, err := parseXHSHTML([]byte("<html>nothing</html>"), "https://www.xiaohongshu.com/discovery/item/x"); err == nil {
		t.Fatal("expected structure error")
	}
	if _, err := parseXHSHTML([]byte("x"), "https://www.xiaohongshu.com/404/sec_x"); err == nil {
		t.Fatal("expected link expiry error")
	}
}

func TestCanonicalNoteURL(t *testing.T) {
	got := canonicalNoteURL("https://www.xiaohongshu.com/explore/abc?xsec_token=T&xsec_source=app_share&foo=bar", "abc")
	want := "https://www.xiaohongshu.com/discovery/item/abc?xsec_source=app_share&xsec_token=T"
	if got != want {
		t.Fatalf("want %s got %s", want, got)
	}
}

func TestClipParseAPIAndDedup(t *testing.T) {
	s, ts := newTestServer(t)
	token, deviceID := bootstrapAdmin(t, ts)
	html, finalURL := xhsFixture(t, false)
	s.clipFetch = func(_ context.Context, _ string) ([]byte, string, error) { return html, finalURL, nil }

	res := jsonDo(t, ts, "POST", "/api/clips/parse", token, map[string]any{"url": "https://xhslink.cn/o/test"}, 200)
	if res["parse_id"] == "" || res["clip"] == nil {
		t.Fatalf("unexpected parse response: %+v", res)
	}
	clip := res["clip"].(map[string]any)
	if clip["title"] != "测试笔记标题" || clip["note_id"] != "6abcdef00000000000000001" {
		t.Fatalf("unexpected clip: %+v", clip)
	}

	roleID, msgID := uuid.NewString(), uuid.NewString()
	pushOps(t, ts, token, deviceID,
		mkOp("role.create", rolePayload(roleID, "剪藏")),
		mkOp("message.create", map[string]any{
			"id": msgID, "role_id": roleID, "type": "clip",
			"text":           "测试笔记标题\n第一行\n第二行\n作者：测试作者",
			"attachment_ref": "", "side": "right", "todo_done": false,
			"meta": map[string]any{
				"platform": "xhs", "note_id": "6abcdef00000000000000001",
				"title": "测试笔记标题", "body": "第一行\n第二行",
				"media": []any{},
			},
			"created_at": nowUTC(), "updated_at": nowUTC(),
		}),
	)
	res = jsonDo(t, ts, "POST", "/api/clips/parse", token, map[string]any{"url": "https://xhslink.cn/o/test"}, 200)
	if res["existing_message_id"] != msgID {
		t.Fatalf("expected dedup hit %s, got %+v", msgID, res)
	}

	// Delete removes the dedup mapping.
	pushOps(t, ts, token, deviceID, mkOp("message.delete", map[string]any{"id": msgID, "updated_at": nowUTC()}))
	res = jsonDo(t, ts, "POST", "/api/clips/parse", token, map[string]any{"url": "https://xhslink.cn/o/test"}, 200)
	if res["existing_message_id"] != nil && res["existing_message_id"] != "" {
		t.Fatalf("expected dedup to be cleared, got %+v", res)
	}
}

// anyContext lets tests inject a fetcher without importing context in every test.

func TestClipDownloadAPI(t *testing.T) {
	s, ts := newTestServer(t)
	token, _ := bootstrapAdmin(t, ts)
	html, finalURL := xhsFixture(t, false)
	s.clipFetch = func(_ context.Context, _ string) ([]byte, string, error) { return html, finalURL, nil }
	png := testPNG(t, 20, 20)
	s.mediaFetch = func(_ context.Context, _ string, _ int64) ([]byte, string, error) { return png, "image/png", nil }

	res := jsonDo(t, ts, "POST", "/api/clips/parse", token, map[string]any{"url": "https://xhslink.cn/o/test"}, 200)
	parseID := res["parse_id"].(string)
	dl := jsonDo(t, ts, "POST", "/api/clips/download", token, map[string]any{
		"parse_id": parseID, "image_indices": []int{0, 1},
	}, 200)
	images := dl["images"].([]any)
	if len(images) != 2 {
		t.Fatalf("unexpected download response: %+v", dl)
	}
	first := images[0].(map[string]any)
	if first["status"] != "ok" || first["hash"] == "" || first["live_status"] != "ok" {
		t.Fatalf("unexpected first image: %+v", first)
	}
	hash := first["hash"].(string)

	// Blob is served with Range support (video seeking relies on it).
	req, _ := http.NewRequest("GET", ts.URL+"/api/blobs/"+hash, nil)
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Range", "bytes=0-9")
	resp, err := ts.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusPartialContent || resp.Header.Get("Content-Range") == "" {
		t.Fatalf("expected 206 range response, got %d %q", resp.StatusCode, resp.Header.Get("Content-Range"))
	}
}
