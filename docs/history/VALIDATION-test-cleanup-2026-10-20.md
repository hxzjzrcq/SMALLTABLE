> 历史记录：仅用于追溯对应版本，不作为当前操作指南。当前使用见[帮助](../../帮助.md)，开发见[开发导读](../../DEVELOPMENT.md)。

# SMALLTABLE 测试整理验证记录

交付日期：2026-10-20，Asia/Shanghai。直接基线：SMALLTABLE-060fix-2026-10-20-完整源码.zip。基线 SHA-256 与四步变更见 [测试整理记录](TESTING-cleanup-2026-10-20.md)。npm 版本仍为 0.6.0-fix。

| 本次检查           | 结果                                                                                            |
| ------------------ | ----------------------------------------------------------------------------------------------- |
| npm run build      | 通过，含 TypeScript 和 Core 浏览器构建                                                          |
| npm run check      | 通过                                                                                            |
| npm test           | 66 项通过，0 失败、0 跳过                                                                       |
| npm run test:core  | 97 项通过，0 失败、0 跳过                                                                       |
| npm run test:stage | 8 项通过，0 失败、0 跳过；是房间套件子集                                                        |
| 隔离破坏实验       | 5/5 被相应测试识别                                                                              |
| 基线逐字节比较     | src/、packages/、scripts/、dist/ 和 package-lock.json 不变；package.json 只更新 test:stage 路径 |

房间用例由 70 项变为 66 项：删除 5 个重复或低价值用例，将渲染专项从行为测试独立出来增加 1 项。笔记迁移用例保留并移入笔记文件。测试数量不作为质量指标。

执行输出保存在 validation/2026-10-20-test-cleanup-build.txt、validation/2026-10-20-test-cleanup-room.txt、validation/2026-10-20-test-cleanup-core.txt、validation/2026-10-20-test-cleanup-stage.txt 和 validation/2026-10-20-test-cleanup-types.txt。保存失败场景主动注入的 simulated disk failure 是预期日志。

## 隔离破坏实验

实验只修改临时副本；交付不含这些破坏。

| 故意引入的错误                | 检测结果                       |
| ----------------------------- | ------------------------------ |
| 删除图片上传前后两处 DM 检查  | 权限断言失败                   |
| 删除 ZIP 恢复前后两处 DM 检查 | 权限断言失败                   |
| 丢弃所有非最终位置更新        | 观察者收不到中间位置，测试失败 |
| 删除非最终位置节流            | 广播数量超限，测试失败         |
| 先攻名称输入不更新状态        | 提交旧名称，测试失败           |

结果见 validation/2026-10-20-test-cleanup-mutations.json，详细输出为同目录的 2026-10-20-mutation-*.txt。这些实验只证明相应断言能够识别上述错误。

## 本次边界

未重新运行 Unix PTY 专项，未进行 Windows 终端、真实浏览器视觉或帧率、实体手机、长时间负载、部署与依赖安全审计。Core 全部文件未修改。此前 060fix 验证保留在 [历史记录](VALIDATION-060fix.md)。未部署，未更新 GitHub。
