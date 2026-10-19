# 当前配置与限额

适用于 SMALLTABLE 0.6.0。启动时读取工作目录的 `smalltable.config.json`；也可用 `SMALLTABLE_CONFIG` 指定路径。默认路径缺失时使用默认值；显式指定路径但文件缺失、JSON 损坏或配置非法则拒绝启动。没有热更新，修改后重启生效。

默认值的代码权威位置是 `src/shared/limits.ts`。随包 JSON 为完整默认示例，可只保留需要覆盖的部分；未写字段使用默认值。根对象和每个分组均拒绝未知字段；所有值必须是正安全整数，不接受数字字符串、零、负数或小数。拒绝计算后的预算或时间、棋子像素预算超出安全整数范围的配置。各项独立，无旧 15／255 隐藏硬上限；增加限额会增加内存、处理与广播成本，部署者需按自己的硬件验证承载能力。

| JSON 路径                |   默认值 | API / 快照 caps 字段 |
| ------------------------ | -------: | -------------------- |
| limits.players           |       15 | maxSeats             |
| limits.tokens            |      255 | maxTokens            |
| limits.privateNotesBytes |    65535 | maxNotesBytes        |
| limits.initiativeEntries |      255 | maxInitiative        |
| limits.drawings          |      255 | maxDrawings          |
| limits.rollHistory       |      255 | maxRolls             |
| limits.names             |      255 | maxNames             |
| images.mapBytes          | 10485760 | mapBytes             |
| images.mapPixels         | 16000000 | mapPixels            |
| images.mapEdge           |     8192 | mapEdge              |
| images.tokenBytes        |   131072 | tokenBytes           |
| images.tokenEdge         |      256 | tokenEdge            |
| session.idleMinutes      |       30 | idleMs（转换为毫秒） |

`limits.names` 是显示名称的条目数；每个名称仍遵守原有 128 个 UTF-8 字节规则。棋子名称、注释、表达式、坐标等既有字段约束没有放宽。私人笔记按 UTF-8 字节计算，中文通常占多个字节。已有笔记即使超过降低后的限额也可读取、复制和导出，写入仍按当前限额检查；配置尚未取得时笔记只读。

部分覆盖示例：

```json
{
  "limits": { "players": 20, "tokens": 300, "privateNotesBytes": 100000 },
  "images": { "tokenEdge": 512 },
  "session": { "idleMinutes": 45 }
}
```

有效限额用于 API、快照、界面计数及操作、命令校验、磁盘房间读取与保存及备份恢复。地图限制同时检查字节、总像素和单边，棋子图片检查字节和单边（总像素预算为单边平方）。当前只接受静态 PNG/JPEG/WebP；上传后转 WebP。磁盘已有引用在启动读取时检查，降低限额使现有数据越界时拒绝载入，不静默截断或删除。

`src/server/config.ts` 的 `backupLimits` 集中计算 room.json、ZIP 字节及条目预算；以各集合的最大序列化预算、地图、所有棋子图片和 ZIP 开销派生，不再固定 257 条目或多处维护公式。HTTP 恢复和 Storage 使用同一预算。WebSocket 最大命令字节数也随名称名单预算增长，避免配置已增大却被旧 64 KiB 传输上限挡住。预算是输入边界，不是内存峰值保证；恢复的已知开销见 [安全](SECURITY.md#数据边界)。

## 运行环境变量

| 变量                       | 行为                                                                                  |
| -------------------------- | ------------------------------------------------------------------------------------- |
| HOST                       | 默认 127.0.0.1                                                                        |
| PORT                       | 默认 3000；1–65535 整数                                                               |
| DATA_DIR                   | 默认 ./data，相对工作目录解析                                                         |
| COOKIE_SECURE              | true 为会话 Cookie 添加 Secure；HTTPS 部署使用                                        |
| SMALLTABLE_CONFIG          | 指定限额 JSON 路径，默认 smalltable.config.json                                       |
| ROOM_PASSWORD、DM_PASSWORD | 仅首次凭证初始化，由启动组装层取得；完整规则见 [密码管理](SECURITY.md#密码管理与重置) |

`DNDROLL_URL` 已删除，不再作为配置项读取或暴露。属性工具始终加载同源 `/dndroll.html`。

## 从旧环境变量迁移

先停止旧服务，把已有值原样转入 JSON，再从 `.env`、容器或服务管理器中移除对应变量。0.6.0 检测到这些变量时拒绝启动并指出迁移目标，不静默忽略已有设置，也不保留两套覆盖优先级。

| 旧变量       | JSON 路径           |
| ------------ | ------------------- |
| MAX_SEATS    | limits.players      |
| IDLE_MINUTES | session.idleMinutes |
| MAP_BYTES    | images.mapBytes     |
| MAP_PIXELS   | images.mapPixels    |
| MAP_EDGE     | images.mapEdge      |
| TOKEN_BYTES  | images.tokenBytes   |
| TOKEN_EDGE   | images.tokenEdge    |

升级其它注意事项见 [0.6.0 升级](UPGRADE-0.6.0.md)。
