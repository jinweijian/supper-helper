export const KNOWLEDGE_DIRECTORIES = [
  '_sources/whitepapers',
  '_sources/redmine/issues',
  '_pipeline/extracts',
  '_pipeline/normalized',
  '_pipeline/drafts',
  '_pipeline/repair-plans',
  '_pipeline/review',
  '_pipeline/publish',
  '_taxonomy',
  'modules',
  'faq',
  'runbooks',
  'tickets/solved-cases',
  'tickets/unresolved-cases',
  'whitepapers',
  'glossary/terms',
  'indexes',
  'reports',
] as const;

export const taxonomyTemplates: Record<string, string> = {
  'modules.yaml': `# Enterprise module taxonomy.
# Keep module ids stable. Runtime search uses these ids for routing.
modules:
  - id: general
    name: 通用知识
    owner: knowledge-admin
    keywords:
      - 通用
      - 帮助
    related_repos: []
    product_versions: []
  - id: ai-companion
    name: AI 伴学助手
    owner: knowledge-admin
    keywords:
      - AI伴学助手
      - 伴学助手
      - 学习计划
      - 督学提醒
    related_repos: []
    product_versions: []
  - id: edusoho-training
    name: EduSoho 教培版
    owner: knowledge-admin
    keywords:
      - EduSoho
      - 教培版
      - 课程管理
      - 班级管理
    related_repos: []
    product_versions: []
`,
  'aliases.yaml': `# User-facing aliases mapped to canonical modules or terms.
aliases:
  - alias: 帮助中心
    module: general
  - alias: FAQ
    module: general
  - alias: AI伴学
    module: ai-companion
  - alias: 伴学助手
    module: ai-companion
  - alias: 督学提醒
    module: ai-companion
  - alias: EduSoho
    module: edusoho-training
  - alias: 教培版
    module: edusoho-training
`,
  'intents.yaml': `# Supported user intents for knowledge routing.
intents:
  - id: troubleshooting
    name: 问题排查
  - id: how_to
    name: 操作流程
  - id: product_rule
    name: 产品规则
  - id: implementation_detail
    name: 实现细节
  - id: term_explanation
    name: 术语解释
  - id: module_explanation
    name: 模块说明
  - id: feature_overview
    name: 功能概览
`,
  'source-types.yaml': `# Source types and MVP ranking weights.
source_types:
  - id: faq
    weight: 100
  - id: runbook
    weight: 95
  - id: solved_case
    weight: 90
  - id: whitepaper
    weight: 70
  - id: glossary
    weight: 50
  - id: module_doc
    weight: 45
  - id: unresolved_case
    weight: 10
`,
};
