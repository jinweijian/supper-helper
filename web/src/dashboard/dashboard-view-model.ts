import type { SessionDto } from '../shared/contracts';

interface PublicClaim { id: string; type: string; text: string; evidenceIds: string[] }
interface PublicEvidence { id: string; summary: string; source: string; confidence: string }
export interface SafeRunView { status: string; claims: PublicClaim[]; evidence: PublicEvidence[]; missingInfo: string[] }

export function safeRunView(session?: SessionDto): SafeRunView {
  const run = [...(session?.runs ?? [])].reverse().find((item) => isRecord(item.result));
  const result = isRecord(run?.result) ? run.result : {};
  return {
    status: String(run?.status ?? session?.status ?? 'collecting_input'),
    claims: Array.isArray(result.claims) ? result.claims.filter(isRecord).filter((claim) => ['fact', 'inference'].includes(String(claim.type))).map((claim) => ({
      id: String(claim.id ?? ''), type: String(claim.type ?? ''), text: String(claim.text ?? ''),
      evidenceIds: Array.isArray(claim.evidenceIds) ? claim.evidenceIds.map(String) : [],
    })) : [],
    evidence: Array.isArray(result.evidence) ? result.evidence.filter(isRecord).map((item) => ({
      id: String(item.id ?? ''), summary: String(item.summary ?? ''), source: String(item.source ?? ''), confidence: String(item.confidence ?? 'unknown'),
    })) : [],
    missingInfo: Array.isArray(result.missingInfo) ? result.missingInfo.map(String) : [],
  };
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
