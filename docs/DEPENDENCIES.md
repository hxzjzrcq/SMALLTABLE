# 依赖与部署约定

本文描述当前源码的依赖用途及运行方式。直接依赖与版本范围以 `package.json` 为准，安装解析结果以 `package-lock.json` 为准；本文不重复维护版本清单，也不代表最新漏洞审计。

## 直接依赖

| 依赖                 | 用途与维护注意                                                     |
| -------------------- | ------------------------------------------------------------------ |
| `react`、`react-dom` | 桌面及内嵌属性工具的界面渲染                                       |
| `express`            | HTTP API、静态页面和素材服务                                       |
| `ws`                 | 房间 WebSocket 同步与连接维护                                      |
| `zod`                | 房间数据、备份和命令校验；浏览器入口使用 jitless 配置              |
| `sharp`              | 上传与恢复图片的检查、转码；带原生组件，需在目标平台安装匹配的依赖 |
| `adm-zip`            | 含图片的房间 ZIP 备份与恢复                                        |
| `@dndroll/core`      | `file:packages/dndroll-core` 本地依赖，不从外部注册表取得规则源码  |

`tsx` 是服务端启动和离线密码重置所需的运行依赖。开发依赖分工：`typescript` 用于类型检查和 Core 编译；`vite` / `@vitejs/plugin-react` 用于前端开发和打包，`vite` 同时生成 Core 的独立浏览器产物；`concurrently` 同时运行开发服务；`jsdom` 提供测试 DOM；`playwright` 提供真实浏览器测试；`prettier` 负责格式；`@types/*` 提供类型声明。

当前 `npm start` 通过运行依赖 `tsx` 直接运行服务端 TypeScript，尚无独立服务端 JavaScript 构建。先用完整依赖执行 `npm run build`；已有对应构建产物时，可执行 `npm ci --omit=dev` 后 `npm start`。只安装生产依赖的目录不能执行构建或测试命令。

新增依赖前确认现有代码和运行时是否已经覆盖需求；确需引入时说明用途并同步锁文件。依赖更新按影响范围验证：图片/ZIP 涉及上传、恢复和体积限制；网络或校验库涉及协议、权限与连接；前端构建库涉及构建和界面。不复制目标机器以外的 `node_modules` 作为部署依赖。

## 安装、构建与启动

运行环境与完整安装步骤见[首次安装](../帮助.md#首次安装)。构建需要完整开发依赖，生产启动可使用对应的构建产物与生产依赖。

`build` 先通过 `build:core` 编译 Core 并生成独立浏览器脚本及 source map，再做 TypeScript 检查和既有 Vite 前端构建（桌面、DNDROLL 与 character-card.html 三个入口）。`start` 只启动服务，不自动构建。`dist/` 是前端产物，不能单独当作完整站点部署；服务端源码、本地 Core 包、配置和依赖同样需要保留。交付包虽含产物，修改源码后仍需重新构建。

开发使用 `npm run dev`，默认访问 `http://127.0.0.1:5173`，由 Vite 代理 `/api`、`/media`、`/audio` 和 `/ws`，显式保留 Host 以通过服务端同源检查。生产默认访问 `http://127.0.0.1:3000`，由一个 Node 进程提供全部服务。

## Core 独立浏览器产物

标准 `npm run build`（以及开发启动的 Core 预构建）自动生成：

- `packages/dndroll-core/dist/dndroll.browser.js`：IIFE 格式，以全局 `DndRoll` 提供 Core 公共 API，可由普通 HTML 的 script 标签加载。
- `packages/dndroll-core/dist/dndroll.browser.js.map`：对应当前源码的调试映射，正常运行不依赖它。

生成脚本为 `scripts/build-core-browser.mjs`，只使用现有直接开发依赖 Vite。输入是 `packages/dndroll-core/src/index.ts`，输出保留 dist 中的模块、声明及源码映射，不清空整个目录。Core 源码按上游版本原样保留。删除上述两个文件后，标准构建也会重新生成；不依赖源码包中预先存在的产物。

需要单独操作时，在项目根目录运行：

```bash
npm run build:core:browser
npm run build:core
npm run test:core
```

三个命令分别为只生成浏览器包、编译 Core 并生成浏览器包、运行四个原有 Core 独立测试文件。Core 测试应在 `build:core` 或完整 `build` 后执行，测试本身不隐式构建。

SMALLTABLE 的属性工具仍走原有 Vite 入口和同源 iframe，页面不加载这份独立脚本。Core 提供批量 API，但属性工具不展示批量生成界面；独立产物不额外增加用户入口。Core 的公共导出未使用外部运行依赖。

## 配置与持久化

启动读取工作目录 `.env`（如存在），也可由部署环境注入变量。HOST、PORT、DATA_DIR、COOKIE_SECURE 等运行变量、JSON 限额和旧变量迁移统一见 [配置](CONFIGURATION.md)。初始密码、网页改密、离线重置和数据目录互斥的唯一主要说明见 [安全与密码管理](SECURITY.md#密码管理与重置)。

`DATA_DIR` 必须位于可写且重启、重新发布后仍保留的存储。停机迁移时保留 `room.json`、`assets/`、`music.json`、`audio/` 及独立 `credentials.json`；不要迁移运行锁或临时文件。版本兼容与升级步骤见[帮助](../帮助.md#日常启动停止与升级)。

## 托管与代理边界

- 当前架构是一套部署、一张桌面、一个 Node 进程。不支持多个实例共享同一数据目录或仅靠负载均衡扩容；会话、房间状态和变更队列都在单进程内存中。
- 托管环境必须支持长驻 Node 进程、WebSocket 和持久化文件系统。仅静态托管或每次请求临时启动的函数环境不能直接承载当前完整服务。
- 反向代理需转发 HTTP 与 `/ws` 的 WebSocket Upgrade，保留浏览器访问的 Host，使服务端同源检查正常。站点按根路径提供；子路径部署尚无适配。
- 远程玩家直接连接 Node 时设置 `HOST=0.0.0.0` 或实际网卡地址；同机反代可保持默认 `127.0.0.1`。应用自身不提供 TLS。
- 公网 HTTPS 可在代理终止 TLS；浏览器使用同源 HTTPS/WSS。设置 `COOKIE_SECURE=true`，确认代理允许持续的 WebSocket 连接。
- 当前限流取实际连接的远端地址，不信任转发头。经过代理后多个玩家可能共用同一限流桶；部署验收需检查多人进入及 DM 解锁，不能仅添加转发头就假定可按玩家区分。
- 进程重启后内存会话和 DM 授权失效，客户端需重新连接或进入；房间数据从持久化目录恢复。停止时应给进程处理 SIGTERM/SIGINT 和保存的时间。
- 仓库不含 Kimi 等平台专用发布适配。平台如需特殊启动或构建流程，应单独说明并验证，不把临时适配隐含进标准命令。

部署验收至少覆盖：外部浏览器进入、两端同步、DM 解锁、图片上传、重启后桌面恢复及备份恢复。构建成功和无头浏览器可见不能单独证明外部用户能够访问。

文档维护原则见 [开发导读](../DEVELOPMENT.md#文档维护)。

## 浏览器测试依赖

`playwright` 仅为开发依赖；运行时仍无音频处理依赖，生产不使用 FFmpeg。浏览器测试默认使用 Playwright 的 Chromium，也可通过 `SMALLTABLE_CHROMIUM` 指定已安装的 Chromium 可执行文件。执行方法和环境变量见[测试维护](TESTING.md)，各次执行环境与结果见[历史档案](history/README.md)。浏览器二进制和临时解包工具不加入源码包。

测试样本为本地生成的纯音 MP3，来源与重新生成命令见[样本说明](../test/fixtures/README.md)。重新运行已有样本不需要 FFmpeg；只有重建样本时使用。

## Windows 启动入口

项目根 START-SMALLTABLE.cmd 是通用公开入口，无个人域名、密码或令牌；cd /d "%~dp0" 固定工作目录，通过 npm start 启动，由服务端按实际配置检查监听端口和数据目录互斥。穿透/反代独立配置。首次设置和日常启动见[帮助](../帮助.md)，历史增量补丁仅用于对应版本，不能当作当前通用升级步骤。

自由角色卡使用原生 DOM、Pointer Events、Blob 下载和文件选择，不增加运行或构建依赖。它的源脚本/样式经 Vite 同步进入 dist，不需要单独启动服务；内嵌入口不能直接 file:// 打开。
