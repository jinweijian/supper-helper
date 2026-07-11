## Why

当前本地 Gateway 对 caseId、workspaceId、请求体大小和异常输出缺少统一防线，Case 文件也使用非原子写入。即使 LAN 鉴权暂缓，这些问题仍会造成目录穿越、内存耗尽、敏感错误泄漏或 Case 损坏。

## What Changes

- 校验安全路径段和 workspace allowlist，并对 Case 路径做 containment 防御。
- 限制 JSON body 为 1 MiB、单条消息为 64 KiB，超限稳定返回 413。
- 统一脱敏内部错误与稳定公共错误响应。
- 使用同目录临时文件、flush 和 rename 原子保存 Case。
- 保留无鉴权 LAN 内测行为和既有 API/Case shape。

## Capabilities

### New Capabilities

- `local-gateway-case-safety`: 无鉴权本地服务的输入、路径、错误与原子 Case 存储安全合同。

### Modified Capabilities

- `runtime-behavior-compatibility`: 非法输入新增稳定 400/413 行为，合法请求 shape 不变。

## Impact

影响 Gateway HTTP utilities/routes、Session file adapter、配置校验、错误脱敏和真实 HTTP/文件系统验收；不新增登录、令牌、租户授权或多进程写支持。
