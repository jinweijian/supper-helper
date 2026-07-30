export { KNOWLEDGE_DIRECTORIES, taxonomyTemplates } from './template-catalog.js';
export { evidenceChunkSchemaExample, sourceMetadataExample } from './template-examples.js';

export const documentTemplates: Record<string, string> = {
  'faq/README.md': `---
id: kb_faq_general_example
title: 示例 FAQ
type: faq
module: general
intent: how_to
source_type: faq
confidence: medium
status: draft
visibility: internal
product_versions: []
related_terms: []
related_repos: []
last_verified_at: 2026-06-13
owner: knowledge-admin
---

# 示例 FAQ

## 问题

这里写用户常见问法。

## 答案

这里写可以被证据支持的答案。
`,
  'runbooks/README.md': `---
id: kb_runbook_general_example
title: 示例 Runbook
type: runbook
module: general
intent: troubleshooting
source_type: runbook
confidence: medium
status: draft
visibility: restricted
product_versions: []
related_terms: []
related_repos: []
last_verified_at: 2026-06-13
owner: knowledge-admin
---

# 示例 Runbook

## 触发条件

## 快速判断

## 排查步骤
`,
  'whitepapers/README.md': `---
id: kb_whitepaper_general_example
title: 示例白皮书切片
type: whitepaper_slice
module: general
intent: product_rule
source_type: whitepaper
confidence: medium
status: draft
visibility: internal
product_versions: []
related_terms: []
related_repos: []
last_verified_at: 2026-06-13
owner: knowledge-admin
source_document: knowledge/_sources/whitepapers/example.pdf
source_document_id: src_whitepaper_example
source_pages: []
section_path: []
chunking_strategy: parent-child-v4
---

# 示例白皮书切片

## 可回答的问题

- 这个切片适合回答什么问题？

## 核心规则

## 适用范围

## 不适用范围

## 原文来源
`,
  'tickets/solved-cases/README.md': `---
id: kb_case_solved_general_example
title: 示例已解决 Case
type: solved_case
module: general
intent: troubleshooting
source_type: solved_case
confidence: medium
status: review_required
visibility: internal
product_versions: []
related_terms: []
related_repos: []
last_verified_at: 2026-06-13
owner: knowledge-admin
---

# 示例已解决 Case

## 用户原始问题

## 归一化问题

## 使用过的证据

## 根因

## 解决方案

## 用户最终确认
`,
  'tickets/unresolved-cases/README.md': `---
id: kb_case_unresolved_general_example
title: 示例未解决 Case
type: unresolved_case
module: general
intent: troubleshooting
source_type: unresolved_case
confidence: low
status: review_required
visibility: internal
product_versions: []
related_terms: []
related_repos: []
last_verified_at: 2026-06-13
owner: knowledge-admin
---

# 示例未解决 Case

## 已知事实

## 未知项

## 阻塞原因
`,
  'modules/README.md': `---
id: kb_module_general_overview
title: 示例模块说明
type: module_overview
module: general
intent: module_explanation
source_type: module_doc
confidence: medium
status: draft
visibility: internal
product_versions: []
related_terms: []
related_repos: []
last_verified_at: 2026-06-13
owner: knowledge-admin
---

# 示例模块说明

## 模块职责

## 不负责什么

## 相关仓库
`,
  'glossary/terms/README.md': `---
id: kb_glossary_general_example
title: 示例术语
type: glossary_term
module: general
intent: term_explanation
source_type: glossary
confidence: medium
status: draft
visibility: internal
product_versions: []
related_terms: []
related_repos: []
last_verified_at: 2026-06-13
owner: knowledge-admin
aliases: []
---

# 示例术语

## 定义

## 常见别名
`,
};
