export function formatPreflightQuestion(question: string, missingInfo: string[]): string {
  return `我现在还不能判断原因，缺少关键信息：${missingInfo.join('、')}。\n\n${question}`;
}
