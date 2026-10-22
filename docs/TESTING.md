# 测试维护

0.6.7 的实际结果见 [本次验证](VALIDATION.md)。2026-10-20 测试整理过程单独保留为 [历史记录](history/TESTING-cleanup-2026-10-20.md)。

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
