# SMALLTABLE 0.6.1 小更新

日期：2026-10-20。当前统一版本号为 `0.6.1`，不再给本轮交付追加 fix 或 test-cleanup 后缀。

远端起点为 GitHub main `1f4a5a6acb1796a1b9e5f2cd792e06de18646f4c`，保留该提交对 README 的精简。功能基线是已有 0.6.0；同时合入此前完成的测试工程整理包 `SMALLTABLE-2026-10-20-test-cleanup-source.zip`，SHA-256 为 `0a1a9749a5606ce4688601cb103f3f6cbbc5f44ec112bf7e27f7569e7750823d`。

## 本轮内容

- 增加轻量单行 JSON 日志，统一时间、事件和严重程度。覆盖进程、认证失败、限流、存档、恢复、图片、WebSocket 和配置失败。具体边界见 [运行日志](LOGGING.md)。
- 合入测试断言修复、重复检查清理、准备代码复用和按功能归档；增加日志隐私、真实错误路径与子进程生命周期验证。测试导航见 [测试维护](TESTING.md)。
- package.json 与锁文件的根版本号统一为 0.6.1。未增加、删除或升级依赖；未改动 Core 规则、前端业务、房间协议或存档格式。

## 升级

停止原服务，保留现有数据目录及 credentials.json，替换源码后按原流程执行：

```bash
npm ci
npm run build
npm start
```

不需要数据迁移，不重置密码，不清空房间，也不把运行锁或 node_modules 作为升级数据复制。日志使用 stdout/stderr，收集和轮转交由运行环境。GitHub 按既有忽略规则不提交生成目录，完整源码 ZIP 附构建产物。

本轮同步源码，不部署服务。本次实际验证与边界见 [验证记录](VALIDATION.md)。
