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
- `role.create` payload: `{id,name,avatar,color,pinned,hidden,created_at,updated_at}`
  - avatar = emoji 字符串或 blob hash；color = css color 字符串。
- `role.update` payload: `{id,updated_at,fields:{name?,avatar?,color?,pinned?,hidden?}}`
- `role.delete` payload: `{id,updated_at}` → tombstone(deleted=true)
- `message.create` payload: `{id,role_id,type:"text"|"image"|"todo",text,attachment_ref,side:"right"|"left",todo_done,created_at,updated_at}`
  - type=image 时 attachment_ref=blob hash，text 可为 caption/空。
  - type=todo 时 todo_done 初始 false。
- `message.update` payload: `{id,updated_at,fields:{text?,todo_done?}}`
- `message.delete` payload: `{id,updated_at}` → tombstone
- `todo.set_done` payload: `{id,done,updated_at}`
- 投影合并：create=insert；update/set_done=按 cursor 顺序覆盖 fields（LWW）；delete=deleted=true。
- 查询默认过滤 deleted=true（tombstone 保留供同步收敛）。

## 3. 附件 blob（与 op-log 分离）
- `POST /api/blobs` multipart：field `file`（二进制）+ field `hash`（客户端 sha256 hex）。
  - 校验：hash 匹配、size<=20MB、用户配额 5GB（used+size<=quota）。
  - 存原图；若 mime 为 image/* 生成缩略图（最长边 512）。
  - → `{hash,size,mime,kind:"image"|"audio"|"file",thumb_hash}`（非 image 时 thumb_hash=hash 或空）。
- `GET /api/blobs/{hash}` → 原二进制（正确 Content-Type）。
- `GET /api/blobs/{hash}?variant=thumb` → 缩略图（无缩略图时回原图）。
- 所有权：仅本用户可读写自己的 blob。
- 离线：客户端先存本地 blob 缓存 + 待传队列，联网补传后再 push 引用它的 message.create。

## 4. 搜索（服务端全文，中文友好）
- `GET /api/search?q=<text>` → `{results:[{message_id,role_id,role_name,text,created_at,snippet}]}`
- SQLite FTS5 trigram（子串匹配中文）；过滤 deleted + per-user；按 created_at  desc；limit 50。
- 客户端离线兜底：本地投影 substring 过滤。

## 5. 导出
- `GET /api/export?format=json` → JSON 文档 {user,roles,messages,attachments:[{hash,size,mime}]}。
- `GET /api/export?format=md` → Markdown（按角色/日期分组）。
- `GET /api/export?format=zip` → zip（含 data.json + data.md + blobs/<hash> 原图）。
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
- pull 默认 limit=500。