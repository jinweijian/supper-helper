import type { KnowledgeQualityReport } from '../types.js';

export type KnowledgeQualityGate = 'warn' | 'strict' | 'off';

export function evaluateQualityGate(report: KnowledgeQualityReport, gate: KnowledgeQualityGate): {
  passed: boolean;
  exitCode: number;
  reason?: string;
} {
  if (gate === 'off') return { passed: true, exitCode: 0, reason: 'quality gate disabled' };
  if (gate === 'warn') {
    return report.severityCounts.error > 0
      ? { passed: true, exitCode: 0, reason: `${report.severityCounts.error} error issues visible` }
      : { passed: true, exitCode: 0 };
  }
  if (report.severityCounts.error > 0) {
    return {
      passed: false,
      exitCode: 2,
      reason: `Strict gate failed: ${report.severityCounts.error} error issues must be fixed before publishing.`,
    };
  }
  return { passed: true, exitCode: 0 };
}
