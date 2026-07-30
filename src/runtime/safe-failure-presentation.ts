export type SafeWorkerFailureCategory =
  | 'worker_interrupted'
  | 'worker_timeout'
  | 'worker_execution_failed';

export function formatSafeWorkerFailure(input: {
  category: SafeWorkerFailureCategory;
  status: 'need_input' | 'partial' | 'concluded';
  nextAction: 'ask_user' | 'continue_diagnosis' | 'escalate_to_human' | 'final_answer';
}): string {
  const nextAction = input.nextAction === 'ask_user'
    ? '请补充缺失信息后重试。'
    : '请稍后重试；若持续失败，请让技术支持查看诊断日志。';
  return [
    `诊断未完成（${input.category}）。`,
    `当前状态：${input.status === 'need_input' ? '等待补充信息' : '未形成可验证结论'}。`,
    `下一步：${nextAction}`,
  ].filter(Boolean).join('\n\n');
}
