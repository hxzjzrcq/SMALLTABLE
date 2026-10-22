# 0.6.6 验证（2026-10-22）

基线文件与 SHA-256 见 BASELINE.json。本次仅更新 README 署名、Delete 快捷键及相关文档、版本、测试和构建；房间 schema 与依赖版本不变。0.6.5 验证原样保存在 history/VALIDATION-0.6.5.md，不作为本次重跑结果。

## 实际执行

Linux x86_64，Node v24.19.0，npm 11.9.0。复用该工作区已安装的 0.6.5 锁定依赖目录，本次没有重新执行 npm ci 或联网下载。真实浏览器为本机 Chromium 153.0.8010.0，由 SMALLTABLE_CHROMIUM 指定。仅使用临时测试房间。

| 命令 | 结果 | 证据（相对 docs） |
| --- | --- | --- |
| npm run format | 已执行，已有历史记录恢复原始字节 | 当前源码 |
| npm run build | 通过，包含类型检查和全部构建产物 | validation-0.6.6-2026-10-22/build.log |
| npm run check | 通过 | validation-0.6.6-2026-10-22/typecheck.log |
| npm run test:stage | 8 项通过 | validation-0.6.6-2026-10-22/stage.log |
| node --import tsx --test test/shortcuts.test.ts test/token-controls.test.ts test/ui-state.test.ts test/board-drawing.test.ts test/transparent-token.test.ts | 5 项通过 | validation-0.6.6-2026-10-22/shortcuts-and-board.log |
| SMALLTABLE_CHROMIUM=/tmp/st-chromium/chrome node --import tsx test/browser-shortcuts-066.ts | 通过 | validation-0.6.6-2026-10-22/browser-shortcuts.log |

构建存在第三方 Zod PURE 注释位置提示和宿主 npm http-proxy 配置提示，构建成功；未修改依赖以掩盖提示。

## 实现与证据核查

- README 开头可见“本项目主要由 GPT6.1SOL 制作”。版本、锁文件为 0.6.6。
- App 仅注册 Delete，通过统一保护入口调用既有 `actions.send({type:'delete',id})`。确认一次；取消不发送。没有新增服务端删除实现、素材库或按键配置。
- 真实浏览器：普通玩家无删除提示；DM 取消后棋子仍在；确认后棋子移除，另一个独立 WebSocket 连接收到删除快照。
- 真实浏览器：Shift+Delete 不触发，重复 keydown 不再次弹框；输入文字时 Delete 正常删字，棋子保留；属性工具窗口中不触发。删除后无选中目标时 Delete 不触发。
- 单元验证输入框、文本域、下拉框、按钮、可编辑子节点、组合键、输入法组合、长按、禁用、弹窗和监听卸载；事件被消费后不会继续执行其他快捷键。
- 回归覆盖原有棋子选择、拖动、旋转、画线、草稿及撤权界面，以及阶段测试。服务端与共享协议源码逐字节对比基线未修改，Core 源码与全部既有历史记录未修改。
- 先实现并执行上述测试，再对照代码调用路径、日志与打包哈希复核；未调用额外独立审查代理。

## 未执行

未重跑完整房间、Core、0.6.5 音乐和资源浏览器套件；这些不在本次修改路径，不声称本次通过。未验证实体 Windows 键盘、实体手机、线上部署或任意第三方浏览器。本次没有推送 GitHub、部署或操作线上数据。
