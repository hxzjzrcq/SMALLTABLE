# SMALLTABLE 0.6.0（060fix，2026-10-20）

一套部署就是一张共享桌面。密码入桌，独立密码解锁 DM 工具箱。规则由人解释，软件保存并同步桌面。

当前版本为可本地运行的 MVP 源码。

## 本地运行

需要 Node.js 22 或更新版本及 npm。安装、生产启动和代理约定见 [依赖与部署](docs/DEPENDENCIES.md)。

```bash
npm ci
```

复制 `.env.example` 为 `.env`，首次启动前设置两个不同的初始密码，或先运行 `npm run password:reset` 初始化。密码要求和重置步骤见 [密码管理](docs/SECURITY.md#密码管理与重置)。

开发模式：

```bash
npm run dev
```

打开 `http://127.0.0.1:5173`。Vite 代理 API、素材与 WebSocket 到本机 3000 端口。

本地生产模式：

```bash
npm run build
npm start
```

打开 `http://127.0.0.1:3000`。一个 Node.js 进程提供前端、API 和 WebSocket。默认仅监听本机；当前交付不包含实际部署。

发布包包含前端构建产物 `dist/`，仍需安装依赖。生产启动目前需要开发依赖，具体原因和部署边界见 [依赖与部署](docs/DEPENDENCIES.md)。

## 使用

1. 输入房间密码。没有个人账号；每个桌面连接占一席，默认 15 席；限额可配置。
2. 在 DM 工具面板输入 DM 密码。可替换地图、校准格距、创建无图片棋子、维护骰子名称名单；“密码管理”可在再次验证当前 DM 密码后修改口令。
3. DM 在棋子面板编辑名称、编号、颜色、占地边长与 DM 私有说明，可附图片；点“保存修改”提交。所有玩家都能单独编辑并保存公开注释。
4. 所有人都能移动和旋转所有棋子。拖空白平移，滚轮、双指或按钮缩放，“查看全部”找回地图外棋子。
5. “丈量”拖出本机直线测距，整数格显示。格距按地图像素定义，隐藏网格也能测距。
6. 骰盘选择 DM 提供的显示名称。支持 `d20`、`4d6`、`1d20+5`、`2d6+1d4-2`。
7. 笔记仅保存在浏览器，可复制、导出、导入 TXT。跨设备自行转移。
8. 顶部“属性工具”打开内置 DNDROLL，所有人都可用；生成、分配、购点、存档与导出均复用提供的 DNDROLL 0.4 Core。工具数据只在本机，不自动广播或绑定棋子。
9. 手机玩家可收起侧栏腾出地图空间；DM 管理流程面向电脑，不要求手机优化。
10. DM 可导出、恢复含实际图片的完整 ZIP 备份。备份包含 DM 私有说明，绝不包含私人笔记、密码或连接凭证。

先攻盘支持名字、数字、增删修改和排序；直线画笔支持共享画线与删除，DM 可清空线条。

图片棋子没有有色底板，透明区域保持透明，完整占地区域仍可选中、拖动；选中框与旋转保留。无图片棋子继续显示彩色圆形或方形。

登录前可查看本机私人笔记。登录动画在后台或减少动态效果模式下暂停，登录后卸载。手机使用单列登录表单。

“角色卡管理”仅为提示占位，没有存储或管理功能。没有撤销、拖动锁、聊天或棋子所有权；骰子表达式不支持投掷原因。圆形棋子没有方向刻线。两个玩家争抢同一枚棋子时允许跳动，以服务器接受的最后更新为准。

## 维护入口

| 需要调整                     | 文件                                                                     |
| ---------------------------- | ------------------------------------------------------------------------ |
| 颜色、间距、字体、侧栏宽度   | `src/client/styles.css` 的设计变量及样式                                 |
| 页面布局和面板顺序           | `src/client/App.tsx`                                                     |
| 桌面与鼠标操作               | `src/client/components/Board.tsx`                                        |
| UI 操作接口与连接状态        | `src/client/controller.ts`                                               |
| 数据结构、消息、公开数据投影 | `src/shared/model.ts`                                                    |
| 通用骰子解析与计算           | `src/shared/dice.ts`                                                     |
| 服务端同步与 API             | `src/server/app.ts`                                                      |
| 图片、存档与备份             | `src/server/storage.ts`                                                  |
| 密码持久化、策略与弱密码表   | `src/server/credentials.ts`、`src/server/weak-passwords.json`            |
| 数据目录运行互斥与异常恢复   | `src/server/instance-lock.ts`                                            |
| 终端重置入口                 | `scripts/password-reset.ts`                                              |
| 配置项                       | `smalltable.config.json`、`src/shared/limits.ts`、`src/server/config.ts` |
| DNDROLL 规则模块（原样复用） | `packages/dndroll-core/src/`                                             |
| DNDROLL 嵌入界面与独立样式   | `src/dndroll/`                                                           |
| 属性工具容器与活动桥接       | `src/client/components/AbilityTool.tsx`                                  |

## 文档维护

当前规则直接更新到对应的当前文档，不通过追加历次版本说明来拼接现状。每项约定保留一个主要说明位置，其他文档用链接引用。

| 文档                                | 负责内容                               |
| ----------------------------------- | -------------------------------------- |
| [README](README.md)                 | 运行入口、当前功能与维护导航           |
| [当前架构](docs/ARCHITECTURE.md)    | 模块边界、数据归属与非强制维护建议     |
| [UI 维护](docs/UI.md)               | 当前界面与交互约定                     |
| [依赖与部署](docs/DEPENDENCIES.md)  | 外部依赖用途、安装与部署约定           |
| [配置与限额](docs/CONFIGURATION.md) | JSON、默认值、派生预算和旧环境变量迁移 |
| [安全与密码](docs/SECURITY.md)      | 授权、凭证、改密与离线重置、运行互斥   |
| [0.6.0 升级](docs/UPGRADE-0.6.0.md) | 基线来源、本轮范围和升级步骤           |
| [仓库指引](AGENTS.md)               | 自动化修改的工作要求                   |

`docs/history/HANDOFF-*.md` 是历史交接记录，只在需要追溯特定版本时阅读，不作为当前规则的补丁。旧任务书用于需求追溯；已批准的范围变化应体现在上述当前文档中。实现与文档不一致时先核对，不把计划写成已实装功能。

## 验证

本次实际执行结果与未覆盖范围见 [验证记录](docs/VALIDATION.md)。先执行 `npm run build`，再运行 `npm test`（完整房间测试）及 `npm run test:core`（Core 独立测试）。

0.6.0 唯一开发基线是上传的 MAIN 0.5.6，对应提交 [`038683fd969438f162caf7db32bbd4295b76eb88`](https://github.com/hxzjzrcq/SMALLTABLE/commit/038683fd969438f162caf7db32bbd4295b76eb88)。该次升级实施可配置限额、认证与配置分离、集中授权、Storage 接口收窄、图片引用优化及面板更新修复，保留 MAIN 密码管理、离线重置、运行互斥和透明棋子行为。详细范围和升级方法见 [升级说明](docs/UPGRADE-0.6.0.md)。

未升级依赖，未修改 DNDROLL Core，房间仍为 schemaVersion 2 且可读取 schema 1。完整源码交付 ZIP 包含重新构建的产物；GitHub 仓库按现有 `.gitignore` 不提交生成目录，运行 `npm run build` 可生成全部产物。源码同步不包含服务部署。

060fix 从未修改的 Core 源码重新生成 `dndroll.browser.js` 及其 source map，标准构建包含这一过程。独立构建与测试方法见 [依赖与构建](docs/DEPENDENCIES.md#core-独立浏览器产物)。恢复产物不恢复批量生成界面。
