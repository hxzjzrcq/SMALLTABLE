# SMALLTABLE 0.7.3 验证记录

日期：2026-10-24（Asia/Shanghai）。唯一源码基线：SMALLTABLE-0.7.2-完整源码.zip。仅修复连续放置重叠与玩家批量归还过期 ID；P3 移动预览清理逻辑未修改。

## 实际验证

环境：Linux，Node.js v24.19.0。使用锁定依赖执行 npm ci --ignore-scripts --no-audit --no-fund，安装 229 包；未更改依赖版本。运行项目格式化。

| 命令                                                                                                                                                                                                 | 结果                                | 证据                                   |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- | -------------------------------------- |
| npm run build                                                                                                                                                                                        | 通过（Core 构建、TypeScript、Vite） | validation-0.7.3/build.log             |
| node --import tsx --test --test-name-pattern='073\|birth center\|072 public take race\|batch deletion\|batch save failure' test/camera.test.ts test/iteration-072.test.ts test/iteration-067.test.ts | 7 通过，0 失败                      | validation-0.7.3/targeted-tests.log    |
| node --import tsx test/browser-placement-073.ts                                                                                                                                                      | 通过                                | validation-0.7.3/browser-placement.log |

浏览器设置 SMALLTABLE_CHROMIUM=/root/.cache/ms-playwright/chromium_headless_shell-1194/chrome-linux/headless_shell，使用实际 Chromium、页面和服务。首次执行新浏览器脚本因 evaluate 内局部函数被转译为依赖 __name 辅助函数而失败；修正测试脚本后重跑通过，无产品代码变更。日志中的 storage.save_failed 来自原有保存失败注入用例，不是意外保存错误。

## 覆盖与边界

- 视野中心原有边界行为；连续 49 个放置点互异，在缩放及世界正负边界附近保持可见、合法，视野完全在世界外时不生成。
- 同一浏览器任务内交替创建普通棋子与取用 A/B/C，不等待快照；六枚棋子在服务器具有不同坐标且均在可见视口内。改变相机后从新中心开始放置，无页面异常。
- 两玩家场景中，一人先归还多选中的一枚，另一人携带旧 ID 批量归还；其余公共棋子成功归还，另一连接收到快照，磁盘状态一致。
- 全部 ID 已过期的批量请求不增加 revision；混入仍存在的普通棋子整批拒绝；过期 epoch 仍拒绝。单枚删除的既有权限行为保持。
- 原有公共并发取用、归还重置、普通玩家权限、DM 批量删除单次保存、图片引用、保存失败保持状态用例通过。

按本次范围未运行全量房间测试、Core 独立测试、音乐/会话/移动预览浏览器套件，也未进行 Windows CMD 实机运行、真手机或部署验收。通用 CMD 沿用基线。0.7.2 历史验证见 history/VALIDATION-0.7.2.md，历史通过不计为本次结果。
