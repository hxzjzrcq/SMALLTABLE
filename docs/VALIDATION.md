# 0.6.7 验证与交付复核（2026-10-22）

唯一基线为已交付的 `SMALLTABLE-2026-10-22-v0.6.6-完整源码.zip`，SHA-256 见 BASELINE.json。未混入 GitHub 或其他源码包。0.6.6 的验证记录原样保存在 history/VALIDATION-0.6.6.md，不作为本次重跑结果。

## 环境与命令

Linux x86_64，Node v24.19.0，npm 11.9.0，Playwright 使用既有项目开发依赖，真实浏览器 Chromium 153.0.8010.0（headless）。本机 HTTP 与隔离测试房间，无线上数据。复用工作区的基线锁定依赖目录，本次未重新 npm ci。浏览器临时文件被环境清理后，从 npm 包 @sparticuz/chromium 153.0.0 解出浏览器到临时目录；没有加入项目依赖或交付包。

| 命令                                                                                        | 实际结果                                             | 证据（相对 docs）                                 |
| ------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------- |
| npm run format                                                                              | 已执行；已有历史记录恢复原始字节                     | 当前源码                                          |
| npm run build                                                                               | 通过；Core、浏览器脚本、类型检查和 Vite 构建全部完成 | validation-0.6.7-2026-10-22/build.log             |
| npm run check                                                                               | 通过                                                 | validation-0.6.7-2026-10-22/typecheck.log         |
| 相关测试命令（下列完整命令）                                                                | 26 项通过，0 失败                                    | validation-0.6.7-2026-10-22/related-tests.log     |
| npm run test:stage                                                                          | 8 项通过，0 失败；与上述文件不重叠                   | validation-0.6.7-2026-10-22/stage.log             |
| SMALLTABLE_CHROMIUM=/tmp/st-chromium/chrome node --import tsx test/browser-selection-067.ts | 通过                                                 | validation-0.6.7-2026-10-22/browser-selection.log |
| SMALLTABLE_CHROMIUM=/tmp/st-chromium/chrome node --import tsx test/browser-shortcuts-066.ts | 通过；在 0.6.7 构建上回归                            | validation-0.6.7-2026-10-22/browser-shortcuts.log |

```bash
node --import tsx --test test/iteration-067.test.ts test/shortcuts.test.ts test/token-controls.test.ts test/ui-state.test.ts test/board-drawing.test.ts test/transparent-token.test.ts test/render-performance.test.ts test/config-ui.test.ts test/security-boundaries.test.ts test/security-http.test.ts test/authorization-queue.test.ts test/storage-integration.test.ts test/room-integration.test.ts test/movement-integration.test.ts
```

构建存在第三方 Zod PURE 注释位置警告及宿主 npm http-proxy 提示，未修改第三方代码掩盖提示。失败注入测试出现预期的 storage.save_failed 日志，测试本身通过。

## 需求与证据

| 功能                 | 验证结果                                                                                                                                                     |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 目录快速克隆         | 真实页面连续克隆；新 ID，全部其他字段一致；共用图片；之后公开说明独立修改。单选面板的原复制按钮复用同一控制器入口并改称克隆。                                |
| 克隆边界、失败及上限 | 正坐标边界附近反向偏移合法；注入保存失败后原棋子与数量保留，无幽灵副本；自定义数量上限实际禁用克隆按钮。服务端 create 既有权限与数量逻辑保留。               |
| 本地 Shift 多选      | 棋盘与目录共用选择集合；Shift 点击加入/移除，松键保留；普通点击替换、空白清除；浏览器记录确认选择过程中没有发出业务命令，只有通用活动通知可能存在。          |
| 不加入集体操作       | 真实 Shift 按住拖动未提交移动、位置未改变；多选时单枚编辑器和旋转入口不显示。普通点击恢复单选后沿用单枚操作。                                                |
| 一次确认批量删除     | 取消后棋子及选择保留；确认只发一条 delete.many，另一独立 WebSocket 连接收到删除快照。单选 Delete 沿用同一批量入口，现有单枚界面删除保留。                    |
| 原快捷键保护         | 普通玩家、组合键、长按、输入框、属性工具弹窗保护与原生文字删除均通过；目录选择按钮明确允许 Delete，普通按钮仍受保护。                                        |
| 服务端一致性         | 一次批量请求只保存一次、增加一个 revision；保存失败时内存房间、磁盘字节和图片均保留。部分 ID 已消失可安全删除剩余目标；过期 epoch 拒绝，迟到移动不重建棋子。 |
| 权限及隐私           | 新命令登记为 DM；真实普通玩家请求被拒绝；队列执行前 lock、disconnect、改密撤权均覆盖新增命令。普通玩家快照没有克隆的 DM 私有说明。                           |
| 图片资源             | 重复哈希不新增文件；批量删除后只要其他棋子仍引用便保留，最后引用删除后清理。回归真实图片、备份及哈希验证路径。                                               |
| 本地选择清理         | 真实浏览器验证另一连接删除所选棋子后本机移除失效选择；代码核对断连、离开及 epoch 变化清空。                                                                  |

## 代码与产物复核

先完成实现与上述测试，再核对代码、需求及本次日志；未调用额外独立审查代理。选择集合只存在 React 本地状态；`selection.ts` 是不接触网络的选择转换函数。快捷键继续使用统一保护入口。SmalltableClient.cloneToken 复用 create；单枚/批量删除共用候选状态提交及资源清理，不另建 WebSocket、存储或资源库。

房间 schema 仍为 3；新增的是批量删除消息。软件版本和锁文件均为 0.6.7，依赖版本与配置字段未改，DNDROLL Core 源码及既有历史记录逐字节保持。Board/TokenList 统一使用 ID 集合参数，相关旧测试调整参数形态而保留原断言。位置广播不导致无关面板重复渲染的回归通过。

BUILD-MANIFEST.json 记录本次源码、测试、构建日志与全部 dist 产物哈希。PACKAGE-CHECK.json 记录打包核对。完整源码 ZIP 不含 node_modules、真实凭证、用户数据或私人备份。

## 未执行

没有重跑完整房间套件、Core 规则套件及 0.6.5 的音乐/全部浏览器套件；不声称它们本次通过。未测试实体 Windows 键盘、实体手机或线上部署。没有推送 GitHub、部署或操作线上数据。
