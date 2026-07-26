import type { SessionDto } from '../shared/contracts';

export interface ChatProgressState {
  state: 'idle' | 'running' | 'completed' | 'interrupted' | 'reconnecting';
  startedAt?: number;
  lastActivityAt?: number;
  session?: Pick<SessionDto, 'status' | 'agentActivity'>;
  error?: string;
}

const steps = ['理解问题', '知识路由', '检索证据', '证据判断', '生成答复'];

export function progressView(state: ChatProgressState, now = Date.now()) {
  const phase = state.session?.agentActivity?.[0]?.phase ?? '';
  let index = 0;
  let title = '正在理解你的问题';
  if (/knowledge_router/.test(phase)) { index = 1; title = '正在识别知识路径'; }
  if (/knowledge_search|retrieval/.test(phase)) { index = 2; title = '正在检索相关证据'; }
  if (/judge|review|diagnostic|code_escalation/.test(phase) || (!phase && state.session?.status === 'diagnosing')) { index = 3; title = '正在判断证据并排查'; }
  if (/presentation|user_reply/.test(phase)) { index = 4; title = '正在整理回答'; }
  const interrupted = state.state === 'interrupted';
  const elapsed = Math.max(0, now - (state.startedAt ?? now));
  const heartbeat = Math.max(0, now - (state.lastActivityAt ?? state.startedAt ?? now));
  return {
    title: interrupted ? '回答已中断' : title,
    summary: interrupted ? (state.error || '诊断没有返回回答，请重试或查看日志。') : (state.session?.agentActivity?.[0]?.summary || '正在处理，本页面会持续更新真实进展。'),
    percent: interrupted ? Math.min(92, 18 + index * 18) : Math.min(92, 18 + index * 18),
    steps, activeIndex: index,
    elapsedLabel: `已耗时 ${formatDuration(elapsed)}`,
    heartbeatLabel: `${Math.floor(heartbeat / 1000)} 秒前有活动`,
    estimateLabel: index >= 3 ? '估计还需 1–3 分钟（非精确时间）' : '估计还需 2–5 分钟（非精确时间）',
    animated: state.state === 'running',
    stale: heartbeat > 30_000,
  };
}

function formatDuration(milliseconds: number): string {
  const seconds = Math.floor(milliseconds / 1000);
  return seconds >= 60 ? `${Math.floor(seconds / 60)} 分钟` : `${seconds} 秒`;
}
