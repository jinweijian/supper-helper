import type { AgentModelClient } from '../providers/model/adapter.js';
import { parseAgentModelJson } from './agent-model-review.js';
import type { SafePromptSegment, VisiblePromptReview } from './safe-answer-projection.js';

export class VisiblePromptSafetyService {
  constructor(
    private readonly model: AgentModelClient,
    private readonly agentSpec: string,
  ) {}

  async review(candidates: SafePromptSegment[]): Promise<VisiblePromptReview> {
    if (candidates.length === 0) return { status: 'accepted', acceptedIds: [] };
    const bounded = candidates.slice(0, 10);
    try {
      const response = await this.model.complete([
        {
          role: 'system',
          content: `${this.agentSpec}

Return JSON only: {"status":"accepted","acceptedIds":["missing:1"]}.
Accept an ID only when the prompt asks for information without asserting a new fact.
Do not rewrite text and do not return user-visible prose.`,
        },
        {
          role: 'user',
          content: JSON.stringify({
            candidates: bounded.map((item) => ({ id: item.id, text: item.text, source: item.source })),
          }),
        },
      ], { json: true });
      const parsed = parseAgentModelJson<{ status?: unknown; acceptedIds?: unknown }>(response);
      if (
        parsed.status !== 'accepted' ||
        !Array.isArray(parsed.acceptedIds) ||
        !parsed.acceptedIds.every((id): id is string => typeof id === 'string')
      ) {
        return { status: 'unknown', acceptedIds: [] };
      }
      const validIds = new Set(bounded.map((item) => item.id));
      if (parsed.acceptedIds.some((id) => !validIds.has(id))) {
        return { status: 'unknown', acceptedIds: [] };
      }
      return {
        status: 'accepted',
        acceptedIds: Array.from(new Set(parsed.acceptedIds)),
      };
    } catch {
      return { status: 'unknown', acceptedIds: [] };
    }
  }
}
