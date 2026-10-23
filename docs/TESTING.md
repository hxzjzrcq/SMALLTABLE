# 测试维护

0.7.1 的实际结果见 [本次验证](VALIDATION.md)。2026-10-20 测试整理过程单独保留为 [历史记录](history/TESTING-cleanup-2026-10-20.md)。

## 执行入口

先运行 `npm run build`。`npm test` 运行全部房间测试，`npm run test:core` 运行独立 Core 套件。`npm run test:stage` 运行内嵌工具、相机和本地笔记相关测试，它是完整房间套件的子集，不能与完整套件相加计算覆盖量。

`python3 test/terminal-reset.pty.py` 是可选 Unix 终端专项，不在 npm test 内。0.6.5 未运行该终端专项，也未验证 Windows、实体手机或部署环境；真实 Chromium 浏览器单独执行，见下文。

## 按功能寻找测试

| 功能                                     | 测试文件                                                                                                                    |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| 配置与限额结构                           | `config.test.ts`、`config-ui.test.ts`                                                                                       |
| 可配置容量的真实命令与资源引用           | `limits-integration.test.ts`                                                                                                |
| 图片、ZIP、磁盘限额及启动失败清理        | `storage-integration.test.ts`、`storage-limits.test.ts`                                                                     |
| 房间往返、静态入口、空闲断开、保存失败   | `room-integration.test.ts`                                                                                                  |
| 多连接收敛、拖动中间更新、节流与最终落点 | `movement-integration.test.ts`                                                                                              |
| 权限清单、HTTP/WS 授权与队列撤权         | `security-boundaries.test.ts`、`security-http.test.ts`、`authorization-queue.test.ts`                                       |
| 凭证、进程互斥及重置界面                 | `passwords.test.ts`、`lifecycle.test.ts`、`password-ui.test.ts`                                                             |
| 公开注释、先攻及画线协议                 | `public-note.test.ts`、`public-note-integration.test.ts`、`table-tools.test.ts`                                             |
| DOM 行为、棋子与画线交互                 | `ui-state.test.ts`、`token-controls.test.ts`、`transparent-token.test.ts`、`board-drawing.test.ts`、`initiative-ui.test.ts` |
| 登录、相机与私人笔记                     | `login.test.ts`、`camera.test.ts`、`notes.test.ts`                                                                          |
| 内嵌属性工具与构建资源                   | `embedded-tool-ui.test.ts`、`dndroll-integration.test.ts`                                                                   |
| 渲染次数专项                             | `render-performance.test.ts`                                                                                                |

日志测试为 `logging.test.ts`、`logging-integration.test.ts`、`logging-process.test.ts`，分别验证格式与隐私、实际服务错误、子进程生命周期。

路径均相对 `test/`。Core 的规则断言仍归 `packages/dndroll-core/tests/` 管理，不复制到房间集成测试。

## 断言与清理原则

- 拒绝路径使用有效业务输入，避免把格式错误误认成权限正确；必要时同时检查响应和副作用。
- 真实同步测试观察另一连接收到的结果；涉及多连接时显式建立最终状态，不假定跨连接顺序。
- 新测试先查对应功能文件；已有场景优先修正或参数化，不通过重复追加增长数量。
- 默认限额与自定义限额、模型投影与网络保密、旧 schema 拒绝分别验证不同风险，继续保留。
- 渲染次数专项仍使用 memo 对象内部插桩，并包含改名触发计数的正向检查；只用于该项实现约束，不代表帧率。其变化不应要求修改 UI 行为测试。
- 不按固定数量或行数删除测试。保留独立故障价值，删除重复证明和实现文本锁定。

测试整理阶段的五项破坏实验见 [历史验证](history/VALIDATION-test-cleanup-2026-10-20.md)，0.6.1 本次执行结果见 [验证记录](VALIDATION.md)。

## 0.6.5 新增与变更

`iteration-065.test.ts` 覆盖地图、schema、边界、掀桌、真实图片/MP3、配额与暂存、并发、恢复及失败清理；`authorization-queue.test.ts` 增加新命令与 HTTP 路由，明确核对撤权错误，避免把业务无效误认成权限通过。旧 schema 测试改为明确拒绝，保存失败测试改为候选变更未提交；相机测试采用新下限，图片绑定测试传真实 uploadId。

真实浏览器检查独立于 npm test：

```bash
npx playwright install chromium
npm run test:browser
```

必要时先设置 `SMALLTABLE_CHROMIUM` 为本机可执行文件。四个脚本分别是 `browser-065.ts`（四视口、全部七种购点模式）、`browser-board-065.ts`（窄屏完整边界、背景切换/缩放与相机、掀桌确认/取消）、`browser-music-065.ts`（独立上下文、拒绝不请求、同步、切曲、旧提示、断线/刷新、加载失败和删除）、`browser-autoplay-065.ts`（真实无用户激活的浏览器政策阻止、点击恢复及自然结束）。它们使用真实服务与媒体，不以 jsdom 替代布局和播放。

当前结果与限制以 [VALIDATION](VALIDATION.md) 为准。

## 0.6.6 快捷键

完成构建后执行 `npm run test:shortcuts`；真实浏览器可通过 SMALLTABLE_CHROMIUM 指定，默认使用 Playwright Chromium。`shortcuts.test.ts` 验证统一保护条件和监听清理；`browser-shortcuts-066.ts` 使用实际页面和服务验证普通玩家保护、确认/取消、长按、组合键、输入框、属性工具弹窗、删除及另一连接的同步快照。本次不重跑与小更新无关的全量资源和音乐套件，历史结果见 history/VALIDATION-0.6.5.md。

## 0.6.7 克隆与批量删除

完成构建后运行 `npm run test:selection`；可通过 SMALLTABLE_CHROMIUM 指定真实浏览器。`iteration-067.test.ts` 覆盖本地选择规则、批量协议、权限、单次保存、共享图片、过期 epoch、部分目标已消失、迟到移动和保存失败。`browser-selection-067.ts` 使用真实服务与页面验证连续克隆、字段一致和笔记分叉、边界、失败及数量上限、Shift 加选/取消/拖动不提交、普通点击、目录多选、删除确认/取消及另一连接同步。`authorization-queue.test.ts` 加入批量命令的执行前撤权检查。

Board 与 TokenList 的 selected 参数统一为本地 ID 集合，相关 DOM 测试只调整参数形态，保留原有交互断言。快捷键保护继续使用 0.6.6 浏览器脚本回归。本次实际命令及结果以 VALIDATION.md 为准。

## 0.6.8 会话与在线管理

`session-068.test.ts` 使用真实 HTTP/WS 服务及可控服务端时钟，验证期限、独立席位、握手占位、连接接管、迟到队列、临时 ID、踢人和认证来源。时间推进是模拟时间，未真实等待 30 分钟。`session-controller-068.test.ts` 检查终止关闭码、待注销标记和在途登录/退出顺序。`passwords.test.ts` 保留真实凭证持久化与改密竞态覆盖。旧网络夹具补充唯一临时 ID，多 DM 的既有资源/权限测试显式配置所需 DM 名额，不放宽产品默认值。

构建后 `npm run test:session` 运行专项与真实 Chromium 会话检查。浏览器测试使用隔离上下文，覆盖刷新、Cookie、关闭重开、接管、踢人、角色、满员手动恢复、断网退出和错误提示；可通过 SMALLTABLE_CHROMIUM 指定可执行文件。克隆、多选及快捷键仍由既有浏览器脚本回归。当前结果、实际命令及未验证项见 [验证](VALIDATION.md)。

## 0.6.9 开发入口与恢复验证

`npm run test:recovery` 运行控制器、React 草稿及服务端会话测试，再运行 `test/browser-recovery-069.ts`。浏览器脚本使用当前 Vite 配置，需本机 3000 与 5173 空闲；以真实服务及原生 Audio 验证开发入口登录、上传、Cookie 音频请求与播放。

临时断线测试关闭真实浏览器 WebSocket，并中止会话恢复请求，观察三次自动重试后保留 iframe 与先攻草稿、手动恢复及退出。满员与 ID 冲突的界面分支使用注入 HTTP 响应；服务端实际占位与冲突由 session-068 测试覆盖，不把注入响应称为真实并发服务器验收。原有 browser-session-068 仍验证实际服务端的满员恢复。

生产依赖检查使用独立临时目录：完整构建后复制源码、配置、包清单及构建产物，执行 `npm ci --omit=dev`，确认没有 Vite 的情况下 `npm start` 可提供首页与配置接口。不能在已有完整 node_modules 的目录仅运行 start 就声称验证了生产安装。

## 0.7.0

roll-reason-070.test.ts 覆盖输入拆分、Unicode 上限、服务端拒绝、双端同步、保存重启及无理由旧记录/备份；session-controller-068.test.ts 增加恢复阶段及快照超时重试预算。browser-release-070.ts 观察生产构建的独立恢复页及骰盘；既有 browser-session-068.ts 和 browser-recovery-069.ts 检查会话与临时断线回归。真实执行记录及限制见 VALIDATION.md。

## 0.7.1 测试辅助代码

`test/support/browser.ts` 统一基础 Chromium 启动参数和三步登录提交；用例仍显式保留特殊启动参数、导航和等待条件。`test/environment.ts` 的 `inputValue` 用原生 value setter 与 input 事件触发 React 更新，并在 act 内等待。未删除场景或断言，不将自动播放用例的无用户激活登录改为点击登录。

当前版本页面回归仍使用 `test/browser-release-070.ts`，历史编号表示用例来源；版本断言已更新为 0.7.1。运行：`node --import tsx test/browser-release-070.ts`。其他测试入口不变。

## 0.7.2 当前验证入口

`iteration-072.test.ts` 覆盖分池/身份/文字/隐藏模型、公共并发和权限、保存失败、实际保存/重启/ZIP 恢复、旧档拒绝、心跳与默认 16 连接/281 棋子同步。`session-068.test.ts` 已更新为固定 45 分钟断线资格及健康在线；controller 测试补充十次重试、专属移动回执/旧回执/超时和真实上传阶段状态机。

构建后运行 `node --import tsx test/browser-072.ts` 和 `node --import tsx test/browser-move-072.ts`。前者使用真实服务、16 个连接、281 棋子及原生 Audio 检查三视口布局和交互；后者以 WebSocket 路由注入回执延迟/丢失，检查实际指针拖动、旧回执、另一玩家后续移动、超时回退、诊断复制失败和拖动中隐藏。注入故障不等于真实广域网丢包；手机视口模拟不等于真机。`browser-release-070.ts` 按当前版本检查恢复页及公共投骰理由。结果以 VALIDATION.md 为准。

## 0.7.3 两项审计修复

本次只构建并运行相关专项。`camera.test.ts` 新增连续放置及边界用例，`iteration-072.test.ts` 新增双玩家归还过期 ID、全部过期、混合普通对象拒绝及落盘/同步用例。`browser-placement-073.ts` 验证不等待回包的普通/公共连续放置，以及改变视角后重置。原有批量删除与公共归还回归按名称筛选，不运行整个套件；实际命令和结果见 [验证](VALIDATION.md)。
