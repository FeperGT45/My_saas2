// Independent availability check. No bot/Supabase keys and no customer data enter CI.
import { pathToFileURL } from 'node:url';
export const appOrigin = 'https://voklumi.voklumi67.workers.dev';
const repository = 'FeperGT45/My_saas2';
const marker = '<!-- voklumi-availability-monitor:v1 -->';
const title = '[Voklumi] Проверка доступности не проходит';
export async function probe(fetcher = fetch, oidc = '') {
  const results = [];
  for (const [path, expected, method] of [
    ['/api/health', 200, 'GET'],
    ['/api/ops/check', 200, 'POST'],
  ]) {
    try {
      const r = await fetcher(appOrigin + path, {
        method,
        headers:
          path === '/api/ops/check' ? { Authorization: `Bearer ${oidc}` } : {},
        signal: AbortSignal.timeout(path === '/api/ops/check' ? 25000 : 8000),
        redirect: 'error',
      });
      let valid = r.status === expected;
      if (valid) {
        const data = await r.json();
        valid = data.status === 'ok';
      } else await r.body?.cancel();
      results.push({ path, status: r.status, ok: valid });
    } catch {
      results.push({ path, status: 0, ok: false });
    }
  }
  return results;
}
export async function reconcileIssue(api, results, runUrl) {
  const issues = await api(
    'GET',
    `/repos/${repository}/issues?state=all&creator=github-actions%5Bbot%5D&per_page=100`,
  );
  // The bot marker is not sufficient: do not edit a user-authored issue.
  const existing = issues.find(
    (i) =>
      !i.pull_request &&
      i.user?.login === 'github-actions[bot]' &&
      i.body?.includes(marker),
  );
  const ok = results.every((r) => r.ok);
  if (ok) {
    if (existing?.state === 'open')
      await api('PATCH', `/repos/${repository}/issues/${existing.number}`, {
        state: 'closed',
        state_reason: 'completed',
      });
    return;
  }
  const body = `${marker}\nАвтоматическая проверка Voklumi не прошла.\n\n${results.map((r) => `- ${r.path}: HTTP ${r.status || 'недоступен'}, ${r.ok ? 'OK' : 'ошибка'}`).join('\n')}\n\nПроверка: ${runUrl}\n\nЭто технический статус без данных пользователей и платёжных квитанций. Проверить Cloudflare Deployments/Observability, Supabase и доставку webhook.\n\n@FeperGT45`;
  if (!existing)
    await api('POST', `/repos/${repository}/issues`, { title, body });
  else if (existing.state !== 'open')
    await api('PATCH', `/repos/${repository}/issues/${existing.number}`, {
      state: 'open',
      body,
    });
  // Do not send a notification on every scheduled failure while an incident stays open.
}
async function main() {
  if (
    process.env.GITHUB_REPOSITORY !== repository ||
    process.env.GITHUB_REF !== 'refs/heads/main'
  )
    throw Error();
  const token = process.env.GITHUB_TOKEN,
    requestToken = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN,
    requestUrl = process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
  if (!token || !requestToken || !requestUrl) throw Error();
  async function oidc() {
    const url = new URL(requestUrl);
    if (
      url.protocol !== 'https:' ||
      !url.hostname.endsWith('.actions.githubusercontent.com')
    )
      throw Error();
    url.searchParams.set('audience', appOrigin + '/api/ops/check');
    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${requestToken}` },
      signal: AbortSignal.timeout(15000),
      redirect: 'error',
    });
    if (!r.ok) throw Error();
    const data = await r.json();
    if (typeof data.value !== 'string') throw Error();
    return data.value;
  }
  async function api(method, path, body) {
    const r = await fetch('https://api.github.com' + path, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(15000),
      redirect: 'error',
    });
    if (!r.ok) throw Error();
    return r.status === 204 ? null : r.json();
  }
  let results = [];
  const attempts = process.env.GITHUB_EVENT_NAME === 'push' ? 8 : 3;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      results = await probe(fetch, await oidc());
    } catch {
      results = [{ path: '/api/ops/check', status: 0, ok: false }];
    }
    console.log(JSON.stringify({ attempt: attempt + 1, results }));
    if (results.every((r) => r.ok)) break;
    if (attempt + 1 < attempts)
      await new Promise((resolve) => setTimeout(resolve, 20000));
  }
  await reconcileIssue(
    api,
    results,
    `https://github.com/${repository}/actions/runs/${process.env.GITHUB_RUN_ID}`,
  );
  if (results.some((r) => !r.ok)) process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch(() => {
    console.error(
      'Voklumi monitor failed. Credentials and upstream details redacted. Check workflow permissions and incident issue.',
    );
    process.exitCode = 1;
  });
