<p align="center">
  <img src="packaging/ICON_256.PNG" width="88" alt="with-me icon">
</p>

# with-me / 与我

自己给自己发消息的本地优先记录应用。每个「角色」是一条只属于自己的聊天流（随手记 / 灵感 / 情绪…），用发消息的方式做记录；手机 PWA、桌面浏览器和 NAS 网页共用一套代码，NAS 同时充当同步中枢与存储。

[![GitHub](https://img.shields.io/badge/GitHub-latte03%2Fwith--me-181717?logo=github)](https://github.com/latte03/with-me)
[![Version](https://img.shields.io/badge/version-1.0.0-orange)](https://github.com/latte03/with-me)
[![Go](https://img.shields.io/badge/Go-1.27-00ADD8?logo=go)](https://go.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-Vite-3178C6?logo=typescript)](https://vitejs.dev)
[![PWA](https://img.shields.io/badge/PWA-offline--first-5A0FC8)](https://web.dev/progressive-web-apps/)
[![fnOS](https://img.shields.io/badge/fnOS-native%20fpk-2F7BD8)](https://www.fnnas.com)

## 目录

- [功能](#功能)
- [技术栈](#技术栈)
- [快速开始](#快速开始)
- [部署到飞牛 fnOS](#部署到飞牛-fnos)
- [架构](#架构)
- [仓库结构](#仓库结构)
- [测试](#测试)
- [文档](#文档)

## 功能

- **角色**：新建 / 改名 / 配色 / 置顶 / 首页隐藏；会话列表按置顶 + 最近消息排序
- **记录**：文本、图片（微信式缩略图、手势左右滑查看）、待办；支持编辑与删除
- **日历**：日 / 月视图按天聚合，点某天看当日全部记录
- **搜索**：服务端全文搜索（中文子串友好），离线时本地兜底
- **图片与视频**：预览页右下角进入，按时间分桶的网格
- **本地优先**：IndexedDB 存投影 + 待传队列 + blob 缓存，断网照记，联网自动推拉
- **多端一致**：op-log 按服务端 cursor 定序，冲突 LWW；本地数据被清可全量重建
- **多用户**：每人独立命名空间与配额；管理员建号 / 重置 / 停用
- **其它**：浅色 / 深色 / 自动主题、设备管理、导出（JSON / Markdown / zip 含附件）

## 技术栈

| 层 | 选型 |
|---|---|
| 前端 | TypeScript + Vite，手写 PWA（Service Worker / IndexedDB / 无框架） |
| 后端 | Go 单二进制，modernc SQLite，bcrypt 会话，FTS5 trigram |
| 同步 | HTTP/JSON op-log（push / pull），token 认证，per-user 命名空间 |
| 部署 | 原生二进制 + 静态前端；fnOS 原生 fpk（应用中心安装） |

## 快速开始

前置：Node 20+（pnpm）、Go 1.27+。

```bash
bash scripts/start.sh
```

脚本会构建前端（缺产物时）并编译服务端，然后监听 `127.0.0.1:8080`。打开页面按提示创建管理员账号即可使用；`ADDR` / `DATA` 可覆盖监听地址与数据目录。

前端热更新（`/api` 代理到 :8080）：

```bash
cd web && pnpm install --ignore-scripts && pnpm dev
```

直接跑二进制（前端产物在 `web/dist`）：

```bash
(cd server && go build -o ../bin/withme ./cmd/withme)
./bin/withme -addr :8080 -data ./data -web ./web/dist
```

| 参数 | 说明 |
|---|---|
| `-addr` | 监听地址，默认 `:8080` |
| `-data` | SQLite 与附件目录 |
| `-web` | 前端产物目录（SPA fallback） |

## 部署到飞牛 fnOS

```bash
bash scripts/build-fpk.sh            # 出包：dist/with-me-<版本>.fpk
bash scripts/build-fpk.sh --check    # 只体检（版本 / 端口对账 / 脚本行尾）
```

应用中心「手动安装」选 fpk 即可；服务监听 8099，数据在 `@appdata/with-me/data`，升级与重装都保留。仅支持 x86_64。发新包前记得抬 `packaging/manifest` 里的 `version`（应用中心同版本拒更新）。

## 架构

```text
PWA（IndexedDB 投影 + 待传队列 + blob 缓存）
   │  POST /api/sync/push        GET /api/sync/pull?cursor=N
   ▼
Go server ── ops（op-log，全局单调 cursor）──▶ 投影表（roles / messages）
   │            └─ blobs（原图 + 512 缩略图）· sessions / devices · FTS5 索引
   ▼
web/dist 静态托管（除 /api 外 SPA fallback）
```

- LWW 以服务端接受顺序（cursor）为准，不依赖客户端时钟；重复 push 按 `op_id` 幂等
- 删除是 tombstone，多端收敛后过滤；客户端投影随时可从 NAS 全量重建
- 附件与元数据分离：先传 blob 再 push 引用它的消息，断网时排队补齐
- 协议细节见 [docs/protocol.md](docs/protocol.md)

## 仓库结构

```text
server/      Go：cmd/withme + internal/server（auth/sync/blobs/search/export/store/static）
web/         前端：src（projection/store/sync/ui）+ test（纯逻辑单测）+ public（PWA 资源）
e2e/ui/      Playwright 端到端
packaging/   fnOS 包定义：manifest、生命周期脚本、桌面入口、图标
scripts/     start.sh（本地起服务）· integrate.sh（集成测试）· build-fpk.sh（出包）
docs/        protocol.md（同步 / API 契约）
PRD.md       产品需求文档
```

## 测试

```bash
cd web && pnpm test          # 纯逻辑单测（投影 / 日期分组 / 图片尺寸）
bash scripts/integrate.sh    # 构建 + 真实服务的 API 冒烟 + Playwright UI（默认端口 8097）
```

## 文档

- [PRD.md](PRD.md) — 产品需求与决策基线
- [docs/protocol.md](docs/protocol.md) — 同步 / API 契约（前后端唯一事实来源）
- [AGENTS.md](AGENTS.md) — 代码结构约束与审计记录

> 服务端明文存储 + 认证隔离，v1 不做端到端加密；每用户默认 5GB 配额，单附件上限 20MB。
