import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JsonFile, GitHubError, type Connection } from '../src/github.ts';

// Nep-GitHub in het geheugen: één bestand met sha-controle zoals de echte Contents API
function fakeGitHub(initial: unknown) {
  let content = JSON.stringify(initial); let sha = 's0'; let n = 0; let offline = false;
  const fetchFn = async (_url: string, init: RequestInit = {}) => {
    if (offline) throw new TypeError('Failed to fetch');
    if (!init.method || init.method === 'GET') return new Response(JSON.stringify({ sha, content: Buffer.from(content).toString('base64') }), { status: 200 });
    const body = JSON.parse(String(init.body));
    if (body.sha !== sha) return new Response('{}', { status: 409 });
    content = Buffer.from(body.content, 'base64').toString('utf8'); sha = 's' + ++n;
    return new Response(JSON.stringify({ content: { sha } }), { status: 200 });
  };
  return {
    fetchFn,
    get data() { return JSON.parse(content); },
    otherDevice(fn: (d: { items: string[] }) => void) { const d = JSON.parse(content); fn(d); content = JSON.stringify(d); sha = 's' + ++n; },
    setOffline(v: boolean) { offline = v; },
  };
}
const conn: Connection = { owner: 'o', repo: 'r', token: 't', branch: 'main' };

test('wijziging van een ander apparaat gaat niet verloren', async () => {
  const gh = fakeGitHub({ items: ['melk'] });
  globalThis.fetch = gh.fetchFn as typeof fetch;
  const f = new JsonFile<{ items: string[] }>(conn, 'list.json', () => ({ items: [] }));
  await f.pull();
  gh.otherDevice((d) => d.items.push('brood')); // vriendin voegt brood toe
  await f.mutate((d) => { if (!d.items.includes('kaas')) d.items.push('kaas'); }, '+ kaas');
  assert.deepEqual(gh.data.items.sort(), ['brood', 'kaas', 'melk']);
});

test('zonder netwerk blijft de wijziging bewaard tot er weer verbinding is', async () => {
  const gh = fakeGitHub({ items: [] });
  globalThis.fetch = gh.fetchFn as typeof fetch;
  const errors: unknown[] = [];
  const f = new JsonFile<{ items: string[] }>(conn, 'list.json', () => ({ items: [] }));
  f.onError = (e) => errors.push(e);
  await f.pull();
  gh.setOffline(true);
  await f.mutate((d) => { if (!d.items.includes('eieren')) d.items.push('eieren'); }, '+ eieren');
  assert.equal(f.hasPending, true);
  assert.ok(errors[0] instanceof GitHubError);
  gh.setOffline(false);
  await f.pull();
  assert.equal(f.hasPending, false);
  assert.deepEqual(gh.data.items, ['eieren']);
});
