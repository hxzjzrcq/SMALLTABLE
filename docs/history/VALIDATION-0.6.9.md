# 0.6.9 验证记录（2026-10-22）

唯一源码基线是交付的 0.6.8 ZIP，哈希见根目录 BASELINE.json。测试环境：Linux、Node.js 24.19.0；原生浏览器为本次环境已有 Chromium 二进制，通过 SMALLTABLE_CHROMIUM 指定。

| 检查                                              | 结果                                                                    | 证据（docs/validation-0.6.9-2026-10-22/）                          |
| ------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------ |
| npm run build                                     | 通过，含 tsc --noEmit、Core 产物及前端构建                              | build.log                                                          |
| npm test                                          | 114 项通过，0 失败                                                      | room-tests.log                                                     |
| 最后清理代码后的控制器及 React 定向复核           | 8 项通过，属于完整套件子集，不重复累加                                  | controller-final.log                                               |
| npm run test:stage                                | 8 项通过，属于完整套件子集，不重复累加                                  | stage.log                                                          |
| browser-recovery-069.ts                           | 5 组通过：开发音频、三次重连保留现场、手动恢复、满员/冲突分支、主动退出 | browser-recovery.log                                               |
| browser-session-068.ts                            | 原有 12 组通过，含实际服务端满员恢复、接管、被踢、刷新及断网退出        | browser-session.log                                                |
| browser-music-065.ts                              | 通过；同步差约 0.17 秒                                                  | browser-music.log                                                  |
| 独立目录 npm ci --omit=dev --offline 后 npm start | 通过；无 Vite，保留 tsx，首页及配置接口均为 200                         | production-install.log、production-start.log、production-check.txt |

开发浏览器测试使用当前 Vite 配置及真实 5173→3000 路径，实际上传 MP3、通过 Cookie 请求 /audio、由原生 Audio 解码播放，没有伪造音频响应。断线测试主动关闭浏览器 WebSocket 并拦截会话恢复请求；观察真实 iframe DOM 及其 contentWindow 标记在重试后仍保留。满员与冲突的这一组 UI 分支注入 409 响应，服务端规则由 session-068 实际 HTTP/WS 测试覆盖；不将注入响应称为真实并发冲突验收。

限流测试保留登录总体上限，验证六次错误登录不会耗尽工具箱限额，耗尽工具箱限额不阻碍授权改密；既有密码测试继续验证改密自身的第五次限额及严格请求结构。

## 首轮问题与复核

首轮完整套件 114 项中有 1 项失败：旧密码测试把一次工具箱解锁计入改密共用桶。隔离限流后，改密应独立消耗五次；补足第五次错误改密后完整套件通过。旧会话测试中的直接 DM 登录共用工具箱桶断言也已更新，同时保留容量并发及登录总限流断言。首轮记录见 first-room-tests.log。

开发入口首轮发现 Vite 字符串形式代理改写 Host，登录被同源检查拒绝。改为显式 changeOrigin:false，保留后端来源校验，再通过实际登录、上传与播放验证。首轮证据见 first-dev-browser.log。

## 边界与未实测事项

- 未部署、未推送 GitHub；未实测公网线路、实际反向代理、HTTPS 或真实手机。390 像素窄屏由既有浏览器会话脚本覆盖。
- 保留 TCP 对端 IP 限流；反向代理或共同出口仍可能共用各自限流桶，未引入可信代理机制。
- 本轮播放检查允许浏览器自动播放，以验证路由与播放链路；没有重新完成原生自动播放拦截→点击恢复专项。0.6.8 的这一验收缺口仍存在，历史结果见 history/VALIDATION-0.6.8.md。
- DNDROLL Core 与房间结构没有修改，未重复运行完整 Core 独立规则套件；stage 包含 Core 源码一致性检查。
