# SMALLTABLE 0.3：给后续 LLM 的交接

> 历史记录，不作为当前维护指令；当前入口见 [README](../../README.md)。本文中的“当前”“本轮”和操作指令仅指当时版本。文中 `VALIDATION.md` 指当时的验证记录，现已由当前版本记录替换。

## 目标与当前状态

本项目原名 TABLETOP，现名 SMALLTABLE。当前版本 0.3.0。0.2 已完成共享桌面、本地 DNDROLL 属性工具与手机玩家适配；0.3 只做安全维护，不改变产品范围。仍未部署；不新增账户、聊天、房间目录或规则自动战斗。

桌面基线不变：15 个在线席位、255 枚棋子、10 Hz 拖动、255 条公共骰子日志、本地 65535 字节私人笔记。自由移动、整数格测距、棋子边长 1/16–4 格、可旋转、无方向刻线、无撤销和拖动占用。

## 0.3 已做

- `adm-zip` 从 0.5.18 升到 0.6.1，`sharp` 从 0.34.5 升到 0.35.5；`npm audit --omit=dev` 为 0。
- 移除 `@types/adm-zip`：adm-zip 0.6.x 自带 `types.d.ts`。
- `src/server/storage.ts` 的备份恢复不再只信 ZIP 头部声明大小：解压后校验实际字节数与头部一致，并按实际字节数执行 room.json 8 MiB、素材与总预算限制。
- 新增集成测试：伪造 ZIP 声明解压大小为 0 的备份必须被拒绝，且当前桌面保持不变。
- 集成测试里两处 `adm-zip` 的 `toBuffer()` 结果包成 `Uint8Array` 再作为 fetch body，以适配 0.6.x 自带类型。
- 已验证 0.2 生成的旧备份可恢复到 0.3；房间 `schemaVersion` 仍为 1。

## 代码导航

| 内容               | 权威位置                                                                          |
| ------------------ | --------------------------------------------------------------------------------- |
| 房间数据与消息     | src/shared/model.ts                                                               |
| 公共骰盘解析       | src/shared/dice.ts                                                                |
| 备份、图片与存档   | src/server/storage.ts                                                             |
| 服务端同步与 API   | src/server/app.ts                                                                 |
| 属性生成规则       | packages/dndroll-core/src/index.ts、types.ts、catalog.ts                          |
| 上游来源和校验     | packages/dndroll-core/UPSTREAM.json                                               |
| 属性 UI 会话控制   | src/dndroll/store.ts                                                              |
| 外层工具容器       | src/client/components/AbilityTool.tsx                                             |
| 触控缩放计算与手势 | src/client/camera.ts、components/Board.tsx                                        |
| 备份恢复安全回归   | test/integration.test.ts                                                          |
| 0.2 阶段测试       | test/dndroll-integration.test.ts、mobile.test.ts、ui-stage.test.ts、notes.test.ts |

## 实现约束

1. UI 不实现骰法或购点公式。数据与动作以 Core 导出的类型和 getSessionView 为准；允许动作由 allowedActions 驱动。
2. 不因界面改版修改上游 Core。升级时先替换来源、更新 UPSTREAM 校验清单，再验证受影响接口。
3. 内置工具保留独立文档，不污染房间 CSS、主题和语言。嵌入窗口关闭后不销毁 iframe，以保留本次批量和历史。
4. 活动桥接只传 type，验证 origin 与 event.source；不加入笔记、属性存档或任意文字。
5. 玩家端面向手机；DM 面向桌面。不要为“兼容手机”额外建立 DM 简化权限系统。
6. 备份恢复必须继续在写入素材或替换房间前完成全部校验；不信任 ZIP 头部声明大小。
7. 禁止部署，除非用户明确要求。

## 当前验证与待办边界

0.3 执行：`npm run build`；`node --import tsx --test test/integration.test.ts`；另做一次 0.2 备份到 0.3 的恢复冒烟。集成测试 8/8 通过，覆盖密码与权限隔离、移动/旋转/骰子日志、备份导出与恢复、图片上传/拒绝异常图片/素材去重、伪造 ZIP 声明大小拒绝、255 棋子并发、静态资源与素材鉴权、移动节流、无活动断开、保存失败恢复。

未重跑：0.2 的 `npm run test:stage`、DNDROLL Core 97 项规则测试、真实手机手感、浏览器视觉截图、公网部署。公网反向代理、HTTPS、COOKIE_SECURE 与持久化目录仍属于部署前确认项。

## 可直接使用的交接提示词

请阅读 AGENTS.md、README.md、docs/HANDOFF-0.3.md 与 docs/ARCHITECTURE.md，基于现有 SMALLTABLE 0.3 继续工作。先说明本次改动涉及哪一层，再按用户指定范围修改。属性规则只调用本地 @dndroll/core，保持来源可追踪；公共骰盘继续使用服务端结果。所有玩家功能兼容手机，DM 管理功能面向电脑。保持私人笔记和属性会话本地，不新增公开自由文本。备份恢复不得信任 ZIP 头部声明大小，所有校验失败必须保留当前房间。按受影响范围执行测试，说明实际测试与未验证部分。更新当前文档，不追加互相矛盾的旧合同；不得自行部署。
