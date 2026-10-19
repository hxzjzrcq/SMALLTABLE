# 当前架构

适用于 SMALLTABLE 0.6.0 及其构建修正版 060fix。运行与功能入口见 [README](../README.md)，依赖和部署约定见 [DEPENDENCIES](DEPENDENCIES.md)。

## 模块与数据归属

| 模块                                           | 职责与边界                                                         |
| ---------------------------------------------- | ------------------------------------------------------------------ |
| `src/shared/model.ts`                          | 房间 schema、消息校验、公开数据投影及稳定数字排序的权威定义        |
| `src/shared/dice.ts`                           | 通用骰子表达式解析与计算，不引入具体 RPG 的成功判定                |
| `src/server/app.ts`                            | HTTP、会话、授权调用、房间命令、广播和保存调度的接入与协调         |
| `src/server/storage.ts`                        | 图片检查与转码、持久化、素材回收和 ZIP 备份恢复                    |
| `src/server/permissions.ts`                    | HTTP 与 WebSocket 分别登记的明确授权，未知动作拒绝                 |
| `src/server/bootstrap.ts`                      | 初始化凭证、组装房间服务及凭证/互斥资源清理                        |
| `src/shared/limits.ts`、`src/server/config.ts` | 默认限额、启动读取与集中派生预算；不处理密码                       |
| `src/server/auth.ts`                           | 限流工具                                                           |
| `src/server/credentials.ts`                    | 密码策略与独立凭证持久化，网页及离线重置共用                       |
| `src/server/instance-lock.ts`                  | 数据目录的操作系统级本机互斥，进程退出自动释放；启动与离线重置共用 |
| `src/shared/passwords.ts`                      | 密码修改 HTTP 请求结构；不进入房间 schema                          |
| `src/client/controller.ts`                     | SmalltableClient：房间网络、连接状态、重连和操作接口               |
| `src/client/components/`                       | 页面展示与本地交互，房间操作统一调用 SmalltableClient              |
| `src/dndroll/`、`packages/dndroll-core/`       | 独立属性工具界面与原样规则依赖                                     |

房间变更由服务端统一串行处理。`epoch` 用于拒绝适用命令中的旧桌面操作，`revision` 用于同步和保存状态。普通玩家数据通过 `publicToken` / `project` 排除 DM 私有字段，不能仅靠界面隐藏。

服务启动入口先创建服务，再等待 HTTP 监听成功；监听失败保留原始错误原因并关闭已创建的服务。数据目录互斥在读取/修改凭证之前取得，正常关闭或进程异常退出后释放，不靠抢删新版本锁文件恢复。具体平台实现和升级边界见依赖与部署文档。

凭证、密码政策、授权清单及撤权行为的唯一主要说明见 [安全](SECURITY.md)。Config 不处理密码，Storage 不接触凭证；组装层拥有 CredentialStore 和运行互斥的生命周期。Storage 接口为 `{ dataDir, images, backup, parse }`，parse 在外层绑定当前限额。配置及预算说明见 [配置](CONFIGURATION.md)。

schemaVersion 为 2；`parseRoom` 对 schema 1 做显式迁移。磁盘加载和 ZIP 恢复共用该入口。棋子、公开注释、投骰记录、先攻表及共享直线进入房间快照和备份；清空画线仅 DM 可用。

私人笔记只存玩家浏览器；相机、面板显隐和未提交的交互预览属于本机状态。Board 本地预览画线，松开后提交一次；棋子拖动则发送节流位置更新和最终位置。

DNDROLL 运行于独立 iframe。规则只调用 Core，房间不保存或广播属性结果；活动桥接只传活动通知。批量 UI 不展示，Core 保留原样，上游标识与源码哈希见 `packages/dndroll-core/UPSTREAM.json`。

登录页使用独立 LoginPage 与限定范围的样式；装饰动画不接触网络或存储。前端入口设置 Zod jitless 以适配既有 CSP。具体界面约定见 [UI 维护](UI.md)。

## 随功能演进的维护建议（非强制）

以下是修改相关功能时的判断依据，不是立即重构的任务，也不设固定行数或文件数门槛。

- `server/app.ts` 已集中连接、会话、权限和多类命令。继续扩展密码管理或新增其他独立功能时，可把相关职责抽成有明确接口的模块，让 app 保留组装与协调。拆分应保留统一的房间变更队列、权限检查、公开数据投影和保存调度，避免各模块各自修改并保存同一房间。
- `Board.tsx` 同时处理 SVG 绘制和多种手势。新增地图交互或发现相互干扰时，可抽出棋子绘制或指针/触屏处理；简单视觉修改仍可留在原组件。拆分应保留统一坐标转换、拖动预览、节流与最终位置提交，以及断连、工具切换和 epoch 变化时的交互清理。
- 优先按职责拆分，不为降低行数机械分文件，也不为尚未确定的功能预建通用框架。

文档职责与更新原则统一见 [README 的文档维护](../README.md#文档维护)。

## 0.6.0 消息与更新边界

`src/shared/model.ts` 仍是消息和房间结构权威。房间 schema 不变；WebSocket snapshot 新增 `caps`，服务端每次快照均发送当前生效限额。类型中保留可选字段以兼容旧消息及既有测试，客户端缺少 caps 时保留已读取配置。GET /api/config 及 caps 增加 maxInitiative、maxDrawings、maxRolls、maxNames，删除无效 dndrollUrl。health 的会话要求见 [安全](SECURITY.md#授权登记)；不能把本轮称为协议完全未变。

棋子增量仍只更新 room.tokens 和 revision，保留其它切片引用。面板只接收所需切片，memo 和稳定回调阻断无关执行；TokenList 只比较其实际显示字段、顺序、选中状态与限额。没有新增 store 或状态库。具体草稿、挂载和撤权约定见 [UI](UI.md)。

060fix 仅在构建层补齐 Core 独立浏览器脚本和 source map，未改变上述运行架构；生成命令及产物用途统一见 [依赖与构建](DEPENDENCIES.md#core-独立浏览器产物)。
