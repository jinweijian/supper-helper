import type {
  ResolvedTurnContext,
  ResolvedTurnStatement,
  CaseSession,
} from '../domain.js';
import { turnUserMessages, turnRuns } from '../sessions/turn-context-snapshot.js';

const UNKNOWN_PATTERN = /^(不清楚|不知道|没有|暂时不清楚|unknown|not sure)$/i;
const HYPOTHESIS_PATTERN = /是不是|是否可能|会不会|我猜|可能是|怀疑|难道|会否/;
const QUESTION_PATTERN = /[?？]$|为什么|怎么|如何|哪里|什么|是否|能否|可不可以/;
const OBSERVABLE_PATTERN = /返回\s*[45]\d\d|看到|显示|提示|报错|异常|失败|无法|打不开|没有出现|变成|出现|超时|卡住/;
const REFERENTIAL_PATTERN = /^(刚刚|上一轮|上次|之前|这个|那个|它|这里|还是|另外)/;

export function buildResolvedTurnContext(input: {
  caseSession: CaseSession;
  latestUserMessage: string;
}): ResolvedTurnContext {
  const userMessages = turnUserMessages(input.caseSession).slice(-12);
  const latest = [...userMessages].reverse().find((message) => message.body === input.latestUserMessage) ?? userMessages.at(-1);
  const previous = [...userMessages]
    .reverse()
    .find((message) => message.id !== latest?.id && !UNKNOWN_PATTERN.test(message.body.trim()));
  const latestText = input.latestUserMessage.trim();
  const isUnknown = UNKNOWN_PATTERN.test(latestText);
  const isFollowUp = userMessages.length > 1 || turnRuns(input.caseSession).length > 0;
  const allMessages = input.caseSession.messages;
  const latestMessageIndex = latest
    ? allMessages.findIndex((message) => message.id === latest.id)
    : -1;
  const precedingMessage = latestMessageIndex > 0
    ? allMessages[latestMessageIndex - 1]
    : undefined;
  const answersClarification = Boolean(
    previous &&
    precedingMessage?.role === 'helper' &&
    precedingMessage.replyToMessageId === previous.id &&
    /缺少|请补充|不能判断|还需要|未知/.test(precedingMessage.body),
  );
  const resolvedQuery = isUnknown
    ? previous?.body.trim() || latestText
    : isFollowUp && previous && (REFERENTIAL_PATTERN.test(latestText) || answersClarification)
      ? `${previous.body.trim()}\n补充：${latestText}`
      : latestText;

  const confirmedFacts: ResolvedTurnStatement[] = [];
  const userClaims: ResolvedTurnStatement[] = [];
  const hypotheses: ResolvedTurnStatement[] = [];
  const unknowns: ResolvedTurnStatement[] = [];
  for (const message of userMessages) {
    const statement = { text: bound(message.body), sourceMessageId: message.id };
    const text = message.body.trim();
    if (!text) continue;
    if (UNKNOWN_PATTERN.test(text)) {
      unknowns.push(statement);
    } else if (HYPOTHESIS_PATTERN.test(text)) {
      hypotheses.push(statement);
    } else if (OBSERVABLE_PATTERN.test(text) && !QUESTION_PATTERN.test(text)) {
      confirmedFacts.push(statement);
    } else {
      userClaims.push(statement);
    }
  }

  return {
    resolvedQuery: bound(resolvedQuery, 2000),
    latestUserMessage: bound(latestText, 1600),
    latestUserMessageId: latest?.id,
    confirmedFacts: confirmedFacts.slice(-8),
    userClaims: userClaims.slice(-8),
    hypotheses: hypotheses.slice(-8),
    unknowns: unknowns.slice(-8),
    isFollowUp,
    sourceMessageIds: userMessages.map((message) => message.id).slice(-12),
  };
}

export function reconcileResolvedTurnContext(input: {
  local: ResolvedTurnContext;
  model?: Partial<ResolvedTurnContext>;
}): ResolvedTurnContext {
  if (!input.model) return input.local;
  const localFacts = new Map(input.local.confirmedFacts.map((fact) => [fact.text, fact]));
  const modelFacts = Array.isArray(input.model.confirmedFacts)
    ? safeStatements(input.model.confirmedFacts).flatMap((fact) => localFacts.get(fact.text) ?? [])
    : input.local.confirmedFacts;
  const demotedFacts = input.local.confirmedFacts.filter((fact) => !modelFacts.some((item) => item.text === fact.text));
  return {
    ...input.local,
    confirmedFacts: modelFacts,
    userClaims: uniqueStatements([
      ...input.local.userClaims,
      ...demotedFacts,
      ...safeStatements(input.model.userClaims),
    ]),
    hypotheses: uniqueStatements([
      ...input.local.hypotheses,
      ...safeStatements(input.model.hypotheses),
    ]),
    unknowns: uniqueStatements([
      ...input.local.unknowns,
      ...safeStatements(input.model.unknowns),
    ]),
    resolvedQuery: input.local.resolvedQuery,
    latestUserMessage: input.local.latestUserMessage,
    latestUserMessageId: input.local.latestUserMessageId,
    sourceMessageIds: input.local.sourceMessageIds,
  };
}

function safeStatements(value: unknown): ResolvedTurnStatement[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((statement) => {
    if (!statement || typeof statement !== 'object') return [];
    const candidate = statement as Partial<ResolvedTurnStatement>;
    if (typeof candidate.text !== 'string' || typeof candidate.sourceMessageId !== 'string') return [];
    return [{ text: bound(candidate.text.trim()), sourceMessageId: candidate.sourceMessageId }];
  });
}

function uniqueStatements(statements: ResolvedTurnStatement[]): ResolvedTurnStatement[] {
  const seen = new Set<string>();
  return statements.filter((statement) => {
    const key = `${statement.sourceMessageId}:${statement.text}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(-8);
}

function bound(value: string, limit = 800): string {
  return value.length > limit ? `${value.slice(0, limit)}...` : value;
}
