# research-fast-code-investigation 任务

## 1. 评测集与 baseline

- [ ] 1.1 写抽样脚本（放 `spikes/`）：读取 `storage.rootDir/cases/*.json`，筛出走过真实 worker（run 含非 mock workerTrace）的回合，抽取 `answerGoal.resolvedQuestion`/`userGoal`、workspaceRoot、accepted claims 作为参照，输出 `spikes/benchmark/questions.jsonl`
- [ ] 1.2 人工过一遍题目并分级（L1 事实查找/L2 多跳/L3 模糊），每级 ≥5 题，总量 20-30 题
- [ ] 1.3 写 baseline 统计脚本：从历史 `workerTrace.startedAt/finishedAt` 计算 CC worker 延迟分布（p50/p90/max）与失败率，输出 `spikes/benchmark/baseline-history.md`
- [ ] 1.4 确认快速档模型清单（Spike B 用哪个模型、当前 CC 默认模型是什么），记录到 `spikes/benchmark/models.md`

## 2. Spike A：Code RAG 原型

- [ ] 2.1 实现最小 code chunker（按文件/行块 ~800 字符 + 路径前缀，不引 tree-sitter）与内存索引（BM25 + 复用现有 embedding provider）
- [ ] 2.2 实现单次合成调用：top 8 chunks + 精简版 worker prompt → `DiagnosticResult` JSON（复用 `createModelClient` 与 `validateDiagnosticResult`）
- [ ] 2.3 在评测集上跑 A，记录延迟/token/可审核率到 `spikes/benchmark/results/spike-a/`

## 3. Spike B：CC 降速版

- [ ] 3.1 实现 B 运行脚本：现有 `claude -p` 参数 + `--model <快速档>` + max-turns 限制，其他与现状一致
- [ ] 3.2 在评测集上跑 B，记录延迟/costUsd/可审核率到 `spikes/benchmark/results/spike-b/`

## 4. Spike C：打包式单次调用

- [ ] 4.1 实现 C 运行脚本：复用 A 的召回选 top 文件/片段，打包单条 prompt，单次 LLM 调用输出 `DiagnosticResult`
- [ ] 4.2 在评测集上跑 C，记录延迟/token/可审核率到 `spikes/benchmark/results/spike-c/`

## 5. 评估与决策

- [ ] 5.1 汇总脚本生成四方对比表（延迟 p50、可审核率、token 成本）
- [ ] 5.2 人工评分：每方案每级 ≥5 题按"是否解决原始问题、步骤是否可执行"打 1-5 分
- [ ] 5.3 （附带小验证）选 5 题模拟"knowledge 与 worker 并行"的体感延迟，记录差值
- [ ] 5.4 写 `spikes/benchmark/findings.md`：决策矩阵 + 选型结论（单选/双速组合/维持 CC+降速参数）+ 数据依据
- [ ] 5.5 评审结论，决定后续实施 change（`add-fast-code-investigator` 或放弃/降级）
