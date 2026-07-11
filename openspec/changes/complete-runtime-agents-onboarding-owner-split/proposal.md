## Why

现有 Event Recorder、Onboarding 和 Agent 主配置的“拆分”仍把实现集中在巨型 owner 或一行 marker 文件中。结构测试只看文件存在和 facade 行数，无法证明生产控制流使用了新 owner。

## What Changes

- 将 Event Recorder 各 phase 的真实实现迁移到对应 owner，保持调用方 API。
- 将 Onboarding draft/review/run/secrets 的真实行为迁移到独立 service，并保留窄 facade。
- 收敛 Main Agent 配置，去除与阶段 Agent 重复或冲突的合同。
- 删除 marker 文件并强化生产 import、反向 re-export 和 300 行边界测试。

## Capabilities

### New Capabilities

- `real-runtime-onboarding-owners`: Runtime/Agents/Onboarding 真实职责归属与可验证生产引用合同。

### Modified Capabilities

- `module-boundary-debt-cleanup`: 文件存在不再算拆分完成。
- `runtime-service-decomposition`: Event Recorder 必须由 phase owner 实际承载。
- `multi-agent-configuration`: Main 配置只保留主协调职责。

## Impact

影响 Runtime event recorder、Agent 配置加载、Onboarding services、模块边界测试和文档；保持公开 exports、HTTP shape 和 onboarding 持久化兼容。
