# 0.7.4 集成与验证

日期：2026-10-24。唯一 SmallTable 源码基线为 GitHub `hxzjzrcq/SMALLTABLE` 的 `main` 提交 `f55a99abdba6deb2bd1728e37aa0cfc7c82ca84d`（Update README.md）。未混入所附历史源码 ZIP。

## 实现范围

- 现有“角色卡管理”按钮打开 CharacterCardTool，同源 iframe 加载 character-card.html。角色卡源码来自本会话已完成的独立工具，包含默认 5E 示意卡、纯文本占位提示、整数竖式与未计算表达式、独立折叠、计数标签、详情、拖拽预览/占位/插入线、JSON/TXT。
- 采用原生 DOM/Pointer Events，不新增依赖。脚本和样式由 Vite 构建，不允许内联脚本，不修改现有服务端 CSP。
- 关闭只隐藏，重开保持同一个 iframe；受控 WebSocket 断开并自动重连后保持该 iframe 和编辑内容。刷新、退出或会话失效卸载后不恢复编辑；没有自动草稿。
- 外层复用既有工具弹窗：电脑大窗口，390px 手机模拟全屏、固定返回入口，内层详情独立；内页 embedded.css 适配蓝灰主题、字号和触控尺寸，与共享桌面 CSS 隔离。
- 角色数据未进入房间 schema、HTTP 保存、WebSocket 内容、房间 ZIP 或日志。活动桥只传无内容脉冲，另有固定关闭消息；核对 origin 与 frame source。无规则库或自动战斗等扩展。
- package.json / package-lock.json 版本为 0.7.4。CMD 两处原 0.7.2 提示改为 0.7.4，按字节比较除此之外未改动，并保留 51 处 CRLF 换行。运行方法和个人配置边界不变。房间 schema 4、角色卡 JSON schema 1 保持不变。

## 实际验证环境

Linux 容器，Node.js 24.22.1，Playwright 1.62.1，Chromium 153.0.8010.0。真实 Node 服务随机本机端口，独立 DM 与玩家浏览器上下文；桌面 1366×900、手机模拟 390×844，CDP touchStart/touchMove/touchEnd 检查实际触摸滚动与排序。没有 Windows 或 Android/iOS 实机验证，也没有执行 Windows CMD。

## 命令与结果

| 命令/检查                                                          | 结果与边界                                                                                                 |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `npm ci --ignore-scripts`                                          | 安装开发验证依赖成功；不表示生产环境或其他系统安装验收。                                                   |
| `npm run format`                                                   | 执行仓库规定的格式化；撤回与本次无关的历史文档/日志文档格式变化。根 character-card.html 另行格式化。       |
| `npm run build`                                                    | Core 构建、TypeScript 检查与三个 Vite 页面构建通过。依赖包两处 PURE 注释位置提示，不影响构建。             |
| `npm run test:stage`                                               | 10 项通过：原有 Core 哈希、内嵌属性工具、相机与私人笔记。未执行完整房间或独立 Core 全量套件。              |
| `node --test test/character-card-core.test.mjs`                    | 8 项通过：整数、表达式、错误/溢出、严格校验、含 50 长详情标签往返、TXT 和默认示例数据隔离。                |
| `node --import tsx --test test/character-card-tool.test.ts`        | 2 项通过：懒加载、关闭/重开同帧、origin/source 过滤与卸载清理；真实生产资源及原 CSP 下可加载且不变更房间。 |
| `SMALLTABLE_CHROMIUM=<测试浏览器路径> npm run test:character-card` | 最终组合检查执行记录见同目录 validation-0.7.4/。包含上述 8+2 项及真实浏览器专项。                          |
| CMD 字节比较                                                       | 相对 GitHub 基线仅 0.7.2→0.7.4 两处版本提示变化，CRLF 保持；未运行 Windows CMD。                           |

浏览器专项覆盖：DM/PL 按钮入口，默认示例与占位提示，求和、计数、长详情、折叠、JSON/TXT 真实下载与导入，嵌入后的鼠标排序及预览，内层 Escape 取消与外层 Escape 返回，桌面已有选中棋子时卡内 Delete 不删除棋子，关闭重开保留内容。手机模拟验证横排竖式、原生滑动与把手触摸排序的区分、窗口边界、详情和顶部返回按钮。另检查独立玩家看不到 DM 私人卡，卡片内容不进入发出的房间 WebSocket 消息，整个过程不修改房间快照；刷新返回示例；受控关闭 WebSocket 后自动恢复仍保留同一工具帧。

初次组合检查的浏览器末尾断言把启动时正常的 `GET /api/session` 401 当作资源错误。测试改为按实际响应路径仅允许该预期 401，继续拒绝其他 HTTP 错误、CSP 错误和脚本异常，再复测；未修改服务器认证逻辑或 CSP。未把首次失败结果报告为通过。

## 未验证及交付限制

- 未做 Windows Chrome/Edge/Firefox 实机、手机实机、外网部署、负载测试或 Windows CMD 执行验收；不宣称已通过。
- 浏览器下载面板取消或实际磁盘保存失败无法由页面可靠检测。工具仅报告请求，并由用户明确确认 JSON 已保存；没有直接覆盖原文件或自动恢复机制。
- 原工具 50 标签与长详情数据用于当前核心往返测试；本次实际嵌入浏览器检查使用默认示例及一条 300 行长详情，没有重做极限压力测试。
- 未推送 GitHub，未部署。完整包包含源码、锁文件、配置示例、通用 CMD、帮助、构建产物和实际验证记录，不含 node_modules、.git、个人 .env、运行数据或凭证。

## 交付记录

最终组合命令已通过（8 项角色卡纯逻辑、2 项工具/资源测试、5 组真实服务浏览器检查），日志保存在 [validation-0.7.4/](validation-0.7.4/)。最终仅将内页帮助中的旧离线 HTML 打开说明改为通过 SmallTable 网址进入，并执行 Vite 前端重建；未修改交互逻辑。包检查及 CMD 字节比较见该目录 package-check.json。
