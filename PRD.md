# with-me / 与我 — 产品需求文档（PRD）

> 版本：v1.0（决策基线）
> 日期：2026-11-07
> 形态：本地优先（local-first）的"自己给自己发消息"记录应用；NAS 作同步中枢 + 存储 + 网页浏览。
> 本文档面向可直接驱动实现：含功能边界、数据模型、同步协议契约、架构、部署、安全、备份与里程碑。决策来源见附录 A。

---

## 1. 概述

### 1.1 背景与定位
用户希望有一个"自己给自己发消息"的地方：记录留存、瞬间灵感、情绪碎片。交互隐喻是**聊天**——每个"角色"是一条只属于自己的聊天流（如 随手记 / 灵感 / 情绪），用发消息的方式做记录，降低书写门槛。

在此基础上增加三个硬约束：
1. **本地优先**：没有网络也能记录，联网后再同步。
2. **跨端同步**：手机 / 桌面 / 网页多端一致。
3. **自托管**：飞牛 NAS（fnOS）作为同步服务 + 存储服务 + 网页浏览入口，数据不出自己的 NAS（除非用户主动开启外接 AI/ASR）。

### 1.2 核心价值
- 零门槛记录：像发微信一样给自己发一条。
- 离线可用：地铁 / 飞行模式照记，回家自动补齐。
- 数据自有：NAS 明文存储但认证隔离，备份 / 导出自助。
- 多端一致：PWA 一套代码全端，二期扩原生。

### 1.3 目标用户
- v1 即**多用户**：NAS 上的多个独立账号（本人 + 家人），每人只和自己聊，互不可见。
- 管理员 = 首个初始化账号，负责建号 / 重置 / 停用。

---

## 2. 目标与非目标

### 2.1 目标
- G1 离线可记、联网增量同步、多端最终一致（冲突 LWW 兜底）。
- G2 多用户隔离 + 应用自管账号。
- G3 NAS 提供同步 API + 存储 + 同一套 PWA 网页。
- G4 v1 覆盖：角色 / 文本 / 图片 / 待办 / 日历 / 搜索 / 离线同步。
- G5 数据可备份（每周轮转 3 份）、可导出（JSON/MD + 附件）。
- G6 同步协议语言中立、文档化，支撑二/三期原生客户端。

### 2.2 非目标（明确不做）
- N1 跨用户分享 / 社交 / 互发消息（v1 每人只和自己聊）。
- N2 端到端加密（E2EE）v1 不做；服务端明文 + 认证隔离；E2EE 留作后期可选。
- N3 公有云 SaaS / 多租户运营。
- N4 复用 fnOS SSO / 登录态（应用自管账号）。
- N5 实时协同编辑（CRDT 重武器不用；op-log + LWW 足够）。
- N6 v1 不做：语音 / AI 回顾 / 提醒 / 上锁 / 心情 / 位置 / 专注写作 / 发到左边 / 背景气泡自定义（见二期）。

---

## 3. 术语

| 术语 | 含义 |
|---|---|
| 角色 Role | 一条"自己发给自己"的聊天流（随手记 / 灵感 / 情绪…），可自定义名称/头像/颜色等 |
| 消息 Message | 聊天流中的一条记录（文本 / 图片 / 待办等），op-log 的基本单元 |
| 待办 Todo | 带 done 标志的消息类型；done 为可变字段（LWW） |
| op-log | 追加式操作日志；同步与合并的唯一事实来源 |
| cursor | 服务端全局单调递增序号；客户端按 cursor 增量拉取 |
| tombstone | 删除标记；保留用于多端收敛，之后可 GC |
| blob | 附件二进制（图片/音频），与元数据分离存储 |
| PWA | 渐进式 Web 应用；手机加主屏 / 桌面浏览器 / NAS 网页同一套代码 |
| fpk | fnOS 原生应用包；最终部署形态（开发期不做） |

---

## 4. 用户与账号

- **多用户**：每用户独立命名空间（user_id）、独立同步 cursor、独立存储配额。
- **认证**：应用自管账号。用户名 + 密码 → 会话 token（Bearer）。不绑 fnOS SSO。
- **管理员**：首个初始化账号即管理员；可建号 / 重置密码 / 停用用户。
- **隔离**：服务端强制 per-user 命名空间；任何 API 只返回当前 token 用户的数据。
- **无跨用户分享**（v1）。
- **设备**：每用户多设备；每设备一个 device_id + 单调 seq；设备可撤销（使该设备 token/cursor 失效）。

---

## 5. 功能需求

### 5.1 v1（本期交付）

#### 5.1.1 角色管理
- 新建 / 改名 / 头像 / 颜色 / 置顶 / 在首页隐藏。
- 会话列表按置顶 + 最近消息排序；显示最近一条预览。
- （延后：聊天背景图 / 气泡颜色 / 上锁 / 提醒 → 二期。）

#### 5.1.2 聊天 / 记录
- 文本气泡消息；时间戳分组（如"星期四 01:50"）。
- 图片消息：从相册 / 上传；服务端生成缩略图；列表用缩略图、点开拉原图。
- 编辑 / 删除：编辑 = 可变字段新版本（LWW）；删除 = tombstone。
- 离线队列：没网时操作进本地队列，联网自动推 + 拉。
- 输入：键盘文本 + 图片附件。（语音 / 心情 / 位置 / 专注写作 / 发到左边 → 二期。）

#### 5.1.3 待办
- "发成待办"：消息类型 = todo，气泡带勾选框。
- done 切换 = 可变字段（LWW）；已完成样式（✓）。
- （延后：到期日 / 到期提醒 → 二期。）

#### 5.1.4 日历
- 日 / 月两种视图；按天聚合记录；月视图格子显示当日条目预览。
- 点某天看当日全部记录；无记录显示空态。

#### 5.1.5 搜索
- 服务端全文搜索（跨角色）；中文友好（FTS5 trigram 或等价子串方案）。
- 搜索结果跳回对应聊天流 / 日期。

#### 5.1.6 同步 / 离线（核心）
- 本地优先：IndexedDB 存投影 + 待传 op 队列 + blob 缓存；Service Worker 缓存 app shell。
- 增量同步：按 cursor 推 / 拉；NAS 定序合并；冲突 LWW。
- 多端最终一致；删除靠 tombstone 收敛。
- 存储被浏览器清掉后可从 NAS 全量重建（NAS 为耐久源）。

#### 5.1.7 网页浏览
- NAS  served 同一套 PWA；浏览器登录即用（含离线壳）。
- 手机加主屏 / 桌面浏览器 / NAS 网页 = 同一应用同一协议。

#### 5.1.8 设置
- 账号 / 改密 / 设备管理 / 存储配额查看 / 导出 / 管理员建号。

### 5.2 二期（延后但已定方向）

| 功能 | 方向（已决策） |
|---|---|
| 语音输入 | 先录音频 blob（离线可录）+ 联网后可选外接 ASR 转文字（opt-in、base_url 可配）；音频为源、文字供搜索 |
| AI 回顾 | 周/月小结；外接 OpenAI 兼容 API、服务端按需"点进去生成"、每用户 opt-in 默认关；provider 留空可配 |
| 提醒 / 通知 | Web Push（VAPID）+ 应用内兜底；iOS 需加主屏 + 授权；原生期升级系统级 |
| 角色上锁 | 客户端 UI 锁（PIN / 可选 WebAuthn 生物识别）；查看/记录先解锁；服务端明文不变 |
| 心情 / 位置 / 专注写作 / 发到左边 | 作为消息附加标签 / 编辑模式 / 气泡侧标志 |
| 聊天背景 / 气泡颜色 | 角色级自定义 |
| 待办到期日 / 提醒 | 结合 Web Push |

### 5.3 三期（远期）
- 原生客户端：iOS / macOS / Windows，照同一份语言中立同步协议实现。
- 可选 E2EE（零知识）增强；若启用则服务端搜索 / AI 回顾需搬客户端或放弃。
- 系统级通知 / 后台同步（原生能力）。

---

## 6. 数据模型

> 服务端 Go + SQLite。op-log 为事实来源；messages/roles 等为可读投影（便于查询/搜索）。

### 6.1 实体
- **users**：id, username, password_hash, is_admin, quota_bytes, created_at, disabled。
- **devices**：id, user_id, name, token_hash, last_seq, revoked, last_seen。
- **roles**：id, user_id, name, avatar, color, pinned, hidden, deleted(tombstone), updated_at, version。
- **messages**（投影）：id, user_id, role_id, type(text/image/todo), text, todo_done, attachment_ref, side, deleted(tombstone), created_at, updated_at, version。
- **ops**（追加日志）：cursor(PK, autoinc), op_id(uuid, unique), user_id, device_id, seq, type, payload(json), client_created_at, accepted_at。
- **attachments**：hash(PK), user_id, size, mime, kind(image/audio), thumb_hash, blob_path, created_at。
- **sync_cursors**：device_id → last_pulled_cursor。
- **backups_meta**：id, created_at, path, size, rotation_slot。

### 6.2 op 类型
- role.create / role.update(LWW 字段) / role.delete(tombstone)
- message.create(不可变主体 + 附件引用) / message.update(LWW 可变字段) / message.delete(tombstone)
- todo.set_done(LWW)
- （二期）message.attach_audio / review.generate 等不进入 op-log 的旁路操作另议。

### 6.3 附件
- op-log / messages 只存引用（hash/size/mime）；二进制在 blob 目录。
- 单附件 ≤ 20MB；每用户配额 5GB（可配）。
- 服务端生成缩略图（image）；客户端缓存缩略图、按需拉原图。
- 离线：blob 先存本地待传队列，联网补传。

---

## 7. 同步协议契约（语言中立，二期原生端照此实现）

### 7.1 传输
- HTTP/JSON（Bearer token）。可选 WebSocket 推送新 cursor 通知（无 WS 时轮询/长轮询兜底）。
- 所有 op 带 op_id(uuid) 做幂等去重（客户端重试安全）。

### 7.2 op 信封
```
{ op_id, device_id, seq, type, payload, client_created_at }
```
- seq = 该设备单调递增；服务端接受时赋全局 cursor（定序）。

### 7.3 推 / 拉
- `POST /api/sync/push` body=[op…] → 校验 + 去重 + 赋 cursor + 合并；返回 {accepted, server_cursor}。
- `GET /api/sync/pull?cursor=N` → {ops: (cursor>N), server_cursor}。
- 客户端流程：联网 → push 本地队列 → pull 增量 → 应用投影 → 更新本地 cursor。

### 7.4 合并与冲突
- 消息主体不可变；可变字段（编辑文本 / todo_done / 角色属性）用 **LWW**：比较 (updated_at, tiebreak=op_id)。
- 删除 = tombstone；保留至所有活跃设备 ack 或保留窗口后 GC。
- 极端冲突（同条两端同时改）= LWW 后写覆盖（已决策，不保留双版本）。

### 7.5 附件通道（与 op-log 分离）
- `POST /api/blobs`（multipart, 带 hash）→ {ref}；`GET /api/blobs/{hash}`（+ `?variant=thumb`）。
- message.create 引用 ref；服务端校验 ref 属于当前用户。

### 7.6 认证与命名空间
- 每请求 Bearer token → user_id；服务端强制 per-user 过滤；device 撤销即失效。

---

## 8. 架构

### 8.1 客户端（PWA, TS）
- IndexedDB：投影 + 待传 op 队列 + blob 缓存 + cursor。
- Service Worker：app shell 缓存 + （二期）push 处理。
- 请求 persistent storage 降低被清概率；被清后从 NAS 全量重建。
- 一套代码：手机加主屏 / 桌面浏览器 / NAS 网页。

### 8.2 服务端（Go 单二进制）
- HTTP API（sync/blobs/auth/roles/messages/search/export）+ 静态 PWA 托管。
- SQLite（WAL）：ops 日志 + 投影 + FTS5(trigram) 搜索。
- blob 目录：原图 + 缩略图（+ 二期音频）。
- 可选 WebSocket 通知。
- 无外部运行时依赖（单二进制），利于最终 fpk。

### 8.3 网络拓扑
- LAN 直连 NAS。
- 公网复用现有 fn-knock / DDNS HTTPS 反代到本应用（同步 API 与网页同域）；TLS 由反代 / ACME 提供。
- 不新增公网暴露面。

---

## 9. 部署与运行

### 9.1 开发期
- 本地调试（go run / 二进制 + 前端 dev server），不急于 fpk。
- 稳定后再打 fpk。

### 9.2 最终形态
- **fpk 原生包**（fnOS App Center 安装 / 原生启停）。
- 注意 fpk 生命周期跑包用户、无 HOME；install_init 装前闸门自包含；数据落 appdata 需 mkdir+chown。
- 存储布局：SQLite + blob 落 SSD 卷（vol1）热数据；备份落 vol3（14T）。

### 9.3 资源约束
- NAS = N150，无 GPU/NPU：不做本地 LLM / 本地 whisper；AI/ASR 走外接可配 API。
- 服务端保持轻量（Go + SQLite），避免 Postgres 等重依赖。

---

## 10. 安全与隐私

- 认证：应用自管账号 + 会话 token；密码加盐哈希；管理员可重置 / 停用。
- 隔离：per-user 命名空间服务端强制；无跨用户读取。
- 传输：TLS（反代 / ACME）；公网经 fn-knock 门禁。
- 存储边界：**服务端明文**；能碰 NAS 磁盘 / shell 者（fnOS 管理员=用户自己）可读——已接受该边界。
- 角色上锁（二期）= 客户端 UI 锁，非 E2EE。
- 外接 AI/ASR（二期）= opt-in 默认关；开启时内容离开 NAS 到 provider，需用户知情。
- 配额：单附件 20MB / 每用户 5GB，防滥用。
- 审计：登录 / 建号 / 撤销设备留痕。

---

## 11. 备份与导出

- **自动备份**：每周一次；SQLite 一致性快照（backup API / WAL checkpoint）+ blob 打包；落 vol3。
- **轮转**：最多留档 3 份，后续覆盖最旧，避免无限增长。
- **导出**：每用户自助 JSON / Markdown + 附件 zip。
- 原则：代码进 git 不进备份；只备不可重建的数据。
- 恢复：从备份快照 + blob 包重建 SQLite 与 blob 目录。

---

## 12. 非功能需求

- 离线：记录 / 编辑 / 删除全离线可用；联网自动收敛。
- 性能：N150 上同步 / 搜索响应目标 p95 < 500ms（个人规模数据量）。
- 可靠：op 幂等、tombstone 收敛、备份可恢复。
- 存储：浏览器端被清可重建；NAS 为耐久源。
- 语言：中文优先（界面 / 搜索 / 文档）。
- 可移植：同步协议文档化，原生端可独立实现。

---

## 13. 里程碑

| 里程碑 | 内容 | 出口标准 |
|---|---|---|
| M0 本地核心 | Go server + PWA 壳 + 认证 + op-log 同步 + 文本消息 | 本地双端离线记→联网收敛一致 |
| M1 v1 完整 | 角色/图片/待办/日历/搜索/离线/网页/设置/导出 | v1 功能全通 + 配额/隔离验证 |
| M2 部署上线 | fpk 打包 + fnOS 安装 + fn-knock/DDNS 远程 + 每周备份轮转 | 真机 fpk 起停/升级/备份恢复验证 |
| M3 二期 | 语音+ASR / AI 回顾 / Web Push 提醒 / 上锁 / 心情位置等 / 背景气泡 | 各 opt-in 功能可用且默认关 |
| M4 三期 | 原生 iOS/macOS/Windows（照协议）+ 可选 E2EE | 原生端与 PWA 同步一致 |

---

## 14. 开放问题 / 风险

- R1 iOS PWA 后台同步 / 推送 / 存储配额弱于原生：靠"联网即收敛 + NAS 耐久源"兜底；原生期补齐。
- R2 中文全文搜索分词：FTS5 trigram 子串方案需实测召回；不足再引分词。
- R3 fpk 生命周期 / 无 HOME 坑：M2 真机验证（模拟需用生产身份）。
- R4 外接 AI/ASR 隐私：opt-in + 知情；默认关。
- R5 tombstone GC 与长期离线设备：保留窗口需定（建议 ≥90 天或全设备 ack）。
- R6 浏览器存储被清：全量重建流量 / 时间需限流与进度提示。

---

## 附录 A：决策日志（grilling 基线）

| # | 决策 | 结论 |
|---|---|---|
| Q1 | 客户端形态 | PWA 一套代码先行；二/三期扩原生 iOS/macOS/Win；同步协议语言中立 |
| Q2 | 同步/冲突 | op-log + NAS 合并中枢；冲突兜底 LWW |
| Q3 | 账号模型 | v1 多用户；per-user 命名空间；无跨用户分享 |
| Q4 | 认证 | 应用自管账号（用户名+密码→token）；管理员=首初始化 |
| Q5 | 隐私/存储 | 服务端明文 + 认证隔离；上锁=客户端 UI 锁；E2EE 延后 |
| Q6 | 部署/栈 | Go 单二进制 + SQLite + blob；开发本地调试；最终 fpk 延后 |
| Q7 | v1 边界 | 角色/文本/图片/待办/日历/搜索/离线/网页；其余延后 |
| Q8 | 附件 | blob 与元数据分离；20MB/件、5GB/人 |
| Q9 | AI 回顾 | 外接 OpenAI 兼容 API、按需、opt-in；provider 留空可配 |
| Q10 | 语音 | 音频 blob 离线录 + 联网可选外接 ASR 转文字 |
| Q11 | 提醒 | Web Push(VAPID) + 应用内兜底 |
| Q12 | 远程访问 | LAN + 复用 fn-knock/DDNS HTTPS 反代 |
| Q13 | 备份 | 每周备份 vol3、留 3 份轮转覆盖 + 每用户导出 |
| Q14 | 命名 | with-me / 与我 (WithMe) |
| Q15 | 交付 | 中文 Markdown 单文件 PRD.md（本文件） |

## 附录 B：截图功能映射（参考界面）

| 截图 | 对应功能 |
|---|---|
| 会话列表（随手记/灵感/情绪） | 5.1.1 角色 / 会话列表 |
| 角色设置（名称/头像/颜色/提醒/背景/气泡/置顶/隐藏/上锁） | 5.1.1（v1 基础项）+ 5.2（延后项） |
| 菜单（新角色/视图/角色管理） | 5.1.1 |
| 日历 日/月 | 5.1.4 |
| 回顾（周/月 生成） | 5.2 AI 回顾 |
| 聊天 + 扩展（待办/发到左边/专注/位置/心情/相册/拍照） | 5.1.2/5.1.3（v1）+ 5.2（延后） |
| 聊天（按住说话 / ✓待办） | 5.2 语音 + 5.1.3 待办 |