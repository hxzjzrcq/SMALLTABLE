# SMALLTABLE 0.5.2 交接（GitHub MAIN 历史版本）

> 历史记录，不作为当前维护指令；当前入口见 [README](../../README.md)。本文中的“当前”“本轮”和操作指令仅指当时版本。文中 `VALIDATION.md` 指当时的验证记录，现已由当前版本记录替换。

本记录属于 GitHub MAIN 的历史版本。

基线为 SMALLTABLE-v0.5.1-完整源码.zip。唯一功能修改在 src/client/components/Board.tsx：图片棋子不再绘制有色圆形或方形底板，改用透明的完整占地矩形承接指针事件；图片保持原有缩放和旋转方式，黄色选中框保留。无图片棋子的颜色、形状和文字保持原样。

没有添加投掷原因，没有修改骰子、协议、存档格式、后端、依赖或 DNDROLL Core。schemaVersion 保持 2。本次没有部署，也没有加入 Kimi 平台适配。dist 随源码重新构建。验证结果见 VALIDATION.md。
