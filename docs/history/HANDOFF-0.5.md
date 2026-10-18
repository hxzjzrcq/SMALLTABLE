# SMALLTABLE 0.5.0 交接

> 历史记录，不作为当前维护指令；当前入口见 [README](../../README.md)。本文中的“当前”“本轮”和操作指令仅指当时版本。文中 `VALIDATION.md` 指当时的验证记录，现已由当前版本记录替换。

基于交付的 SMALLTABLE-v0.4.5-完整源码.zip，接入用户提供的 smalltable-login.html。输入设计 SHA-256：5dddd9f2f4b34775546ae0c1414bc2ea1d97b9f4fa6adbbeb0309fc4eadcc3f1。

## 范围与实现

仅装修登录页。后台、共享模型、DNDROLL Core、桌面内部组件和原有 styles.css 与 0.4.5 逐字节相同。版本升至 0.5.0，schemaVersion 仍为 2。没有新增依赖，没有 Kimi 部署适配，没有执行部署。

LoginPage.tsx 接收 connection、error、notice 和提交/编辑回调；表单仍由 SmalltableClient.join 登录。没有新增 fetch/WebSocket/密码持久化路径。连接中禁止重复提交；WebSocket 成功但尚无房间快照时显示“正在同步桌面”。密码提交后清空输入；错误文本按实际返回显示。门前动画区分密码错误和通用失败，不把满员或网络故障描述为口令错误。

src/client/login/login.css 保留纸色与地城风格，全部采用 st-login 范围；登录品牌使用 div 避免原有全局 header 样式。App 未入房时独立渲染登录页，避开桌面 .app 的固定高度及 overflow:hidden。私人笔记入口保留。手机单列、自然滚动、安全区留白；短屏/触屏横屏隐藏装饰区。主 HTML viewport 增加 viewport-fit=cover。

src/client/login/scene.js 从样品提取纯装饰逻辑，配 scene.d.ts；不包含演示控件、表单网络或 window 全局 API。mountLoginScene 返回 setState/destroy。React 卸载时停止 interval、移除可见性和减少动态效果监听并清空节点，支持再次入房和 React 重挂载。动画保留 377 格、110ms 节拍、变化缓存。

main.tsx 在 App 依赖执行前引入前端 csp.ts，调用 z.config({jitless:true})。这是为了让 Zod 直接使用解释执行，避免它在严格 script-src self 下进行一次会被拦截的可选 eval 能力探测；服务端、验证规则、依赖版本及 CSP 均未修改。登录脚本由 Vite 输出为外部模块，没有放宽脚本策略。

## 维护与验证

登录表单：src/client/components/LoginPage.tsx。装饰动画与类型：src/client/login/。入口及浏览器 CSP 配置：src/client/main.tsx、csp.ts。原有桌面和其他工具仍由 App 渲染。

本轮验证见 VALIDATION.md。浏览器检查使用临时 QA 环境，未把浏览器二进制、QA 数据、截图或测试密码配置打入源码包。

继续挂起：图片限额、刷新登录状态、正式部署密码和代理配置。重新交给 Kimi 时，以本包为业务主线，部署适配单独维护。不要恢复旧版整个发布包覆盖新功能。
