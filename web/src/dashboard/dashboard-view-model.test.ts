import { describe, expect, it } from 'vitest';
import { safeRunView } from './dashboard-view-model';

describe('Dashboard 安全展示模型', () => {
  it('只投影已审核结果，不暴露请求和 WorkerTrace', () => {
    const session = {
      id: 'case_1', title: 'Case', status: 'partial', messages: [],
      runs: [{
        status: 'partial',
        request: { answerGoal: { diagnosticObjective: '内部调查目标' } },
        workerTrace: { command: 'claude secret', cwd: '/private/project', stdout: 'raw output' },
        result: {
          claims: [{ id: 'claim_1', type: 'fact', role: 'primary_answer', text: '已审核判断', evidenceIds: ['ev_1'] }],
          evidence: [{ id: 'ev_1', summary: '已审核证据', source: 'faq.md', confidence: 'high' }],
          missingInfo: ['仍需版本号'],
        },
      }],
    };

    const view = safeRunView(session);
    const serialized = JSON.stringify(view);
    expect(view.evidence).toEqual([{ id: 'ev_1', summary: '已审核证据', source: 'faq.md', confidence: 'high' }]);
    expect(view.claims[0]?.text).toBe('已审核判断');
    expect(serialized).not.toContain('workerTrace');
    expect(serialized).not.toContain('diagnosticObjective');
    expect(serialized).not.toContain('/private/project');
  });
});
