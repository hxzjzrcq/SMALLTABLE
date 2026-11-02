# SMALLTABLE 0.7.6 验收记录

日期：2026-11-02。唯一基线：GitHub main 0.7.5，3c29f694abe1fc83942b17824a0e7609c5bbeb14。
环境：Linux、Node.js v24.22.1。未新增依赖，未修改 Core 规则源码。

已执行：
- npm ci、npm run format、npm run build：成功。后续新增文件再用 Prettier 格式化，最终构建成功。
- node --import tsx --test test/iteration-076.test.ts test/iteration-072.test.ts test/iteration-067.test.ts test/storage-integration.test.ts：14/14 通过。
- node --import tsx --test test/token-controls.test.ts test/board-drawing.test.ts test/initiative-ui.test.ts test/config.test.ts test/security-boundaries.test.ts：9/9 通过。
- node --import tsx --test test/ui-076.test.ts：1/1 通过。
- 新增血量盘 ZIP 恢复断言后重跑 iteration-076.test.ts：1/1 通过（不重复计数）。
- git diff --check：通过。

共 24 个不同测试通过。覆盖服务端批量可见性、公共棋子跳过、空标签、血量盘权限和字段 patch、磁盘保存及 ZIP 恢复、旧档拒绝，及 DOM 右键多选/隐藏/关闭和玩家字段遮挡。

未完成：真实 Chromium 浏览器验收。Playwright 下载的压缩包无效；尝试系统 /usr/bin/chromium 时启动报 socket() Operation not permitted。音乐收起持续播放断言已加入 test/browser-music-065.ts，但未实际执行到页面。右键拖动冲突、实际窗口边缘布局、触屏布局及音乐播放仍须本机浏览器验收；DOM 测试不能替代这些项目。

未执行完整 npm test、Windows CMD 启动、部署或 GitHub 推送。

房间使用 schema 5，拒绝旧存档，不提供迁移。血量盘隐藏为展示遮挡，完整记录仍同步；原棋子 secret 过滤不变。包不含 node_modules、.env、实际房间或私人启动配置。
