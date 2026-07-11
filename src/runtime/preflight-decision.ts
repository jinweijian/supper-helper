import type { CaseSession, DiagnosticRequest, HelperAgentConfig } from '../domain.js';
import { buildDiagnosticRequestFromResolvedTurn } from './request-builder.js';
import { buildResolvedTurnContext } from './resolved-turn.js';
import { turnMessages } from '../sessions/turn-context-snapshot.js';

export interface PreflightInput {
  caseSession: CaseSession;
  userMessage: string;
  agentConfig: HelperAgentConfig;
  allowedMcpToolIds?: string[];
}

export type PreflightDecision =
  | {
      action: 'ask_user';
      question: string;
      missingInfo: string[];
    }
  | {
      action: 'dispatch';
      request: DiagnosticRequest;
    };

const REQUIRED_SIGNALS = [
  {
    key: 'problem',
    label: '具体问题现象',
    test: (text: string) => text.trim().length >= 8,
  },
  {
    key: 'workspace',
    label: '目标 workspace',
    test: (_text: string, input: PreflightInput) => Boolean(input.caseSession.workspaceId),
  },
  {
    key: 'diagnostic_signal',
    label: '具体报错、受影响功能、复现步骤、项目文件或关键对象',
    test: (text: string) => hasActionableSignal(text),
  },
];

function hasActionableSignal(text: string): boolean {
  const normalized = text.toLowerCase();
  const patterns = [
    /\b(4\d\d|5\d\d)\b/,
    /error|exception|traceid|stack|timeout|failed|failure/,
    /package\.json|tsconfig|readme|agent\.md|claude\.md|路由|route|router|controller|service|component|组件|配置|文件|目录|函数|类|代码|项目|workspace/,
    /哪里|在哪|如何|怎么|什么|解释|说明|查找|定位|找一下|看一下/,
    /有哪些|有什么功能|什么功能|哪些功能|功能有哪些|功能清单|功能列表|有哪些能力|有什么能力|支持哪些|能做什么|主要功能|能力/,
    /报错|失败|异常|无法|打不开|保存|接口|日志|复现|截图|页面|服务器|数据库|慢|卡|崩/,
    /id\s*[:：=]?\s*\d+/i,
    /\/[a-z0-9_\-/?=&]+/i,
  ];

  return patterns.some((pattern) => pattern.test(normalized));
}

export function preflight(input: PreflightInput): PreflightDecision {
  const cutoffMessages = turnMessages(input.caseSession);
  const contextText = cutoffMessages
    .filter((message) => message.role === 'user')
    .map((message) => message.body)
    .join('\n');
  const isUnknownAnswer = /^(不清楚|不知道|没有|暂时不清楚|unknown|not sure)$/i.test(input.userMessage.trim());
  const hasPendingHelperQuestion = cutoffMessages.some(
    (message) => message.role === 'helper' && /缺少|请补充|不能判断/.test(message.body),
  );
  const textForSignals = isUnknownAnswer ? contextText : `${contextText}\n${input.userMessage}`;
  if (requiresPermissionEscalation(textForSignals)) {
    return {
      action: 'ask_user',
      missingInfo: ['只读权限边界'],
      question: '当前只允许只读诊断，不能直接执行写入、删除、部署或生产变更。请改为让我先只读分析影响和操作方案，或转交有权限的人工处理。',
    };
  }
  const missingInfo = REQUIRED_SIGNALS
    .filter((signal) => !signal.test(textForSignals, input))
    .map((signal) => signal.label);

  const shouldContinueWithUnknown =
    input.agentConfig.rules.allowUnknownAnswer &&
    isUnknownAnswer &&
    hasPendingHelperQuestion &&
    contextText.trim().length > 0;

  if (input.agentConfig.rules.askWhenMissingRequiredInfo && missingInfo.length > 0 && !shouldContinueWithUnknown) {
    return {
      action: 'ask_user',
      missingInfo,
      question: `为了避免无证据猜测，请先补充：${missingInfo.join('、')}。如果不清楚，可以直接回答“不清楚”。`,
    };
  }

  const resolvedTurn = buildResolvedTurnContext({
    caseSession: input.caseSession,
    latestUserMessage: input.userMessage,
  });
  const unknowns = Array.from(new Set([
    ...(shouldContinueWithUnknown ? missingInfo : []),
    ...resolvedTurn.unknowns.map((unknown) => unknown.text),
  ]));

  return {
    action: 'dispatch',
    request: buildDiagnosticRequestFromResolvedTurn({
      caseSession: input.caseSession,
      rawUserQuestion: input.userMessage,
      resolvedTurn,
      unknowns,
      allowedMcpToolIds: input.allowedMcpToolIds ?? [],
    }),
  };
}

export function isSafetyPermissionDecision(decision: PreflightDecision): boolean {
  return decision.action === 'ask_user' && decision.missingInfo.includes('只读权限边界');
}

function requiresPermissionEscalation(text: string): boolean {
  if (/如何|怎么|怎样|分析|排查|解释|说明|查找|定位|方案|步骤/.test(text)) return false;
  const writeAction = /删除|清空|修改|写入|执行|运行脚本|发布|部署|回滚|重启|停机|退款|修复数据|更新数据库|改配置|重置|封禁|禁用|启用/;
  return new RegExp(`(?:请|帮我|直接|立即|马上|替我|给我).{0,16}(?:${writeAction.source})`).test(text)
    || new RegExp(`^(?:${writeAction.source})`).test(text.trim());
}
