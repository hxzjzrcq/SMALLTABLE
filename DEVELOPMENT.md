# SMALLTABLE 0.7.3 开发导读

唯一源码基线为 SMALLTABLE-0.7.2-完整源码.zip。本版仅修复连续放置与批量归还过期 ID，见 docs/UPGRADE-0.7.3.md；0.7.2 需求见随包任务书；现行合同由 README 的文档归属表指向，不以历史升级说明拼接现状。

- 房间结构、公共身份、棋面文字与消息：src/shared/model.ts。普通棋子和公共棋子共用 tokens；公共盒中的剩余身份由 A–Z 减去在桌身份推导。
- 服务端入口：src/server/app.ts。全部房间变更经过 enqueue；管理操作先保存候选再发布，移动回执只表示接受，同步 revision 与落盘 savedRevision 分开。
- 权限：src/server/permissions.ts 登记入口，命令分支继续校验对象权限。PL 删除只能处理公共棋子，混入仍存在的普通棋子整体拒绝，已经不存在的 ID 跳过。
- 会话：src/server/sessions.ts。在线不按用户活动过期；断线起固定 45 分钟恢复资格，15 秒握手占位独立。HTTP 使用 HttpOnly Cookie，浏览器脚本不读取会话凭证。
- 客户端：src/client/controller.ts 管理连接、上传阶段、最终移动预览与回执；组件不另开网络或落盘通道。Board 管理活动手势和相机，停止手势后使用控制器中的等待回执位置。
- 隐藏是暂时收起对象，公开列表和坐标继续可见；DM 私有说明始终通过服务端投影过滤。

先 npm ci，再 npm run build。npm test 为完整房间测试；新增 test/iteration-072.test.ts 和 session-controller-068.test.ts 中的 072 用例检查本版行为。浏览器验收脚本为 test/browser-072.ts；SMALLTABLE_CHROMIUM 可指定已有 Chromium。运行结果以 docs/VALIDATION.md 为准。

不要修改 packages/dndroll-core 规则，不添加账号、所有权、隐藏图层、批量移动或另一套桌面引擎。公开包保留通用 START-SMALLTABLE.cmd，不能加入私有地址、口令、运行数据或依赖目录。
