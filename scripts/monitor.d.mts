export type ProbeResult = { path: string; status: number; ok: boolean };
export const appOrigin: string;
export function probe(
  fetcher?: typeof fetch,
  oidc?: string,
): Promise<ProbeResult[]>;
export function reconcileIssue(
  api: (method: string, path: string, body?: unknown) => Promise<unknown>,
  results: ProbeResult[],
  runUrl: string,
): Promise<void>;
