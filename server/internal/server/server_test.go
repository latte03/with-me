package server

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/google/uuid"
)

func newTestServer(t *testing.T) (*Server, *httptest.Server) {
	t.Helper()
	dir := t.TempDir()
	db, err := OpenDB(dir)
	if err != nil {
		t.Fatal(err)
	}
	s := New(db, dir, "")
	ts := httptest.NewServer(s.Handler())
	t.Cleanup(func() { ts.Close(); db.Close() })
	return s, ts
}

func rawDo(t *testing.T, ts *httptest.Server, method, path, token string, body []byte, contentType string) *http.Response {
	t.Helper()
	var rd io.Reader
	if body != nil {
		rd = bytes.NewReader(body)
	}
	req, err := http.NewRequest(method, ts.URL+path, rd)
	if err != nil {
		t.Fatal(err)
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	resp, err := ts.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	return resp
}

func jsonDo(t *testing.T, ts *httptest.Server, method, path, token string, body any, wantStatus int) map[string]any {
	t.Helper()
	var data []byte
	if body != nil {
		data, _ = json.Marshal(body)
	}
	resp := rawDo(t, ts, method, path, token, data, "application/json")
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != wantStatus {
		t.Fatalf("%s %s: want %d got %d body=%s", method, path, wantStatus, resp.StatusCode, raw)
	}
	out := map[string]any{}
	if len(raw) > 0 && json.Unmarshal(raw, &out) != nil {
		t.Fatalf("%s %s: non-object response: %s", method, path, raw)
	}
	return out
}

func jsonList(t *testing.T, ts *httptest.Server, method, path, token string, wantStatus int) []any {
	t.Helper()
	resp := rawDo(t, ts, method, path, token, nil, "")
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != wantStatus {
		t.Fatalf("%s %s: want %d got %d body=%s", method, path, wantStatus, resp.StatusCode, raw)
	}
	var out []any
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatalf("bad list response: %s", raw)
	}
	return out
}

func bootstrapAdmin(t *testing.T, ts *httptest.Server) (token, deviceID string) {
	t.Helper()
	deviceID = uuid.NewString()
	res := jsonDo(t, ts, "POST", "/api/auth/bootstrap", "", map[string]any{
		"username": "admin", "password": "admin-pw-123", "device_id": deviceID, "device_name": "测试设备",
	}, 200)
	return res["token"].(string), res["device_id"].(string)
}

func mkOp(typ string, payload map[string]any) map[string]any {
	return map[string]any{
		"op_id": uuid.NewString(), "type": typ, "payload": payload,
		"client_created_at": nowUTC(), "seq": 1,
	}
}

func pushOps(t *testing.T, ts *httptest.Server, token, deviceID string, ops ...map[string]any) map[string]any {
	t.Helper()
	for i, op := range ops {
		op["device_id"] = deviceID
		op["seq"] = i + 1
	}
	return jsonDo(t, ts, "POST", "/api/sync/push", token, map[string]any{"ops": ops}, 200)
}

func rolePayload(id, name string) map[string]any {
	return map[string]any{
		"id": id, "name": name, "avatar": "📝", "color": "#ff0000",
		"pinned": true, "hidden": false, "created_at": nowUTC(), "updated_at": nowUTC(),
	}
}

func msgPayload(id, roleID, typ, text string) map[string]any {
	return map[string]any{
		"id": id, "role_id": roleID, "type": typ, "text": text, "attachment_ref": "",
		"side": "right", "todo_done": false, "created_at": nowUTC(), "updated_at": nowUTC(),
	}
}

func testPNG(t *testing.T, w, h int) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			img.Set(x, y, color.RGBA{uint8(x % 256), uint8(y % 256), 128, 255})
		}
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func uploadBlob(t *testing.T, ts *httptest.Server, token, filename string, data []byte, hash string) *http.Response {
	t.Helper()
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	fw, err := mw.CreateFormFile("file", filename)
	if err != nil {
		t.Fatal(err)
	}
	fw.Write(data)
	mw.WriteField("hash", hash)
	mw.Close()
	return rawDo(t, ts, "POST", "/api/blobs", token, buf.Bytes(), mw.FormDataContentType())
}

func sha256hex(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

func TestBootstrapLoginMe(t *testing.T) {
	_, ts := newTestServer(t)
	token, deviceID := bootstrapAdmin(t, ts)
	if token == "" || deviceID == "" {
		t.Fatal("empty token/device")
	}
	jsonDo(t, ts, "POST", "/api/auth/bootstrap", "", map[string]any{"username": "x", "password": "y"}, 409)
	jsonDo(t, ts, "POST", "/api/auth/login", "", map[string]any{
		"username": "admin", "password": "wrong", "device_id": uuid.NewString(), "device_name": "d",
	}, 401)
	login := jsonDo(t, ts, "POST", "/api/auth/login", "", map[string]any{
		"username": "admin", "password": "admin-pw-123", "device_id": uuid.NewString(), "device_name": "手机",
	}, 200)
	if login["token"].(string) == "" {
		t.Fatal("login token empty")
	}
	if login["user"].(map[string]any)["is_admin"] != true {
		t.Fatal("expected admin")
	}
	jsonDo(t, ts, "GET", "/api/me", "", nil, 401)
	me := jsonDo(t, ts, "GET", "/api/me", token, nil, 200)
	if me["quota_bytes"].(float64) != 5*1024*1024*1024 || me["used_bytes"].(float64) != 0 {
		t.Fatalf("bad me: %v", me)
	}
	jsonDo(t, ts, "POST", "/api/auth/password", token, map[string]any{"old": "wrong", "new": "n"}, 401)
	jsonDo(t, ts, "POST", "/api/auth/password", token, map[string]any{"old": "admin-pw-123", "new": "new-pw-456"}, 200)
	jsonDo(t, ts, "POST", "/api/auth/login", "", map[string]any{"username": "admin", "password": "admin-pw-123"}, 401)
	jsonDo(t, ts, "POST", "/api/auth/login", "", map[string]any{"username": "admin", "password": "new-pw-456"}, 200)
}

func TestAdminUsers(t *testing.T) {
	_, ts := newTestServer(t)
	token, _ := bootstrapAdmin(t, ts)
	created := jsonDo(t, ts, "POST", "/api/users", token, map[string]any{"username": "bob", "password": "bob-pw"}, 200)
	bobID := created["id"].(string)
	users := jsonList(t, ts, "GET", "/api/users", token, 200)
	if len(users) != 2 {
		t.Fatalf("want 2 users got %d", len(users))
	}
	bobLogin := jsonDo(t, ts, "POST", "/api/auth/login", "", map[string]any{"username": "bob", "password": "bob-pw"}, 200)
	bobToken := bobLogin["token"].(string)
	if bobLogin["user"].(map[string]any)["is_admin"] != false {
		t.Fatal("bob should not be admin")
	}
	resp403 := rawDo(t, ts, "GET", "/api/users", bobToken, nil, "")
	resp403.Body.Close()
	if resp403.StatusCode != 403 {
		t.Fatalf("bob list users: want 403 got %d", resp403.StatusCode)
	}
	jsonDo(t, ts, "POST", "/api/users", bobToken, map[string]any{"username": "x", "password": "y"}, 403)
	jsonDo(t, ts, "POST", "/api/users/"+bobID+"/reset", token, map[string]any{"password": "bob-new"}, 200)
	jsonDo(t, ts, "GET", "/api/me", bobToken, nil, 401)
	jsonDo(t, ts, "POST", "/api/auth/login", "", map[string]any{"username": "bob", "password": "bob-pw"}, 401)
	bobLogin2 := jsonDo(t, ts, "POST", "/api/auth/login", "", map[string]any{"username": "bob", "password": "bob-new"}, 200)
	bobToken2 := bobLogin2["token"].(string)
	jsonDo(t, ts, "POST", "/api/users/"+bobID+"/disable", token, map[string]any{"disabled": true}, 200)
	jsonDo(t, ts, "GET", "/api/me", bobToken2, nil, 401)
	jsonDo(t, ts, "POST", "/api/auth/login", "", map[string]any{"username": "bob", "password": "bob-new"}, 401)
	jsonDo(t, ts, "POST", "/api/users/"+bobID+"/disable", token, map[string]any{"disabled": false}, 200)
	jsonDo(t, ts, "POST", "/api/auth/login", "", map[string]any{"username": "bob", "password": "bob-new"}, 200)
	jsonDo(t, ts, "POST", "/api/users", token, map[string]any{"username": "bob", "password": "x"}, 409)
}

func TestSyncPushPullCursorIdempotency(t *testing.T) {
	_, ts := newTestServer(t)
	token, deviceID := bootstrapAdmin(t, ts)
	roleID, m1, m2 := uuid.NewString(), uuid.NewString(), uuid.NewString()
	ops := []map[string]any{
		mkOp("role.create", rolePayload(roleID, "随手记")),
		mkOp("message.create", msgPayload(m1, roleID, "text", "第一条")),
		mkOp("message.create", msgPayload(m2, roleID, "text", "第二条")),
	}
	res := pushOps(t, ts, token, deviceID, ops...)
	applied := res["applied"].([]any)
	if len(applied) != 3 || res["server_cursor"].(float64) != 3 {
		t.Fatalf("bad push result: %v", res)
	}
	for i, a := range applied {
		if a.(map[string]any)["cursor"].(float64) != float64(i+1) {
			t.Fatalf("cursors not sequential: %v", applied)
		}
	}
	res2 := pushOps(t, ts, token, deviceID, ops...)
	if res2["server_cursor"].(float64) != 3 {
		t.Fatal("duplicate ops advanced cursor")
	}
	for i, a := range res2["applied"].([]any) {
		if a.(map[string]any)["cursor"].(float64) != float64(i+1) {
			t.Fatal("duplicate op got new cursor")
		}
	}
	pull := jsonDo(t, ts, "GET", "/api/sync/pull?cursor=0&limit=2", token, nil, 200)
	if len(pull["ops"].([]any)) != 2 || pull["has_more"] != true {
		t.Fatalf("bad page 1: %v", pull)
	}
	pull2 := jsonDo(t, ts, "GET", "/api/sync/pull?cursor=2", token, nil, 200)
	if len(pull2["ops"].([]any)) != 1 || pull2["has_more"] != false {
		t.Fatalf("bad page 2: %v", pull2)
	}
	op := pull2["ops"].([]any)[0].(map[string]any)
	if op["payload"].(map[string]any)["text"] != "第二条" || op["accepted_at"] == "" {
		t.Fatalf("bad pulled op: %v", op)
	}
	bad := mkOp("message.create", msgPayload(uuid.NewString(), roleID, "video", "x"))
	resp := rawDo(t, ts, "POST", "/api/sync/push", token,
		mustJSON(t, map[string]any{"ops": []map[string]any{bad}}), "application/json")
	resp.Body.Close()
	if resp.StatusCode != 400 {
		t.Fatalf("invalid type: want 400 got %d", resp.StatusCode)
	}
	pull3 := jsonDo(t, ts, "GET", "/api/sync/pull?cursor=0", token, nil, 200)
	if pull3["server_cursor"].(float64) != 3 {
		t.Fatal("failed push was not rolled back")
	}
	foreign := mkOp("role.create", rolePayload(uuid.NewString(), "x"))
	foreign["device_id"] = uuid.NewString()
	foreign["seq"] = 1
	resp = rawDo(t, ts, "POST", "/api/sync/push", token,
		mustJSON(t, map[string]any{"ops": []map[string]any{foreign}}), "application/json")
	resp.Body.Close()
	if resp.StatusCode != 400 {
		t.Fatalf("foreign device: want 400 got %d", resp.StatusCode)
	}
}

func mustJSON(t *testing.T, v any) []byte {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func TestLWWAndTombstone(t *testing.T) {
	_, ts := newTestServer(t)
	token, deviceID := bootstrapAdmin(t, ts)
	roleID, mid := uuid.NewString(), uuid.NewString()
	pushOps(t, ts, token, deviceID,
		mkOp("role.create", rolePayload(roleID, "灵感")),
		mkOp("message.create", msgPayload(mid, roleID, "todo", "原始待办")),
	)
	pushOps(t, ts, token, deviceID, mkOp("message.update", map[string]any{
		"id": mid, "updated_at": "2030-01-01T00:00:00Z", "fields": map[string]any{"text": "先接受但时钟靠后"},
	}))
	pushOps(t, ts, token, deviceID, mkOp("message.update", map[string]any{
		"id": mid, "updated_at": "2020-01-01T00:00:00Z", "fields": map[string]any{"text": "后接受的赢"},
	}))
	pushOps(t, ts, token, deviceID, mkOp("todo.set_done", map[string]any{
		"id": mid, "done": true, "updated_at": nowUTC(),
	}))
	pushOps(t, ts, token, deviceID, mkOp("role.update", map[string]any{
		"id": roleID, "updated_at": nowUTC(), "fields": map[string]any{"name": "改名了", "pinned": false},
	}))
	exp := jsonDo(t, ts, "GET", "/api/export?format=json", token, nil, 200)
	msgs := exp["messages"].([]any)
	if len(msgs) != 1 {
		t.Fatalf("want 1 message got %d", len(msgs))
	}
	m := msgs[0].(map[string]any)
	if m["text"] != "后接受的赢" {
		t.Fatalf("LWW violated (server cursor order must win): %v", m["text"])
	}
	if m["todo_done"] != true {
		t.Fatal("todo_done not applied")
	}
	ro := exp["roles"].([]any)[0].(map[string]any)
	if ro["name"] != "改名了" || ro["pinned"] != false {
		t.Fatalf("role.update not applied: %v", ro)
	}
	pushOps(t, ts, token, deviceID, mkOp("message.delete", map[string]any{"id": mid, "updated_at": nowUTC()}))
	exp2 := jsonDo(t, ts, "GET", "/api/export?format=json", token, nil, 200)
	if len(exp2["messages"].([]any)) != 0 {
		t.Fatal("tombstoned message still in export")
	}
	search := jsonDo(t, ts, "GET", "/api/search?q="+urlQuery("后接受"), token, nil, 200)
	if len(search["results"].([]any)) != 0 {
		t.Fatal("tombstoned message still searchable")
	}
	pull := jsonDo(t, ts, "GET", "/api/sync/pull?cursor=0", token, nil, 200)
	found := false
	for _, o := range pull["ops"].([]any) {
		if o.(map[string]any)["type"] == "message.delete" {
			found = true
		}
	}
	if !found {
		t.Fatal("tombstone op missing from log")
	}
	pushOps(t, ts, token, deviceID, mkOp("role.delete", map[string]any{"id": roleID, "updated_at": nowUTC()}))
	exp3 := jsonDo(t, ts, "GET", "/api/export?format=json", token, nil, 200)
	if len(exp3["roles"].([]any)) != 0 {
		t.Fatal("tombstoned role still in export")
	}
}

func urlQuery(s string) string {
	return strings.ReplaceAll(strings.ReplaceAll(s, "%", "%25"), " ", "%20")
}

func TestPerUserIsolation(t *testing.T) {
	_, ts := newTestServer(t)
	token, deviceID := bootstrapAdmin(t, ts)
	jsonDo(t, ts, "POST", "/api/users", token, map[string]any{"username": "eve", "password": "eve-pw"}, 200)
	eveLogin := jsonDo(t, ts, "POST", "/api/auth/login", "", map[string]any{
		"username": "eve", "password": "eve-pw", "device_id": uuid.NewString(), "device_name": "eve设备",
	}, 200)
	eveToken := eveLogin["token"].(string)
	eveDevice := eveLogin["device_id"].(string)

	roleID, mid := uuid.NewString(), uuid.NewString()
	pushOps(t, ts, token, deviceID,
		mkOp("role.create", rolePayload(roleID, "私密角色")),
		mkOp("message.create", msgPayload(mid, roleID, "text", "私密日记内容")),
	)
	pngData := testPNG(t, 64, 64)
	hash := sha256hex(pngData)
	up := uploadBlob(t, ts, token, "x.png", pngData, hash)
	up.Body.Close()
	if up.StatusCode != 200 {
		t.Fatalf("upload: %d", up.StatusCode)
	}

	pull := jsonDo(t, ts, "GET", "/api/sync/pull?cursor=0", eveToken, nil, 200)
	if len(pull["ops"].([]any)) != 0 {
		t.Fatal("eve sees admin ops")
	}
	search := jsonDo(t, ts, "GET", "/api/search?q="+urlQuery("私密日记"), eveToken, nil, 200)
	if len(search["results"].([]any)) != 0 {
		t.Fatal("eve sees admin messages in search")
	}
	exp := jsonDo(t, ts, "GET", "/api/export?format=json", eveToken, nil, 200)
	if len(exp["roles"].([]any)) != 0 || len(exp["messages"].([]any)) != 0 || len(exp["attachments"].([]any)) != 0 {
		t.Fatal("eve sees admin data in export")
	}
	resp := rawDo(t, ts, "GET", "/api/blobs/"+hash, eveToken, nil, "")
	resp.Body.Close()
	if resp.StatusCode != 404 {
		t.Fatalf("eve read admin blob: %d", resp.StatusCode)
	}
	foreignOp := mkOp("role.create", rolePayload(uuid.NewString(), "x"))
	foreignOp["device_id"] = deviceID
	foreignOp["seq"] = 1
	resp = rawDo(t, ts, "POST", "/api/sync/push", eveToken,
		mustJSON(t, map[string]any{"ops": []map[string]any{foreignOp}}), "application/json")
	resp.Body.Close()
	if resp.StatusCode != 400 {
		t.Fatalf("eve pushed with admin device: %d", resp.StatusCode)
	}
	eveRole := uuid.NewString()
	pushOps(t, ts, eveToken, eveDevice, mkOp("role.create", rolePayload(eveRole, "eve的角色")))
	adminPull := jsonDo(t, ts, "GET", "/api/sync/pull?cursor=0", token, nil, 200)
	for _, o := range adminPull["ops"].([]any) {
		if o.(map[string]any)["device_id"] == eveDevice {
			t.Fatal("admin sees eve ops")
		}
	}
	if len(adminPull["ops"].([]any)) != 2 {
		t.Fatalf("admin pull count: %d", len(adminPull["ops"].([]any)))
	}
}

func TestDeviceRevocation(t *testing.T) {
	_, ts := newTestServer(t)
	token, _ := bootstrapAdmin(t, ts)
	deviceB := uuid.NewString()
	loginB := jsonDo(t, ts, "POST", "/api/auth/login", "", map[string]any{
		"username": "admin", "password": "admin-pw-123", "device_id": deviceB, "device_name": "B",
	}, 200)
	tokenB := loginB["token"].(string)
	devices := jsonList(t, ts, "GET", "/api/devices", token, 200)
	if len(devices) != 2 {
		t.Fatalf("want 2 devices got %d", len(devices))
	}
	currents := 0
	for _, d := range devices {
		if d.(map[string]any)["current"] == true {
			currents++
		}
	}
	if currents != 1 {
		t.Fatal("current flag wrong")
	}
	jsonDo(t, ts, "DELETE", "/api/devices/"+deviceB, token, nil, 200)
	jsonDo(t, ts, "GET", "/api/me", tokenB, nil, 401)
	op := mkOp("role.create", rolePayload(uuid.NewString(), "x"))
	op["device_id"] = deviceB
	op["seq"] = 1
	resp := rawDo(t, ts, "POST", "/api/sync/push", token,
		mustJSON(t, map[string]any{"ops": []map[string]any{op}}), "application/json")
	resp.Body.Close()
	if resp.StatusCode != 400 {
		t.Fatalf("push via revoked device: %d", resp.StatusCode)
	}
	jsonDo(t, ts, "DELETE", "/api/devices/"+uuid.NewString(), token, nil, 404)
	jsonDo(t, ts, "GET", "/api/me", token, nil, 200)
}

func TestDeviceFingerprintReidentity(t *testing.T) {
	_, ts := newTestServer(t)
	fp := "Safari|iPhone|402x874|Asia/Shanghai|zh-CN|6|5"
	first := jsonDo(t, ts, "POST", "/api/auth/bootstrap", "", map[string]any{
		"username": "admin", "password": "admin-pw-123", "device_id": uuid.NewString(),
		"device_name": "iPhone 浏览器", "device_fingerprint": fp,
	}, 200)
	token := first["token"].(string)
	devID := first["device_id"].(string)

	// 浏览器存储被清空：id 全新、指纹不变 → 认回同一行
	again := jsonDo(t, ts, "POST", "/api/auth/login", "", map[string]any{
		"username": "admin", "password": "admin-pw-123", "device_id": uuid.NewString(),
		"device_name": "iPhone 浏览器", "device_fingerprint": fp,
	}, 200)
	if again["device_id"].(string) != devID {
		t.Fatalf("fingerprint re-identity: want %s got %s", devID, again["device_id"])
	}
	if n := len(jsonList(t, ts, "GET", "/api/devices", token, 200)); n != 1 {
		t.Fatalf("want 1 device got %d", n)
	}

	// 另一台设备：指纹不同 → 独立一行
	other := jsonDo(t, ts, "POST", "/api/auth/login", "", map[string]any{
		"username": "admin", "password": "admin-pw-123", "device_id": uuid.NewString(),
		"device_name": "Win32 浏览器", "device_fingerprint": "Chrome|Win32|1440x2560|Asia/Shanghai|zh-CN|16|0",
	}, 200)
	if other["device_id"].(string) == devID {
		t.Fatal("different fingerprint must not share a device")
	}
	if n := len(jsonList(t, ts, "GET", "/api/devices", token, 200)); n != 2 {
		t.Fatalf("want 2 devices got %d", n)
	}

	// 设备行仍归原主：别的账号拿这个 id 登录要被拒
	jsonDo(t, ts, "POST", "/api/users", token, map[string]any{"username": "u2", "password": "pw123456"}, 200)
	jsonDo(t, ts, "POST", "/api/auth/login", "", map[string]any{
		"username": "u2", "password": "pw123456", "device_id": devID, "device_name": "iPhone 浏览器",
	}, 400)
}

func TestDeviceLegacyAdoption(t *testing.T) {
	_, ts := newTestServer(t)
	token, legacyID := bootstrapAdmin(t, ts)
	fp := "Safari|iPhone|402x874|Asia/Shanghai|zh-CN|6|5"
	res := jsonDo(t, ts, "POST", "/api/auth/login", "", map[string]any{
		"username": "admin", "password": "admin-pw-123", "device_id": uuid.NewString(),
		"device_name": "测试设备", "device_fingerprint": fp,
	}, 200)
	if res["device_id"].(string) != legacyID {
		t.Fatalf("legacy row not adopted: want %s got %s", legacyID, res["device_id"])
	}
	// 认领后指纹已落库，再换 id 也认得回来
	res2 := jsonDo(t, ts, "POST", "/api/auth/login", "", map[string]any{
		"username": "admin", "password": "admin-pw-123", "device_id": uuid.NewString(),
		"device_name": "测试设备", "device_fingerprint": fp,
	}, 200)
	if res2["device_id"].(string) != legacyID {
		t.Fatal("fingerprint not persisted on adoption")
	}
	if n := len(jsonList(t, ts, "GET", "/api/devices", token, 200)); n != 1 {
		t.Fatalf("want 1 device got %d", n)
	}
	jsonDo(t, ts, "GET", "/api/me", token, nil, 200)
}

func TestMergeLegacyDevices(t *testing.T) {
	s, ts := newTestServer(t)
	token, keep := bootstrapAdmin(t, ts)
	var userID string
	if err := s.db.QueryRow(`SELECT user_id FROM devices WHERE id = ?`, keep).Scan(&userID); err != nil {
		t.Fatal(err)
	}
	old := "2026-11-07T20:00:00Z"
	staleTokens := []string{}
	for i := 0; i < 3; i++ {
		id := uuid.NewString()
		if _, err := s.db.Exec(`INSERT INTO devices(id, user_id, name, last_seq, last_seen) VALUES(?,?,?,?,?)`,
			id, userID, "测试设备", 2, old); err != nil {
			t.Fatal(err)
		}
		tok := fmt.Sprintf("stale-token-%d", i)
		staleTokens = append(staleTokens, tok)
		if _, err := s.db.Exec(`INSERT INTO sessions(token_hash, user_id, device_id, created_at) VALUES(?,?,?,?)`,
			hashToken(tok), userID, id, old); err != nil {
			t.Fatal(err)
		}
	}
	// 有指纹的行即使同名也不该被合并
	fpID := uuid.NewString()
	s.db.Exec(`INSERT INTO devices(id, user_id, name, fingerprint, last_seen) VALUES(?,?,?,?,?)`,
		fpID, userID, "测试设备", "Chrome|Win32|1440x2560|Asia/Shanghai|zh-CN|16|0", old)

	mergeLegacyDevices(s.db)

	var n int
	s.db.QueryRow(`SELECT COUNT(*) FROM devices WHERE user_id = ?`, userID).Scan(&n)
	if n != 2 {
		t.Fatalf("want survivor + fingerprinted row = 2, got %d", n)
	}
	s.db.QueryRow(`SELECT COUNT(*) FROM devices WHERE id = ?`, keep).Scan(&n)
	if n != 1 {
		t.Fatal("most recently seen row must survive")
	}
	s.db.QueryRow(`SELECT last_seq FROM devices WHERE id = ?`, keep).Scan(&n)
	if n != 2 {
		t.Fatalf("last_seq not carried over: %d", n)
	}
	for _, tok := range staleTokens {
		jsonDo(t, ts, "GET", "/api/me", tok, nil, 200)
	}
	devices := jsonList(t, ts, "GET", "/api/devices", token, 200)
	if len(devices) != 2 {
		t.Fatalf("devices list: want 2 got %d", len(devices))
	}
	mergeLegacyDevices(s.db)
	s.db.QueryRow(`SELECT COUNT(*) FROM devices WHERE user_id = ?`, userID).Scan(&n)
	if n != 2 {
		t.Fatalf("merge must be idempotent, got %d", n)
	}
}

func TestBlobs(t *testing.T) {
	s, ts := newTestServer(t)
	token, _ := bootstrapAdmin(t, ts)
	pngData := testPNG(t, 1000, 600)
	hash := sha256hex(pngData)

	resp := uploadBlob(t, ts, token, "img.png", pngData, sha256hex([]byte("different")))
	resp.Body.Close()
	if resp.StatusCode != 400 {
		t.Fatalf("hash mismatch: want 400 got %d", resp.StatusCode)
	}
	resp = uploadBlob(t, ts, token, "img.png", pngData, hash)
	raw, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Fatalf("upload: %d %s", resp.StatusCode, raw)
	}
	var meta map[string]any
	json.Unmarshal(raw, &meta)
	if meta["kind"] != "image" || meta["thumb_hash"] == "" || meta["size"].(float64) != float64(len(pngData)) {
		t.Fatalf("bad meta: %v", meta)
	}
	orig := rawDo(t, ts, "GET", "/api/blobs/"+hash, token, nil, "")
	got, _ := io.ReadAll(orig.Body)
	orig.Body.Close()
	if !bytes.Equal(got, pngData) || !strings.HasPrefix(orig.Header.Get("Content-Type"), "image/png") {
		t.Fatal("original blob mismatch")
	}
	thumb := rawDo(t, ts, "GET", "/api/blobs/"+hash+"?variant=thumb", token, nil, "")
	thumbData, _ := io.ReadAll(thumb.Body)
	thumb.Body.Close()
	if thumb.StatusCode != 200 {
		t.Fatalf("thumb: %d", thumb.StatusCode)
	}
	img, _, err := image.Decode(bytes.NewReader(thumbData))
	if err != nil {
		t.Fatalf("thumb decode: %v", err)
	}
	b := img.Bounds()
	if b.Dx() > 512 || b.Dy() > 512 || (b.Dx() != 512 && b.Dy() != 512) {
		t.Fatalf("thumb size wrong: %dx%d", b.Dx(), b.Dy())
	}
	resp = uploadBlob(t, ts, token, "img.png", pngData, hash)
	resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Fatal("re-upload should be idempotent")
	}
	me := jsonDo(t, ts, "GET", "/api/me", token, nil, 200)
	if me["used_bytes"].(float64) != float64(len(pngData)) {
		t.Fatal("re-upload double counted quota")
	}
	txt := []byte("hello file")
	resp = uploadBlob(t, ts, token, "note.txt", txt, sha256hex(txt))
	raw, _ = io.ReadAll(resp.Body)
	resp.Body.Close()
	json.Unmarshal(raw, &meta)
	if resp.StatusCode != 200 || meta["kind"] != "file" {
		t.Fatalf("file upload: %d %v", resp.StatusCode, meta)
	}
	s.db.Exec(`UPDATE users SET quota_bytes = ? WHERE username = 'admin'`, len(pngData)+len(txt))
	extra := []byte("one byte over quota")
	resp = uploadBlob(t, ts, token, "over.bin", extra, sha256hex(extra))
	resp.Body.Close()
	if resp.StatusCode != 507 {
		t.Fatalf("quota: want 507 got %d", resp.StatusCode)
	}
	big := bytes.Repeat([]byte("a"), maxAttachment+1)
	resp = uploadBlob(t, ts, token, "big.bin", big, sha256hex(big))
	resp.Body.Close()
	if resp.StatusCode != 413 && resp.StatusCode != 400 {
		t.Fatalf("oversize: want 413/400 got %d", resp.StatusCode)
	}
	jsonDo(t, ts, "GET", "/api/blobs/"+strings.Repeat("0", 64), token, nil, 404)
}

func TestSearchChinese(t *testing.T) {
	s, ts := newTestServer(t)
	t.Logf("FTS5 trigram enabled: %v", s.fts)
	token, deviceID := bootstrapAdmin(t, ts)
	roleID := uuid.NewString()
	pngData := testPNG(t, 32, 32)
	hash := sha256hex(pngData)
	up := uploadBlob(t, ts, token, "p.png", pngData, hash)
	up.Body.Close()
	m1, m2, m3 := uuid.NewString(), uuid.NewString(), uuid.NewString()
	pushOps(t, ts, token, deviceID,
		mkOp("role.create", rolePayload(roleID, "随手记")),
		mkOp("message.create", msgPayload(m1, roleID, "text", "今天天气很好，适合出去散步")),
		mkOp("message.create", msgPayload(m2, roleID, "text", "明天去爬山看日出")),
		mkOp("message.create", msgPayload(m3, roleID, "text", "天气变冷了要多穿衣服")),
	)
	cases := []struct {
		q    string
		want int
	}{
		{"天气", 2},
		{"适合出去", 1},
		{"气很", 1},
		{"爬山看日", 1},
		{"不存在的词", 0},
		{"天", 3},
	}
	for _, c := range cases {
		res := jsonDo(t, ts, "GET", "/api/search?q="+urlQuery(c.q), token, nil, 200)
		results := res["results"].([]any)
		if len(results) != c.want {
			t.Fatalf("q=%q: want %d got %d (%v)", c.q, c.want, len(results), results)
		}
		for _, r := range results {
			rm := r.(map[string]any)
			if rm["role_name"] != "随手记" || rm["snippet"] == "" {
				t.Fatalf("bad result fields: %v", rm)
			}
		}
	}
	pushOps(t, ts, token, deviceID, mkOp("message.delete", map[string]any{"id": m1, "updated_at": nowUTC()}))
	res := jsonDo(t, ts, "GET", "/api/search?q="+urlQuery("天气"), token, nil, 200)
	if len(res["results"].([]any)) != 1 {
		t.Fatal("deleted message in search results")
	}
	jsonDo(t, ts, "GET", "/api/search?q=", token, nil, 400)
}

func TestExportFormats(t *testing.T) {
	_, ts := newTestServer(t)
	token, deviceID := bootstrapAdmin(t, ts)
	roleID := uuid.NewString()
	pngData := testPNG(t, 40, 40)
	hash := sha256hex(pngData)
	up := uploadBlob(t, ts, token, "p.png", pngData, hash)
	up.Body.Close()
	if up.StatusCode != 200 {
		t.Fatalf("upload: %d", up.StatusCode)
	}
	imgMsg := msgPayload(uuid.NewString(), roleID, "image", "图片说明")
	imgMsg["attachment_ref"] = hash
	pushOps(t, ts, token, deviceID,
		mkOp("role.create", rolePayload(roleID, "灵感")),
		mkOp("message.create", msgPayload(uuid.NewString(), roleID, "text", "一条文本记录")),
		mkOp("message.create", msgPayload(uuid.NewString(), roleID, "todo", "买牛奶")),
		mkOp("message.create", imgMsg),
	)
	exp := jsonDo(t, ts, "GET", "/api/export?format=json", token, nil, 200)
	if exp["user"].(map[string]any)["username"] != "admin" {
		t.Fatal("export user wrong")
	}
	if len(exp["roles"].([]any)) != 1 || len(exp["messages"].([]any)) != 3 || len(exp["attachments"].([]any)) != 1 {
		t.Fatalf("export json counts wrong: %v", exp)
	}
	mdResp := rawDo(t, ts, "GET", "/api/export?format=md", token, nil, "")
	md, _ := io.ReadAll(mdResp.Body)
	mdResp.Body.Close()
	for _, want := range []string{"灵感", "一条文本记录", "买牛奶", "![image](blobs/" + hash + ")"} {
		if !strings.Contains(string(md), want) {
			t.Fatalf("md missing %q", want)
		}
	}
	zipResp := rawDo(t, ts, "GET", "/api/export?format=zip", token, nil, "")
	zdata, _ := io.ReadAll(zipResp.Body)
	zipResp.Body.Close()
	zr, err := zip.NewReader(bytes.NewReader(zdata), int64(len(zdata)))
	if err != nil {
		t.Fatalf("zip: %v", err)
	}
	files := map[string][]byte{}
	for _, f := range zr.File {
		rc, _ := f.Open()
		files[f.Name], _ = io.ReadAll(rc)
		rc.Close()
	}
	if _, ok := files["data.json"]; !ok {
		t.Fatal("zip missing data.json")
	}
	if _, ok := files["data.md"]; !ok {
		t.Fatal("zip missing data.md")
	}
	if !bytes.Equal(files["blobs/"+hash], pngData) {
		t.Fatal("zip blob content mismatch")
	}
	jsonDo(t, ts, "GET", "/api/export?format=xml", token, nil, 400)
}

func TestStaticSPA(t *testing.T) {
	s, ts := newTestServer(t)
	resp := rawDo(t, ts, "GET", "/", "", nil, "")
	resp.Body.Close()
	if resp.StatusCode != 404 {
		t.Fatalf("no web dir should 404, got %d", resp.StatusCode)
	}
	webDir := t.TempDir()
	os.WriteFile(filepath.Join(webDir, "index.html"), []byte("<html>app-shell</html>"), 0o644)
	os.WriteFile(filepath.Join(webDir, "asset.js"), []byte("console.log(1)"), 0o644)
	s.webDir = webDir
	cases := []struct{ path, want string }{
		{"/", "app-shell"},
		{"/chat/some-role", "app-shell"},
		{"/asset.js", "console.log(1)"},
	}
	for _, c := range cases {
		resp := rawDo(t, ts, "GET", c.path, "", nil, "")
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		if resp.StatusCode != 200 || !strings.Contains(string(body), c.want) {
			t.Fatalf("GET %s: %d %s", c.path, resp.StatusCode, body)
		}
	}
	resp = rawDo(t, ts, "GET", "/api/nope", "", nil, "")
	body, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.StatusCode != 404 || !strings.Contains(string(body), `"error"`) {
		t.Fatalf("unknown api should be json 404: %d %s", resp.StatusCode, body)
	}
}

func TestUpdateBeforeCreateSkeleton(t *testing.T) {
	_, ts := newTestServer(t)
	token, deviceID := bootstrapAdmin(t, ts)
	roleID, mid := uuid.NewString(), uuid.NewString()
	pushOps(t, ts, token, deviceID,
		mkOp("message.update", map[string]any{"id": mid, "updated_at": nowUTC(), "fields": map[string]any{"text": "先到的更新"}}),
		mkOp("role.create", rolePayload(roleID, "后到的角色")),
		mkOp("message.create", msgPayload(mid, roleID, "text", "后到的创建")),
	)
	exp := jsonDo(t, ts, "GET", "/api/export?format=json", token, nil, 200)
	msgs := exp["messages"].([]any)
	if len(msgs) != 1 || msgs[0].(map[string]any)["text"] != "后到的创建" {
		t.Fatalf("create after update should overwrite: %v", msgs)
	}
}
