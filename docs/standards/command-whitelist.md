# super helper 命令白名单

`super helper` 的目标是查询和解释项目，不做内容更改。

## 宿主进程命令白名单

默认只允许服务进程启动一个外部命令：

- `claude`

如果本地调试需要替换 Claude Code 可执行文件，必须显式写入 `claude.commandWhitelist`。不在白名单里的宿主命令会被拒绝，转为诊断日志中的错误，不会执行。

## Claude Code 工具白名单

发给 Claude Code 的每次调用都会同时设置：

- `--tools Read,Glob,Grep`
- `--allowedTools Read,Glob,Grep`

也就是说 Claude Code 只能读取文件和搜索文件，不能修改项目。

## Claude Code 禁止工具

每次调用都会设置 `--disallowedTools`，默认禁止：

- `Bash`
- `Edit`
- `Write`
- `MultiEdit`
- `NotebookEdit`
- `WebFetch`
- `WebSearch`

因此 Claude Code 不能执行项目命令、启动服务、运行测试、访问数据库、写文件、改文件、联网抓取信息或改变外部系统状态。

## 提示词边界

每次调用 Claude Code 都拆成两部分：

- `--system-prompt`: 固定系统规则、安全边界、输出 JSON schema。
- 最后的用户 prompt: 仅包含 `DiagnosticRequest JSON`，作为数据输入。

用户输入不会拼进系统提示词。Claude Code 必须把用户 payload 当作数据，而不是新的系统规则。

## 长任务策略

默认 `claude.timeoutMs` 是 `1200000` 毫秒。设置为 `0` 时表示不由 `super helper` 主动超时中断。长任务期间前端通过 `/api/session` 和 `/api/logs` 轮询状态，不展示中间答案，只展示处理阶段，直到最终回答写入会话。

## Session busy 策略

同一个 `claudeSessionId` 在 `super helper` 进程内会串行执行。如果 Claude Code 仍返回 `Session ID ... is already in use`，系统会按以下配置等待并重试：

- `claude.sessionBusyMaxRetries`
- `claude.sessionBusyRetryDelayMs`

重试过程保留在诊断日志中。
