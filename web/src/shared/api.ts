export type Fetcher = typeof fetch;

export async function apiJson<T>(fetcher: Fetcher, input: string, init?: RequestInit): Promise<T> {
  const response = await fetcher(input, init);
  const body = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) {
    throw new Error(body.error || `请求失败 (${response.status})`);
  }
  return body;
}

export function jsonRequest(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}
