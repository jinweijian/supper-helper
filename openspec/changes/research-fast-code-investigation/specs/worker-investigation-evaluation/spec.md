## ADDED Requirements

### Requirement: Evaluation uses a real-question benchmark set
The research SHALL build a benchmark set of 20-30 real user questions sampled from persisted cases (`cases/*.json`) whose turns reached the diagnostic worker, classified into fact-finding (L1), multi-hop reasoning (L2), and ambiguous troubleshooting (L3) levels with at least 5 questions per level.

#### Scenario: Question set is sampled
- **WHEN** the benchmark set is produced
- **THEN** each entry records the question text, level, workspace root, and reference claims from the historical accepted run

#### Scenario: Historical baseline is computed
- **WHEN** historical case runs contain worker traces with start/finish timestamps
- **THEN** the Claude Code worker latency distribution (p50/p90) is reported from persisted traces before any rerun

### Requirement: Every candidate records the same metrics
Each candidate (baseline Claude Code worker, Spike A code RAG, Spike B constrained Claude Code, Spike C packed-context single call) SHALL record per-question end-to-end latency, token cost where available, and whether the output passes the existing deterministic result validator.

#### Scenario: Result is validated deterministically
- **WHEN** a spike produces a `DiagnosticResult`-shaped output for a benchmark question
- **THEN** it is run through the existing `validateDiagnosticResult` logic and the pass/fail outcome is recorded

#### Scenario: Quality is human-scored
- **WHEN** the benchmark run completes for a candidate
- **THEN** at least 5 questions per level receive a 1-5 human score for answer usefulness against the original question

### Requirement: Research produces a decision artifact
The research SHALL conclude with a decision matrix comparing candidates on L1 latency, quality, validator pass rate, token cost, and implementation/maintenance cost, plus an explicit recommendation (single candidate, two-speed combination, or constrained Claude Code only).

#### Scenario: Decision is recorded
- **WHEN** the research completes
- **THEN** the change contains a findings document with the comparison table, the chosen direction, and the rationale tied to measured numbers

#### Scenario: Spikes stay out of production code
- **WHEN** spike prototypes are written
- **THEN** they live under the change directory and `src/` remains unchanged by this research change
