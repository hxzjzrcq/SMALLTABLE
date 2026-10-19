# 从 GitHub MAIN 0.5.6 升级至 0.6.0

本说明适用于 2026-10-20 交付的 **060fix**，npm 版本号为 `0.6.0-fix`。060fix 是 0.6.0 的构建与文档修正版，桌面功能、运行架构、Core 规则和房间数据结构与 0.6.0 一致。

## 来源与版本关系

0.6.0 的开发基线是 GitHub MAIN **0.5.6**，提交 [038683fd969438f162caf7db32bbd4295b76eb88](https://github.com/hxzjzrcq/SMALLTABLE/commit/038683fd969438f162caf7db32bbd4295b76eb88)。首次升级前，提供的 MAIN 源码包全部 99 个文件已与该提交的 Git blob 哈希比对一致。该提交固定为来源标识，不随远端后续更新变化。

060fix 以已交付的 0.6.0 源码包为直接基线，仅补齐下述独立浏览器构建和整理文档，没有重新导入或替换运行源码。交付日期用于区分同一功能版本的源码包。

| 版本                | 内容及升级关系                                                                  |
| ------------------- | ------------------------------------------------------------------------------- |
| GitHub MAIN 0.5.6   | 原始基线：包含密码管理、离线重置、运行互斥和透明图片棋子                        |
| 0.6.0               | 增加统一可配置限额、集中授权、Storage 职责收窄、图片引用优化和面板更新边界      |
| 060fix（0.6.0-fix） | 保留 0.6.0 全部运行源码，补齐 Core 独立浏览器产物及可重复构建，整理当前升级文档 |

## 0.5.6 升级操作

1. 停止旧服务，保留完整数据目录和运行环境设置，并准备可回退的副本。房间 ZIP 不含凭证，停机时应单独保留 `credentials.json`。
2. 解压本源码包到程序目录，保留自己的 `DATA_DIR` 指向持久数据目录，不覆盖用户数据或凭证。程序升级不需要重新建桌。
3. 按 [旧限额环境变量迁移表](CONFIGURATION.md#从旧环境变量迁移)，把已设置的 `MAX_SEATS`、`IDLE_MINUTES`、`MAP_BYTES`、`MAP_PIXELS`、`MAP_EDGE`、`TOKEN_BYTES`、`TOKEN_EDGE` 转入 JSON，再从 `.env`、容器或服务管理器移除旧变量。检测到这些变量时拒绝启动并说明目标字段，不静默忽略。
4. 删除无效的 `DNDROLL_URL`；属性工具仍加载同源 `/dndroll.html`。HOST、PORT、DATA_DIR、COOKIE_SECURE 继续保留，具体行为见 [配置](CONFIGURATION.md)。保留自己的 JSON 配置，不要用默认示例覆盖自定义值。修改限额须重启生效。
5. 已有有效 `credentials.json` 时无需重新设置密码，旧初始环境密码不会覆盖当前凭证；损坏凭证不会静默重新初始化。确需重置时按 [安全与密码管理](SECURITY.md#密码管理与重置) 操作。
6. 在新程序根目录执行以下命令，然后启动服务。必须保留开发依赖，不能使用 `npm ci --omit=dev`。

```bash
npm ci
npm run build
npm test
npm run test:core
npm start
```

7. 调整外部健康检查：`/api/health` 现在要求有效会话，匿名请求返回 401。验证外部浏览器进入、两端同步、DM 解锁、图片上传、重启恢复及备份恢复；本包未进行目标服务器部署。

降低限额使现有房间或图片越界时，服务拒绝读取，不自动裁剪或删除。应恢复合适配置，或先在较高限额下整理数据；不要删除 `room.json` 或 `credentials.json` 来规避启动错误。

## 0.6.0 的行为变化

- 默认限额集中在 `src/shared/limits.ts`，部署配置位于 `smalltable.config.json`。API、snapshot、界面、命令、磁盘与恢复使用生效值；预算集中派生，可显式超过旧 15／255／257 默认限制。完整字段见 [配置](CONFIGURATION.md)。
- Config 不处理密码；启动组装层拥有 CredentialStore 和运行互斥的生命周期。Storage 只取得 `{ dataDir, images, backup, parse }`，不接触凭证。
- HTTP 和 WS 分别登记明确授权，包含密码修改，未登记动作拒绝；保留 DM 管理请求原有 `s.ws` 条件、限流、来源、epoch、口令代次保护及队列内复查。权限与凭证的主要说明见 [安全](SECURITY.md)。
- 新上传图片完整检查和转码；创建或更换图片引用仅检查、不重复转码，未换引用的编辑跳过图片处理。去重、回收、原子保存及备份恢复保留。
- 面板输入收窄并使用 memo 与稳定回调；保留草稿、滚动位置、最新坐标提交、密码管理、及时撤权，以及既有面板和 iframe 挂载行为。界面约定见 [UI](UI.md)。
- 未使用的 BatchPanel 及专用文案、样式已删除；用户界面没有批量生成入口。Core 原有批量 API 和全部规则保持原样。

房间 schemaVersion 仍为 2，保留 schema 1 读取。消息有明确变化：snapshot 新增 caps，API 和快照的 caps 新增集合限额字段并删除无效 dndrollUrl，health 新增会话要求。消息细节见 [架构](ARCHITECTURE.md#060-消息与更新边界)。

## 已使用 0.6.0 时升级到 060fix

更新程序目录，保留 `.env`、自定义 JSON 配置及原数据目录，重新安装、构建和测试。无需数据迁移或重设密码。

本修正版从现有 Core 源码重新生成 `packages/dndroll-core/dist/dndroll.browser.js` 及 `.map`，并把生成步骤纳入标准构建；另提供 `build:core:browser` 和 `test:core` 命令，具体用途见 [独立浏览器产物](DEPENDENCIES.md#core-独立浏览器产物)。这两个文件用于独立脚本分发及相关测试，SMALLTABLE 现有内嵌工具不加载它们；恢复产物不恢复批量生成界面。

本次未增加或升级依赖，未改变运行源码、房间协议、存档结构、权限及界面。恢复重编码和 ZIP 解压峰值内存问题仍未扩大处理。实际测试和未覆盖范围见 [验证记录](VALIDATION.md)。本次源码同步不包含服务部署。GitHub 源码按现有 `.gitignore` 不提交生成目录，安装依赖后运行 `npm run build` 即可重建全部产物。
