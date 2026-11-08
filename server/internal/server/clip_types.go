package server

import (
	"sync"
	"time"
)

const clipParseTTL = 15 * time.Minute

type ClipAuthor struct {
	UserID    string `json:"user_id"`
	Name      string `json:"name"`
	AvatarURL string `json:"avatar_url,omitempty"`
}

type ClipStats struct {
	Likes    string `json:"likes,omitempty"`
	Collects string `json:"collects,omitempty"`
	Comments string `json:"comments,omitempty"`
	Shares   string `json:"shares,omitempty"`
}

type ClipChapter struct {
	Text   string `json:"text"`
	TimeMS int64  `json:"time_ms"`
}

type ClipImage struct {
	FileID      string `json:"file_id"`
	Width       int    `json:"width"`
	Height      int    `json:"height"`
	Live        bool   `json:"live,omitempty"`
	LiveSize    int64  `json:"live_size,omitempty"`
	PreviewURL  string `json:"preview_url,omitempty"`
	Watermarked bool   `json:"watermarked,omitempty"`

	originalURL string
	liveURL     string
}

type ClipVideo struct {
	FileID      string `json:"file_id"`
	Width       int    `json:"width"`
	Height      int    `json:"height"`
	DurationMS  int64  `json:"duration_ms"`
	Size        int64  `json:"size"`
	CoverFileID string `json:"cover_file_id,omitempty"`
	CoverWidth  int    `json:"cover_width,omitempty"`
	CoverHeight int    `json:"cover_height,omitempty"`
	PreviewURL  string `json:"preview_url,omitempty"`
	Watermarked bool   `json:"watermarked,omitempty"`

	originalURL string
	coverURL    string
}

type ParsedClip struct {
	Platform           string        `json:"platform"`
	NoteID             string        `json:"note_id"`
	SourceURL          string        `json:"source_url"`
	NoteType           string        `json:"note_type"`
	Title              string        `json:"title"`
	Body               string        `json:"body"`
	Author             ClipAuthor    `json:"author"`
	PublishedAt        string        `json:"published_at"`
	NoteUpdatedAt      string        `json:"note_updated_at,omitempty"`
	Stats              ClipStats     `json:"stats"`
	Tags               []string      `json:"tags"`
	ContentDeclaration string        `json:"content_declaration,omitempty"`
	Chapters           []ClipChapter `json:"chapters,omitempty"`
	Images             []ClipImage   `json:"images"`
	Video              *ClipVideo    `json:"video,omitempty"`
}

type clipParseResult struct {
	ParseID           string      `json:"parse_id"`
	ExistingMessageID string      `json:"existing_message_id,omitempty"`
	Clip              *ParsedClip `json:"clip"`
}

type cachedClip struct {
	userID  string
	expires time.Time
	clip    *ParsedClip
}

type clipCache struct {
	mu    sync.Mutex
	items map[string]cachedClip
}

func newClipCache() *clipCache {
	return &clipCache{items: map[string]cachedClip{}}
}

func (c *clipCache) put(id, userID string, clip *ParsedClip) {
	if c == nil || clip == nil {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	now := time.Now()
	for k, v := range c.items {
		if now.After(v.expires) {
			delete(c.items, k)
		}
	}
	// Keep the cache bounded; parsed notes are small, but signed URLs should not pile up.
	if len(c.items) >= 96 {
		var oldestKey string
		var oldest time.Time
		for k, v := range c.items {
			if oldestKey == "" || v.expires.Before(oldest) {
				oldestKey, oldest = k, v.expires
			}
		}
		delete(c.items, oldestKey)
	}
	c.items[id] = cachedClip{userID: userID, expires: now.Add(clipParseTTL), clip: clip}
}

func (c *clipCache) get(id, userID string) (*ParsedClip, bool) {
	if c == nil {
		return nil, false
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	v, ok := c.items[id]
	if !ok || v.userID != userID || time.Now().After(v.expires) {
		if ok {
			delete(c.items, id)
		}
		return nil, false
	}
	return v.clip, true
}
