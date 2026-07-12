import { describe, expect, it } from 'vitest';
import { progressView } from './chat-progress';

describe('问答进度模型', () => {
  it('映射阶段、耗时、心跳和估计范围', () => {
    const view = progressView({ state: 'running', startedAt: 1_000, lastActivityAt: 55_000, session: { status: 'diagnosing', agentActivity: [{ phase: 'knowledge_search_started', summary: '正在检索知识' }] } }, 61_000);
    expect(view.title).toContain('检索');
    expect(view.elapsedLabel).toBe('已耗时 1 分钟');
    expect(view.heartbeatLabel).toBe('6 秒前有活动');
    expect(view.estimateLabel).toContain('估计');
    expect(view.animated).toBe(true);
  });

  it('中断时停止动画并展示错误', () => {
    const view = progressView({ state: 'interrupted', startedAt: 1_000, lastActivityAt: 2_000, error: '连接已中断' }, 10_000);
    expect(view.title).toBe('回答已中断');
    expect(view.summary).toContain('连接已中断');
    expect(view.animated).toBe(false);
  });
});
