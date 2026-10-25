# 开发导读

本文面向维护 SmallTable 0.7.5 的开发者。安装与部署先读[帮助](帮助.md)，修改前读 [AGENTS.md](AGENTS.md) 和[当前架构](docs/ARCHITECTURE.md)。程序版本以 `package.json` 为准，协议与存档结构以 `src/shared/model.ts` 为准。

## 开发与检查

安装完整依赖并设置运行环境后，运行 `npm run dev`，访问 <http://127.0.0.1:5173/>。Vite 将 API、图片、音频和 WebSocket 请求转发到本机 3000 端口。生产构建与服务端使用同一套源码。

- `npm run build`：构建 Core、检查 TypeScript、打包前端。
- `npm test`：完整房间测试，须先完成构建。
- 其他专项、浏览器入口与测试归属见[测试维护](docs/TESTING.md)。根据改动影响选择检查，不把历史测试结果当作本次结果。

## 代码导航

| 需要调整                     | 文件                                                                     |
| ---------------------------- | ------------------------------------------------------------------------ |
| 颜色、间距、字体、侧栏宽度   | `src/client/styles.css` 的设计变量及样式                                 |
| 页面布局和面板顺序           | `src/client/App.tsx`                                                     |
| 桌面与鼠标操作               | `src/client/components/Board.tsx`                                        |
| 会话生命周期与席位           | `src/server/sessions.ts`                                                 |
| UI 操作接口与连接状态        | `src/client/controller.ts`                                               |
| 自由角色卡与工具容器         | `src/character-card/`、`src/client/components/CharacterCardTool.tsx`     |
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

## 维护边界

房间变更统一经过服务端队列；组件调用 SmalltableClient，不各自建立网络或保存通道。权限由服务端校验，普通玩家接收的数据必须排除 DM 私有字段。私人笔记只存浏览器。DNDROLL 规则继续复用 Core，不在 UI 重写。

当前没有账号系统、棋子所有权、撤销或拖动锁；新增功能须先确认范围。模块职责及后续拆分建议见[架构](docs/ARCHITECTURE.md)。

## 文档维护

按读者任务组织文档。当前说明直接描述现状；功能变化时修改相应段落，不追加“某版本新增”章节。每项事实尽量保留一个主要说明位置，其他文档概述并链接。必要的入门步骤可在 README 简述，完整步骤由帮助维护。

| 文档                               | 负责内容                                     |
| ---------------------------------- | -------------------------------------------- |
| [README](README.md)                | 项目用途、主要功能、最短入门与阅读入口       |
| [帮助](帮助.md)                    | 使用者与部署者的安装、操作、升级和排错步骤   |
| [开发导读](DEVELOPMENT.md)         | 代码导航、开发入口与文档维护规则             |
| [架构](docs/ARCHITECTURE.md)       | 模块职责、状态归属、同步和持久化机制         |
| [配置](docs/CONFIGURATION.md)      | 环境变量、JSON 字段、默认限额和派生预算      |
| [依赖与部署](docs/DEPENDENCIES.md) | 依赖用途、构建产物和部署技术约束             |
| [安全与密码](docs/SECURITY.md)     | 授权、会话、凭证、密码策略与重置             |
| [UI](docs/UI.md)                   | 当前界面交互和本机状态维护约定               |
| [日志](docs/LOGGING.md)            | 日志格式、事件及隐私边界                     |
| [测试](docs/TESTING.md)            | 如何执行、寻找和维护测试，不存历次结果       |
| [更新日志](CHANGELOG.md)           | 各版本的简要变化和必要的兼容性提示           |
| [历史档案](docs/history/README.md) | 版本任务书、交接、实现、审查、验证和原始证据 |
| [AGENTS](AGENTS.md)                | 自动化修改的仓库工作要求                     |

测试结果须注明版本、命令、环境、范围和未验证项，保存在历史目录。旧任务书不是当前操作手册，计划不能写成已实现。原有历史报告保留当时结论；修正归档路径和链接时不改写测试结果。不要为每次小更新新增一份重复总结。

公开包不得包含 `.env`、实际数据、私人 CMD、密码或个人部署地址。根目录通用 CMD 可公开；依赖及构建产物的交付约定见[帮助](帮助.md#github-发布与验证)。
