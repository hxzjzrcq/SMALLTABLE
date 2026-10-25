# 当前架构

适用于 SMALLTABLE 0.7.5。运行与功能入口见 [README](../README.md)，依赖和部署约定见 [DEPENDENCIES](DEPENDENCIES.md)。

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
| `src/server/sessions.ts`                       | 仅内存会话、期限、在线占位、角色与连接交替；不接触存档             |
| `src/shared/session.ts`                        | 临时 ID 纯函数、会话错误码与非秘密管理目标类型                     |
| `src/server/auth.ts`                           | 限流工具                                                           |
| `src/server/credentials.ts`                    | 密码策略与独立凭证持久化，网页及离线重置共用                       |
| `src/server/instance-lock.ts`                  | 数据目录的操作系统级本机互斥，进程退出自动释放；启动与离线重置共用 |
| `src/shared/passwords.ts`                      | 密码修改 HTTP 请求结构；不进入房间 schema                          |
| `src/client/controller.ts`                     | SmalltableClient：房间网络、连接状态、重连和操作接口               |
| `src/client/components/`                       | 页面展示与本地交互，房间操作统一调用 SmalltableClient              |
| `src/dndroll/`、`packages/dndroll-core/`       | 独立属性工具界面与原样规则依赖                                     |

房间变更由服务端统一串行处理。`epoch` 用于拒绝适用命令中的旧桌面操作，`revision` 用于同步和保存状态。普通玩家数据通过 `publicToken` / `project` 排除 DM 私有字段，不能仅靠界面隐藏。

服务启动入口先创建服务，再等待 HTTP 监听成功；监听失败保留原始错误原因并关闭已创建的服务。数据目录互斥在读取/修改凭证之前取得，正常关闭或进程异常退出后释放，不靠抢删新版本锁文件恢复。具体平台实现和升级边界见依赖与部署文档。

凭证、密码政策、授权清单及撤权行为的唯一主要说明见 [安全](SECURITY.md)。Config 不处理密码，Storage 不接触凭证；组装层拥有 CredentialStore 和运行互斥的生命周期。Storage 接口为 `{ dataDir, images, resourceBytes, backup, parse }`，parse 在外层绑定当前限额。配置及预算说明见 [配置](CONFIGURATION.md)。

schemaVersion 为 4；`parseRoom` 明确拒绝其他版本，不执行迁移。磁盘加载和 ZIP 恢复共用该入口。棋子、公开注释、投骰记录、先攻表及共享直线进入房间快照和备份；清空画线仅 DM 可用。

私人笔记只存玩家浏览器；相机、面板显隐和未提交的交互预览属于本机状态。Board 本地预览画线，松开后提交一次；棋子拖动每秒最多发送 10 次中间位置，松手发送带 moveId 的最终位置。控制器保留最终预览，匹配 move.ack 后结束；2 秒超时回到最近权威位置。回执不等于落盘。

DNDROLL 运行于独立 iframe。规则只调用 Core，房间不保存或广播属性结果；活动桥接只传活动通知。批量 UI 不展示，Core 保留原样，上游标识与源码哈希见 `packages/dndroll-core/UPSTREAM.json`。

登录页使用独立 LoginPage 与限定范围的样式；装饰动画不接触网络或存储。前端入口设置 Zod jitless 以适配既有 CSP。具体界面约定见 [UI 维护](UI.md)。

## 随功能演进的维护建议（非强制）

以下是修改相关功能时的判断依据，不是立即重构的任务，也不设固定行数或文件数门槛。

- `server/app.ts` 已集中连接、会话、权限和多类命令。继续扩展密码管理或新增其他独立功能时，可把相关职责抽成有明确接口的模块，让 app 保留组装与协调。拆分应保留统一的房间变更队列、权限检查、公开数据投影和保存调度，避免各模块各自修改并保存同一房间。
- `Board.tsx` 同时处理 SVG 绘制和多种手势。新增地图交互或发现相互干扰时，可抽出棋子绘制或指针/触屏处理；简单视觉修改仍可留在原组件。拆分应保留统一坐标转换、拖动预览、节流与最终位置提交，以及断连、工具切换和 epoch 变化时的交互清理。
- 优先按职责拆分，不为降低行数机械分文件，也不为尚未确定的功能预建通用框架。

文档职责与更新原则统一见 [开发导读的文档维护](../DEVELOPMENT.md#文档维护)。

## 消息与界面更新

`src/shared/model.ts` 定义房间消息和结构。服务端每次快照通过 `caps` 发送当前生效限额，字段与 `GET /api/config` 一致。类型保留可选 caps 以接受缺少该字段的消息；客户端缺少 caps 时保留已读取配置。配置字段见[配置](CONFIGURATION.md)，health 的会话要求见[安全](SECURITY.md#授权登记)。

棋子增量仍只更新 room.tokens 和 revision，保留其它切片引用。面板只接收所需切片，memo 和稳定回调阻断无关执行；TokenList 只比较其实际显示字段、顺序、选中状态与限额。没有新增 store 或状态库。具体草稿、挂载和撤权约定见 [UI](UI.md)。

Core 提供独立浏览器脚本和 source map；生成命令及产物用途见 [依赖与构建](DEPENDENCIES.md#core-独立浏览器产物)。

## 运行日志

`src/server/log.ts` 提供固定字段的单行 JSON 日志；配置、服务入口、HTTP/WS 及存储边界调用它，不参与业务状态或存档。进程异常处理器仅由可执行入口安装。格式、事件与收集方式见 [运行日志](LOGGING.md)。测试工程整理见 [测试维护](TESTING.md)。

## 资源与持久化

房间使用 `maps[]` 与 `currentMapId`，地图 ID 与图片哈希分离。列表非空时当前 ID 必须有效，空列表仅允许 null；每条地图有原文件名、原始尺寸和独立缩放。切图不改变桌面或 epoch，也不触发相机适配；背景只在世界原点缩放。只有当前背景进入 SVG 图片元素。

`Storage` 复用现有图片验证、原子 room.json 保存及 ZIP 路径/哈希/尺寸验证，增加实际资源扫描、暂存引用和统一预算。所有资源变更沿用 app 的串行队列。地图及棋子管理、掀桌先保存候选房间，再发布状态；失败保留此前房间。原有高频移动仍节流同步并延迟保存，失败显示尚未安全落盘。

棋子先上传返回 `uploadId`，绑定时校验会话、资产及有效期；成功绑定后解除暂存。已有正式引用可供复制使用，不另造暂存。编辑取消、换图、删除、掀桌和恢复均调用同一引用清理。最后引用解除后立即尝试删除，删除失败记录日志、继续计入额度，维护任务重试；启动不恢复未完成编辑，并核对文件、引用和实际容量。

音乐库独立位于 `music.json`，音频文件在 `audio/`；房间在 `room.json`、图片在 `assets/`。`server/mp3.ts` 逐帧校验 MPEG Layer III 头、长度及完整性，处理 ID3v2/ID3v1，累加帧样本数获得时长；不转码，不依赖玩家报告。无法解码的媒体由浏览器显示加载失败，不宣称服务端解码验证。

`server/music.ts` 负责音乐库的原子保存、权威曲目/位置/推送 ID 和自然结束计时器。重启仅加载库，播放恢复为无当前曲目的停止状态。WebSocket 传状态，受会话保护的 `/audio/:id` 使用 HTTP 范围响应。音乐不进入房间快照或备份；独立音乐事件不含私人内容。恢复房间不操作音乐状态。

`MusicPanel` 使用原生 Audio，只在接受当前推送后设置 src；选择按推送写入 sessionStorage。DM 播放成功后服务端仅对发起者发送本推送接受标记，其他 DM 也按玩家处理。组件在切曲、断连及卸载时撤销旧媒体源；元数据回调以最新权威状态同步。每秒本地校对已播放媒体，未播放成功时等待用户点击，不发送高频进度广播。

`fitRoomCamera` 集中计算缩放背景、旋转后的完整棋子和画线边界，保留屏幕边距；相机缩放下限统一由 clampScale 控制。掀桌复用 epoch，清空棋子/画线并使旧操作失效，不清空其他房间字段。

键盘快捷键由 `client/shortcuts.ts` 统一处理事件保护和监听清理，App 绑定既有控制器命令；快捷键不另建状态格式；批量删除协议见下。具体规则见 [UI](UI.md#键盘快捷键)。

## 克隆与批量删除

选择集合只存在 App 的本地状态，`selection.ts` 定义普通选择与 Shift 切换。Board 与目录接收同一集合；单选编辑器使用集合中唯一的 ID。有效集合未变化时保留引用，避免位置广播使无关面板重复渲染。克隆等待服务端快照后选中，失败不会把新 ID 当作已创建实体。

SmalltableClient.cloneToken 从最新快照取字段，使用现有 create 命令；共享素材哈希，沿用数量、图片验证及资源引用逻辑。快速克隆不保存模板、不引入素材库。

`delete.many`，携带唯一、非空且不超过实际棋子数量上限的 ID 数组与 epoch。服务端在既有串行队列内重验对象权限与 epoch（PL 只允许全部为公共棋子），单次过滤候选房间，保存成功后发布一个快照并清理资源。与单枚删除共用提交和清理路径。保存失败保留原内存及磁盘房间，不提前删除图片。其他 DM 已删除的 ID 忽略；全部已消失则返回当前快照、不新增修订。过期 epoch 整次拒绝。删除后迟到移动不能重新创建棋子。WebSocket 消息容量推导覆盖配置允许的批量 ID 列表。

## 会话与协议接入

会话存于 Sessions；认证 Token 与每次在线角色对应的随机管理 target 分离。WebSocket 接管先替换归属，再关闭旧连接；message、pong、close 及串行执行均核对当前 socket。既有房间队列仍是业务变更的唯一入口。会话 API 不维护第二份房间状态。

`src/shared/model.ts` 定义 `player.kick`、`players`、`activity` 回执；presence 分别携带普通人数/上限及 DM 人数/上限。`src/shared/session.ts` 定义 HTTP 机器错误码与会话关闭码。GET /api/session 验证 Cookie、只返回角色与昵称并续写 HttpOnly Cookie；POST /api/session 检查实时容量和 ID 后申请 15 秒握手占位；POST /api/logout 支持离线会话及幂等注销。服务端在线维护消息沿用 activity 事件，客户端收到后通过 GET /api/session 续写 Cookie；离线请求不延长固定截止时间。

SmalltableClient 的认证请求串行，退出等待在途认证完成后注销；组件卸载不注销。只对临时网络断开最多退避重试十次；终止原因用错误码处理。会话与权限合同见 [安全](SECURITY.md#会话与席位)，界面说明见 [UI](UI.md#登录与会话)。

客户端将连接清理与桌面卸载分离。临时网络错误或满员保留公开快照及组件挂载，先剥除私有字段；终止错误清除整个桌面。具体原因与按钮规则唯一见 [UI 桌面生命周期](UI.md#断线时的桌面生命周期)。

## 恢复展示与投骰理由

controller.recovery 仅驱动无桌面时的恢复展示，沿用 Cookie、错误码与席位处理。LoginShell 负责登录/恢复的共用装饰生命周期；版本取根 package.json。shared/roll-input.ts 复用原 rollDice 做确定性语法验证及输入拆分，不消耗随机源；model 的命令及记录使用同一可选理由校验，app 将它加入公开记录。骰子计算与记录上限保持原约定；当前 schemaVersion 统一为 4。

## 公共身份与隐藏状态

公共棋子和普通棋子共用 tokens、坐标、队列、提交及投影；publicId 是 A–Z 不可变身份。盒中状态由固定集合减去在桌身份推导，不保存第二套坐标。普通池按无 publicId 计数，公共池额外 26；房间模型、批量命令与备份预算分别检查。公共棋子无图片、隐藏或说明字段的可编辑入口，磁盘/ZIP 加载同样检查固定默认外观及身份唯一性。

普通棋子 hidden 持久化，隐藏不减少额度或图片引用。Board 从渲染和命中区域剔除隐藏对象，列表保留并可本机定位；服务端对 DM/PL 一并拒绝隐藏对象的移动/旋转。隐藏、改字、取用/归还、创建/克隆沿用候选保存路径，失败保留原房间。

UploadStatus 只呈现控制器的实际上传阶段；XMLHttpRequest 的上传进度与服务器处理响应分开，同入口防重复。诊断从固定字段白名单生成，不记录房间正文或凭证。

## 个人自由角色卡

src/character-card/ 是从独立自由角色卡引入的本机工具：core.js 负责示意卡、整数求和、存档校验与 TXT；drag.js 负责本机排序和拖动反馈；app.js 负责单卡 DOM 编辑、文件导入/下载；style.css 为原始样式，embedded.css 只作内嵌视觉适配，host.js 只发送无内容活动及关闭消息。

character-card.html 是第三个 Vite 页面入口。源码脚本与样式均外置，构建后受既有同源 CSP 约束，不开放 inline script。CharacterCardTool.tsx 管理模态与 iframe 挂载，沿用 SmalltableClient.activity()，不建立网络或持久化通道。卡片没有进入 src/shared/model.ts、房间队列、广播、日志或房间 ZIP；房间 schemaVersion 仍为 4，角色卡 JSON 独立使用 format=free-character-card、schemaVersion=1。

关闭窗口只隐藏，不重建 iframe；房间视图卸载会移除 iframe。纯文本占位提示属于 UI，不写入状态；默认计算项目与标签属于示例数据。存档合计从计算行派生，不信任缓存总数。导入逐项校验并整体替换，不迁移其他格式；具体使用及保存限制见帮助。
