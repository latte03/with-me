# with-me 同步 / API 协议契约（v1，前后端共同遵守）

> 本文件是后端(Go)与前端(PWA)的唯一接口事实来源。二者并发开发，均以此为准。
> 传输：HTTP/JSON，Bearer token。v1 不做 WebSocket（客户端 online/focus/定时 轮询同步）。
> 命名空间：所有数据 per-user；服务端从 token 解析 user_id 强制过滤。

## 0. 通用
- Base: `/api`。成功 2xx；错误 `{ "error": "message" }` + 4xx/5xx。
- 认证头：`Authorization: Bearer <token>`。除 bootstrap/login 外全部需要。
- ID 一律客户端生成 uuid v4（role/message/op/device）。
- 时间：RFC3339 UTC 字符串（client_created_at/updated_at 由客户端给）。
- **LWW 规则（定死）**：可变字段以**服务端接受顺序（cursor）**为准——后接受的 op 覆盖先接受的。不依赖客户端时钟（避免多端时钟偏移）。即"后写覆盖"。
- 幂等：op_id 全局唯一；重复 push 同 op_id 不产生新 cursor。

## 1. 认证 / 用户 / 设备
- `POST /api/auth/bootstrap` {username,password} → 仅当系统零用户时成功；创建**管理员**。返回 {token, user:{id,username,is_admin}, device_id}。body 可带 device_id/device_name（客户端生成/提供）。
- `POST /api/auth/login` {username,password,device_id,device_name} → {token, user, device_id}。创建/复用 device 行 + session。
- `POST /api/auth/password` {old,new} → 200。
- `GET /api/me` → {user:{id,username,is_admin}, device_id, quota_bytes, used_bytes}。
- `GET /api/devices` → [{id,name,last_seen,revoked,current(bool)}]。
- `DELETE /api/devices/{id}` → 撤销（该设备 token 失效）。
- 管理员：
  - `GET /api/users` → [{id,username,is_admin,disabled,created_at}]
  - `POST /api/users` {username,password} → 建普通用户
  - `POST /api/users/{id}/reset` {password}
  - `POST /api/users/{id}/disable` {disabled(bool)}
- 密码 bcrypt 存储；token 为不透明随机串，存 sessions 表绑定 device。

## 2. 同步 op-log
- op 信封（客户端→服务端 push）：
  `{ op_id, device_id, seq, type, payload, client_created_at }`
  - seq = 该设备单调递增整数（客户端本地维护）。
- `POST /api/sync/push` {ops:[envelope…]} → `{ server_cursor, applied:[{op_id,cursor}] }`
  - 服务端按数组顺序处理；赋全局递增 cursor；写 ops 表 + 更新投影；去重 op_id。
  - 校验：device_id 须属于当前 user 且未撤销；payload 形状按 type 校验。
- `GET /api/sync/pull?cursor=N&limit=M` → `{ ops:[{cursor,op_id,device_id,seq,type,payload,client_created_at,accepted_at}], server_cursor, has_more }`
  - 返回 cursor>N 的 ops（升序），默认 limit=500；has_more 时客户端继续拉。
- 客户端流程：联网 → push 本地队列 → pull(本地cursor) 增量 → 应用投影（跳过已应用 op_id）→ 存 cursor。

### 2.1 op type 与 payload
- `role.create` payload: `{id,name,avatar,color,kind?,pinned,hidden,created_at,updated_at}`
  - avatar = emoji 字符串或 blob hash；color = css color 字符串；kind 仅允许 `''` 或 `'clips'`（内置剪藏角色标记）。
- `role.update` payload: `{id,updated_at,fields:{name?,avatar?,color?,kind?,pinned?,hidden?}}`
- `role.delete` payload: `{id,updated_at}` → tombstone(deleted=true)
- `message.create` payload: `{id,role_id,type:"text"|"image"|"todo"|"clip",text,attachment_ref,width?,height?,meta?,side:"right"|"left",todo_done,created_at,updated_at}`
  - type=image 时 attachment_ref=blob hash，text 可为 caption/空。
  - type=image 时可带 `width`/`height`（图片像素宽高，正整数）：供客户端按微信式比例预布局缩略图（零 CLS）；缺省时客户端在图片 onload 后用 naturalWidth/naturalHeight 回退计算。
  - type=todo 时 todo_done 初始 false。
  - **type=clip** 时 `meta` 必填，形状见 4.1；服务端校验 `platform`/`note_id` 与媒体 hash 归属，并维护 `clips` 去重投影。`text` 为标题+正文+作者+话题的可搜索纯文本。
- `message.update` payload: `{id,updated_at,fields:{text?,todo_done?,meta?}}`
  - `meta` 仅允许用于 type=clip 的消息；用于更新媒体 hash/下载状态。
- `message.delete` payload: `{id,updated_at}` → tombstone；同时删除该消息的 `clips` 去重映射。
- `todo.set_done` payload: `{id,done,updated_at}`
- 投影合并：create=insert；update/set_done=按 cursor 顺序覆盖 fields（LWW）；delete=deleted=true。
- 查询默认过滤 deleted=true（tombstone 保留供同步收敛）。

> **Additive 兼容（width/height）**：`message.create` 的 `width`/`height` 是可选 additive 字段，旧客户端与历史消息不带时按缺省处理，客户端 onload 回退布局，不影响既有同步。服务端 op-log 以原始 JSON 透传 payload（`message.create` 校验仅解析已知字段、忽略未知字段，不裁剪），pull 原样返回，客户端投影按 payload 原样存储（`{...payload}`），故该字段无需服务端 schema 变更即可端到端贯通。服务端 `messages` 投影表不单独持久化 width/height（仅 op-log 保留），导出/搜索不含该字段；缩略图布局完全由客户端从 op-log 投影读取。

## 3. 附件 blob（与 op-log 分离）
- `POST /api/blobs` multipart：field `file`（二进制）+ field `hash`（客户端 sha256 hex）。
  - 校验：hash 匹配、size<=20MB、用户配额 5GB（used+size<=quota）。
  - 存原图；若 mime 为 image/* 生成缩略图（最长边 512）。
  - → `{hash,size,mime,kind:"image"|"video"|"audio"|"file",thumb_hash}`。
- `GET /api/blobs/{hash}` → 原二进制（正确 Content-Type，支持 Range）。
- `GET /api/blobs/{hash}?variant=thumb` → 缩略图（无缩略图时回原图）。
- 视频流：`GET /api/blobs/{hash}?token=<session>`；仅 GET blob 接受 query token（`<video>` 无法带 Authorization 头）。服务端用 `http.ServeContent` 返回 `206 Partial Content`。
- 所有权：仅本用户可读写自己的 blob。
- 离线：客户端先存本地 blob 缓存 + 待传队列，联网补传后再 push 引用它的 message.create。
- 剪藏媒体由服务端下载入库：图片/封面 ≤30MB、实况 ≤60MB、视频 ≤200MB；域名白名单 `*.xhscdn.com`。

## 4. 搜索（服务端全文，中文友好）
- `GET /api/search?q=<text>` → `{results:[{message_id,role_id,role_name,text,created_at,snippet}]}`
- SQLite FTS5 trigram（子串匹配中文）；过滤 deleted + per-user；按 created_at  desc；limit 50。
- 客户端离线兜底：本地投影 substring 过滤。
- clip 消息的 `text` 含标题/正文/作者/话题，因此自动进入搜索。

### 4.1 链接剪藏（二期，v1 仅小红书）

`POST /api/clips/parse` body `{url}` → `{parse_id, existing_message_id?, clip}`。
- `url` 必须是 `xhslink.cn` / `xhslink.com` / `xiaohongshu.com` 分享链接；服务端带手机 UA 请求公开分享页（不登录、不填 Cookie）。
- 成功返回解析结果；解析结果在服务端内存缓存 15 分钟，供下载接口使用。
- `existing_message_id` 非空表示该 `platform+note_id` 已剪藏。
- 错误为 `{error:"中文提示"}`：链接失效/需要新 token、登录/风控、页面结构变化、网络失败等分类。

`clip` 形状（`ParsedClip`）：
```json
{
  "platform": "xhs",
  "note_id": "…",
  "source_url": "https://www.xiaohongshu.com/discovery/item/…?xsec_token=…&xsec_source=app_share",
  "note_type": "image|video",
  "title": "…",
  "body": "…",
  "author": {"user_id":"…","name":"…","avatar_url":"…"},
  "published_at": "RFC3339",
  "note_updated_at": "RFC3339",
  "stats": {"likes":"2.5万","collects":"3446","comments":"693","shares":"9276"},
  "tags": ["…"],
  "content_declaration": "含AI生成内容",
  "chapters": [{"text":"开场","time_ms":0}],
  "images": [{"file_id":"…","width":1904,"height":2544,"live":true,"live_size":900000,"preview_url":"…","watermarked":false}],
  "video": {"file_id":"…","width":1280,"height":720,"duration_ms":56820,"size":4359257,"cover_file_id":"…","cover_width":1920,"cover_height":1080,"preview_url":"…","watermarked":false}
}
```
- 图片 `preview_url` 仅用于预览（可能是 1080 带水印）；下载时才取无水印原图。
- `video` 仅视频笔记存在；`images` 在视频笔记中为空。

`POST /api/clips/download` body `{parse_id, image_indices:[…], video:bool}` →：
```json
{
  "images":[{"index":0,"status":"ok","hash":"…","live_status":"ok","live_hash":"…"}],
  "video":{"status":"ok","hash":"…","cover_hash":"…"}
}
```
- 逐项状态；失败的项带 `error`，不导致整条失败。
- 媒体下载域名仅 `*.xhscdn.com`；图片/封面 ≤30MB、实况 ≤60MB、视频 ≤200MB；计入 5GB 配额。
- 15 分钟后缓存过期返回 410，客户端需重新 parse。

`clip` 消息的 `meta`（客户端写入 op-log 的形状）：
```json
{
  "platform":"xhs","note_id":"…","source_url":"…","note_type":"image",
  "title":"…","body":"…",
  "author":{"user_id":"…","name":"…","avatar_url":"…"},
  "published_at":"…","note_updated_at":"…",
  "stats":{},"tags":[],"content_declaration":"","chapters":[],
  "media":[
    {"kind":"image","file_id":"…","width":1904,"height":2544,"source_index":0,
     "live":true,"live_size":900000,"status":"ok","hash":"…","live_status":"ok","live_hash":"…"},
    {"kind":"video","file_id":"…","width":1280,"height":720,"duration_ms":56820,"size":4359257,
     "cover_file_id":"…","cover_width":1920,"cover_height":1080,"status":"ok","hash":"…","cover_hash":"…"}
  ]
}
```
- `status/live_status`: `pending|ok|failed|skipped`；客户端先写 pending，下载成功后用 `message.update(fields.meta)` 回填 hash。
- 服务端校验 `meta` 内的 hash 必须属于当前用户。

## 5. 导出
- `GET /api/export?format=json` → JSON 文档 {user,roles,messages,attachments:[{hash,size,mime}]}；clip 消息带 `meta`。
- `GET /api/export?format=md` → Markdown（按角色/日期分组；clip 渲染标题/作者/正文/话题/原文/媒体链接）。
- `GET /api/export?format=zip` → zip（含 data.json + data.md + blobs/<hash> 原图/视频）。
- 仅本用户数据。

## 6. 静态 / SPA
- 服务端托管 `web/dist` 于 `/`（SPA fallback 到 index.html，/api 除外）。
- 开发期：vite dev server 代理 /api → Go server。
- Service Worker 由前端手写（precache app shell；/api 走 network）。

## 7. 日历 / 回顾统计
- 日历日/月聚合 = **客户端**从本地投影按 created_at 计算（离线可用），不走服务端。
- 回顾(AI) 二期，不在 v1 契约内。

## 8. 配额 / 限制常量
- MAX_ATTACHMENT=20*1024*1024；DEFAULT_QUOTA=5*1024*1024*1024（per-user，可配）。
- 剪藏：图片/封面 ≤30MB、实况 ≤60MB、视频 ≤200MB（服务端下载上限，可配）；parse 缓存 15 分钟。
- pull 默认 limit=500。