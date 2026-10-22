# 0.6.6 小更新（2026-10-22）

唯一基线：`SMALLTABLE-2026-10-22-v0.6.5-完整源码.zip`，SHA-256 见根目录 BASELINE.json。未混入 GitHub 或其他源码包。

README 开头注明本项目主要由 GPT6.1SOL 制作。新增 DM 的 Delete 快捷键，弹出一次确认后发送现有删除命令；取消不提交。未增加其他快捷键、自定义按键或素材库。完整保护条件见 [UI](UI.md#键盘快捷键)。

`shortcuts.ts` 集中处理快捷键监听、保护和卸载，App 绑定现有控制器；Board 点击后取得焦点，避免编辑框的旧焦点拦截正常桌面操作。未更改服务端删除、权限、资源回收或 DNDROLL Core。房间 schema 仍为 3，依赖版本不变。

交付完整源码及重新构建的 dist；安装/启动沿用 README。未推送或部署。本次验证见 [VALIDATION](VALIDATION.md)，0.6.5 验证保留为历史。
