# 测试维护与 2026-10-20 整理记录

测试整理已合并到 SMALLTABLE 0.6.1，不再作为独立版本后缀交付。整理前基线为 `SMALLTABLE-060fix-2026-10-20-完整源码.zip`，SHA-256：`da7eaf42c86a63f300951ce2d2d52a4acbf026bb0248a974935056b3efbe191b`。下述四步是测试层的整理记录；0.6.1 另外增加运行日志，见 [小更新](UPGRADE-0.6.1.md)。当前执行结果以 [验证记录](VALIDATION.md) 为准。

## 执行入口

先运行 `npm run build`。`npm test` 运行全部房间测试，`npm run test:core` 运行独立 Core 套件。`npm run test:stage` 运行内嵌工具、相机和本地笔记相关测试，它是完整房间套件的子集，不能与完整套件相加计算覆盖量。

`python3 test/terminal-reset.pty.py` 是可选 Unix 终端专项，不在 npm test 内。本次未重新运行；Windows、真实浏览器、实体手机与部署环境也未验证。

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

## 依次完成的四步

1. 修复弱断言。授权测试使用有效图片和有效 ZIP，检查 DM 成功、玩家和撤权后失败，以及拒绝前后房间与素材目录不变。移动测试先验证观察者确实收到中间位置，再验证节流和最终落点。并发后发送一个明确的最终定位，检查所有连接都收到它，不再假定不同连接的到达顺序。先攻编辑真正输入新名称和数字后核对提交值。
2. 清理低价值检查。删除重复 Core 算法断言、重复公开字段投影断言、源码字符串切片检查和固定装饰数量断言。按钮位置与玩家权限改为检查实际 DOM，批量入口缺失检查放在实际挂载的属性界面中，CSP 从真实 HTTP 响应检查。草稿保留、滚动和撤权行为与渲染次数专项分离。
3. 合并准备代码。`environment.ts` 负责 DOM 创建和全局属性描述符的安装/恢复；`helpers.ts` 提供统一事件等待器；`room-fixture.ts` 复用原先逐字重复的服务、连接及棋子准备。`support/` 保存容量与管理队列所需的专用夹具，避免把不同生命周期强行统一。
4. 按功能整理。拆开 `audit-repair`、`release-server`、`integration`、`ui-045`，将 `ui-040`、`ui-stage`、`render-boundaries` 改为功能名称。相机与笔记分开归档。更新 npm 子集入口与仓库指引。

## 断言与清理原则

- 拒绝路径使用有效业务输入，避免把格式错误误认成权限正确；必要时同时检查响应和副作用。
- 真实同步测试观察另一连接收到的结果；涉及多连接时显式建立最终状态，不假定跨连接顺序。
- 新测试先查对应功能文件；已有场景优先修正或参数化，不通过重复追加增长数量。
- 默认限额与自定义限额、模型投影与网络保密、旧存档迁移分别验证不同风险，继续保留。
- 渲染次数专项仍使用 memo 对象内部插桩，并包含改名触发计数的正向检查；只用于该项实现约束，不代表帧率。其变化不应要求修改 UI 行为测试。
- 不按固定数量或行数删除测试。保留独立故障价值，删除重复证明和实现文本锁定。

测试整理阶段的五项破坏实验见 [历史验证](history/VALIDATION-test-cleanup-2026-10-20.md)，0.6.1 本次执行结果见 [验证记录](VALIDATION.md)。
