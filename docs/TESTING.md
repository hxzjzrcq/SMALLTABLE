# 测试维护

本文说明 SmallTable 0.7.3 的测试入口、归属及维护方法。文件名中的版本数字表示用例来源，不表示它只检查旧版本。实际执行结果按版本保存在[历史档案](history/README.md#验证记录)，不在本文累计。

## 基本执行

先安装完整依赖并运行 `npm run build`。`npm test` 运行完整房间套件，`npm run test:core` 运行独立 Core 套件。`npm run test:stage` 是完整房间套件中的内嵌工具、相机和笔记子集，不能与全量结果相加计算覆盖量。

浏览器脚本使用真实 Chromium、页面及服务；先运行 `npx playwright install chromium`，或通过 `SMALLTABLE_CHROMIUM` 指定已安装的 Chromium。它们不包含在 `npm test` 中。`npm run test:browser` 仅运行下表地图、属性工具和音乐四个脚本，不包含全部浏览器验收。

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

| 功能 | 主要文件（相对 `test/`） |
| --- | --- |
| 地图、资源配额、暂存、掀桌与音乐 | `iteration-065.test.ts` |
| 本地多选、克隆、批量删除、保存失败 | `iteration-067.test.ts` |
| 会话期限、席位、握手、接管、踢人 | `session-068.test.ts` |
| 登录/退出顺序、重连预算、移动回执与上传状态 | `session-controller-068.test.ts` |
| 公共投骰理由、同步、保存重启 | `roll-reason-070.test.ts` |
| 公共棋子、隐藏、文字、旧档拒绝与默认容量同步 | `iteration-072.test.ts` |
| 连续放置、世界边界 | `camera.test.ts` |

`iteration-072.test.ts` 同时覆盖批量归还携带已消失 ID、全部 ID 已消失时不增修订、混入普通对象拒绝及落盘/同步。会话测试以可控时钟检查固定 45 分钟恢复资格，不需要真实等待。

## 专项与浏览器入口

以下 npm 专项均先运行对应单元/集成测试，再运行浏览器脚本：

| 命令 | 覆盖 |
| --- | --- |
| `npm run test:shortcuts` | 快捷键保护、确认与取消、输入焦点和另一连接同步 |
| `npm run test:selection` | 克隆、多选、批量删除、边界和失败路径 |
| `npm run test:session` | 刷新、Cookie、接管、踢人、满员与离线注销 |
| `npm run test:recovery` | 控制器与草稿、临时断线、开发入口音频代理 |

其他浏览器检查构建后直接运行 `node --import tsx test/脚本名.ts`：

| 脚本 | 覆盖 |
| --- | --- |
| `browser-065.ts` | 四视口、内嵌属性工具与七种购点模式 |
| `browser-board-065.ts` | 窄屏边界、切图、背景缩放、相机、掀桌 |
| `browser-music-065.ts` | 独立上下文、拒绝不请求、切曲、刷新、加载失败与删除 |
| `browser-autoplay-065.ts` | 无用户激活时的播放阻止、点击恢复与自然结束 |
| `browser-release-070.ts` | 当前版本恢复页和公共投骰理由 |
| `browser-072.ts` | 真实服务、默认 16 连接/281 棋子、三视口交互与原生 Audio |
| `browser-move-072.ts` | 注入回执延迟/丢失、指针拖动、旧回执、超时回退和诊断复制 |
| `browser-placement-073.ts` | 不等回包连续放置普通/公共棋子、视角改变后重置 |

`browser-recovery-069.ts` 通过真实 Vite 入口检查音频、Cookie 和临时断线，需本机 3000 与 5173 端口空闲。其满员/ID 冲突界面分支使用注入响应；真实服务端的容量与冲突另由会话测试检查。`browser-session-068.ts` 也覆盖真实服务端满员恢复。

`python3 test/terminal-reset.pty.py` 为可选 Unix 交互终端专项，不在 npm test 内，不能代替 Windows CMD/PowerShell 验收。

## 辅助代码与结果解释

`test/support/browser.ts` 统一基础 Chromium 参数和三步登录提交；特殊导航、参数及等待条件留在用例中。自动播放用例保留无用户激活流程。`test/environment.ts` 的 `inputValue` 使用原生 value setter、input 事件及 act 等待，保证 React 更新。

生产依赖检查应在独立临时目录完成：复制源码、配置、包清单和对应构建产物，执行 `npm ci --omit=dev`，确认没有 Vite 时 `npm start` 能提供首页及配置接口。已有完整依赖目录中的启动不能证明生产安装可用。

浏览器注入故障不等于真实广域网丢包，手机视口模拟不等于实体手机，渲染计数不等于帧率；分别记录实际验证条件。音乐样本来源和重建步骤见[样本说明](../test/fixtures/README.md)。

## 断言与清理原则

- 拒绝路径使用有效业务输入，避免把格式错误误认成权限正确；必要时同时检查响应和副作用。
- 真实同步测试观察另一连接收到的结果；涉及多连接时显式建立最终状态，不假定跨连接顺序。
- 新测试先查对应功能文件；已有场景优先修正或参数化，不通过重复追加增长数量。
- 默认限额与自定义限额、模型投影与网络保密、旧 schema 拒绝分别验证不同风险，继续保留。
- 渲染次数专项仍使用 memo 对象内部插桩，并包含改名触发计数的正向检查；只用于该项实现约束，不代表帧率。其变化不应要求修改 UI 行为测试。
- 不按固定数量或行数删除测试。保留独立故障价值，删除重复证明和实现文本锁定。

每次执行记录版本、环境、完整命令、结果、故障注入及未覆盖范围。已有的 [0.7.3 验证](history/VALIDATION-0.7.3.md) 是当时两项修复的专项结果，不能称为全量测试通过，也不能充当之后修改的新结果。
