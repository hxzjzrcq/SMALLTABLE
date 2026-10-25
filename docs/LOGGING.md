# 运行日志

服务端使用 `src/server/log.ts` 输出单行 JSON。沿用 Node console，不增加日志依赖、不在程序内创建日志文件、收集器或轮转任务。

```json
{
  "time": "2026-10-20T00:00:00.000Z",
  "level": "error",
  "event": "storage.save_failed",
  "code": "ENOSPC",
  "errorType": "Error",
  "errorMessage": "ENOSPC: no space left on device"
}
```

`time` 是 UTC ISO 时间；`level` 为 info、warn、error、fatal；`event` 为固定事件名。info 写 stdout，其余写 stderr。按事件可附固定枚举 scope/reason、信号、端口、退出码及错误摘要 errorType/errorMessage。错误码 code 接受不超过 80 字符的字母开头标识（字母、数字、点、下划线、连字符），不再按已知错误码白名单过滤。

## 事件

| 严重程度 | 事件                                             | 含义                                                |
| -------- | ------------------------------------------------ | --------------------------------------------------- |
| info     | process.starting / started / stopping / stopped  | 启动、监听成功、收到 SIGTERM/SIGINT、关闭完成       |
| warn     | auth.login_failed / auth.dm_failed               | 房间登录失败、DM 解锁/管理授权失败                  |
| warn     | rate_limit.triggered                             | 登录、DM/改密、上传、WS 消息或投骰触发既有限流      |
| warn     | websocket.rejected                               | 升级被拒、无效命令或二进制消息、连接过慢、心跳失效  |
| error    | storage.save_failed / load_failed                | 房间存档写入或读取失败；新建桌面没有存档不算错误    |
| error    | backup.create_failed / restore_failed            | 备份导出或恢复请求失败                              |
| error    | image.process_failed                             | 图片检查、解码/转码或图片请求处理失败               |
| error    | websocket.error / server.error                   | WS/WSS 错误或监听后的 HTTP 服务器错误               |
| error    | config.load_failed / process.shutdown_failed     | 重要配置加载失败或关闭清理失败                      |
| error    | resource.cleanup_failed / music.failed           | 资源清理或音乐处理失败                              |
| fatal    | process.startup_failed                           | 启动失败                                            |
| fatal    | process.uncaught_exception / unhandled_rejection | 未捕获异常或未处理 Promise 拒绝，记录后以非零码退出 |
| fatal    | process.abnormal_exit                            | 可执行入口观察到非零退出码                          |

一个失败可同时属于多个类别，例如图片问题导致恢复失败，或启动失败随后非零退出。这里只记录失败边界，不逐条记录棋子移动、正常同步广播、鼠标操作、正常登录或成功保存。

## 隐私与业务边界

日志只提取异常的 name、message、code 标量字段；字符串及数字等拒绝原因也可记录，不展开未知对象，不输出 stack/cause、请求或房间正文。文本摘要清除控制字符，最多 512 字符；对凭证字段、Authorization/Cookie、Bearer、长十六进制标识、文件路径和引号内的数据片段进行遮蔽。错误说明保留操作原因，调用方不得把密码、会话凭证、DM 私有说明、玩家私人笔记或完整业务输入拼入异常；无标签的任意敏感正文无法靠文本规则可靠识别。已有发给操作用户的响应仍沿用原逻辑，日志不改变权限或存档结果。

日志输出异常被隔离，不向业务抛出，也不递归输出日志系统自己的错误。异常退出处理器仅在服务端可执行入口安装，导入服务函数不会给宿主进程添加全局处理器。

SIGKILL、断电或运行环境直接终止进程时，程序无法执行退出日志；这类退出状态由运行环境记录。fatal 后不尝试继续提供服务。

## 收集与轮转

由启动服务的终端、容器或进程管理器收集 stdout/stderr，并按其能力设置保留期限和轮转。不要把运行日志写入房间存档或备份，也不要提交到 GitHub。程序不提供额外监控、日志文件配置或自动轮转功能。

资源回收失败不减少已用容量；事件沿用上述错误摘要，不转储媒体内容。
