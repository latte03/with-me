# AGENTS.md

本地优先自聊 PWA + Go op-log 同步 hub；功能正本 PRD.md，接口契约 docs/protocol.md。

## 代码结构约束
- 模块化：按域拆分；纯逻辑（投影/日期分组/图片尺寸公式）放无 DOM 模块（projection.ts/store.ts/sync.ts）并配单测；UI 原语（icon/toast/menu/modal）集中在 ui/dom.ts；路由与 shell 只在 app.ts。
- 低耦合：UI 组件不 import 兄弟组件的业务函数（共享编辑器等抽独立模块，如 ui/role-editor.ts）；组件间用参数/回调通信（viewer 不认识路由，靠 onOpenMedia 回调）。
- 高内聚：一个模块只承担一类职责；新功能先问归属哪个现有模块，不把跨域逻辑堆进 UI 组件。
- 交付前验证：cd web && pnpm build && pnpm test；bash scripts/integrate.sh 全绿。

## 审计记录（2026-11-08）
已修：chat→chats 编辑器耦合（抽 role-editor.ts）；尺寸/分桶纯逻辑下沉 projection/store 并加单测；viewer 路由解耦（回调）。
可接受未动：dom.ts 聚合 UI 原语（同类职责）；store.ts 含 IDB+blob+CRUD（本地持久化同域）；server 已按 auth/blobs/export/search/sync/store 分文件。
