## Context

Gateway 当前无 body 上限，顶层异常直接返回原始 message；FileMemoryStore 直接把 caseId 拼进路径并覆盖写 JSON。LAN 无鉴权是明确内测选择，但不等于接受路径穿越、资源耗尽或损坏持久化。

## Goals / Non-Goals

**Goals:**

- 在无鉴权前提下建立输入、路径、错误和文件写入的最小安全边界。
- 保持合法请求、公开 DTO、Case 顶层 shape 和 LAN 行为兼容。

**Non-Goals:**

- 不实现登录、token、RBAC、tenant 身份或 CSRF 策略。
- 不支持多进程同时写同一个 Case。

## Decisions

1. 公共 caseId 接受 `^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$`，拒绝斜杠、点号、空白和编码后路径分隔符；repository 再用 `resolve` + `relative` 验证最终路径位于 cases 目录。
2. Gateway 的 JSON reader 在累计超过 1,048,576 bytes 时销毁读取并抛出稳定 `PayloadTooLargeError`；chat message UTF-8 长度不得超过 65,536 bytes。
3. workspaceId 必须命中当前 config；新建 Case、知识操作和 chat 都使用同一解析函数。
4. Gateway 将已知输入错误映射为 400/404/409/413；未知错误先用中立 redaction 清理后写审计/控制台，用户只看到 `internal server error`。
5. Case 保存写入同目录唯一临时文件，调用 `writeFileSync`、`fsyncSync`、`renameSync`；失败时删除临时文件并保留旧文件。listCases 忽略临时文件。

## Risks / Trade-offs

- [严格 caseId 可能拒绝历史安全 ID] → 兼容所有现有字母数字、下划线、连字符 ID，只拒绝路径元字符。
- [1 MiB 上限影响超长粘贴] → chat 单条 64 KiB 已足够诊断；返回明确 413 而不是断连。
- [原子 rename 不解决多进程竞争] → 文档明确单进程边界，未来数据库 change 单独处理。

## Migration Plan

无需 Case schema 迁移。先用旧 fixture 验证可读，再切换写入实现；临时文件命名不得匹配 `*.json` Case 扫描规则。

## Open Questions

无。LAN 鉴权明确不在本 change。
