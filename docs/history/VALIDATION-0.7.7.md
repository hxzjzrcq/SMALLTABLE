# 0.7.7 验收记录

日期：2026-11-02。基线：本次会话交付的 0.7.6，未混用历史 ZIP 或远端变更。

改动：移除独立血量盘和顶部按钮；先攻条目增加仅 DM 可见的展开箭头及血量/其他数据草稿表单。私有内容由服务端投影过滤，断线清除客户端私有缓存；公开先攻修改保留私有内容。schema 6 拒绝旧档，无迁移。

依赖：npm audit fix 更新 body-parser 2.3.0 → 2.4.0、Vite 6.4.4 → 6.4.5；输出 found 0 vulnerabilities。未使用 --force。

验证环境：Linux，Node.js v24.22.1。
- npm run build：通过，包含类型检查。
- node --import tsx --test test/iteration-076.test.ts test/ui-076.test.ts test/initiative-ui.test.ts test/security-boundaries.test.ts test/storage-integration.test.ts test/session-controller-068.test.ts：17/17 通过。
- git diff --check：通过。

测试覆盖：私有字段快照过滤、DM 编辑权限、公开更新保留私有内容、保存/ZIP 恢复、原先攻操作、DOM 展开与撤权、无关先攻更新保留输入节点，以及相关存储、会话回归。

未执行真实浏览器验收、Windows CMD 或完整 npm test；本会话前次 Chromium 启动受环境限制。未推送 GitHub。
