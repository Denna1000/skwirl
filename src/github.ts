// Opslag in een privé GitHub-repository via de Contents API.
// Elk bestand is één JSON-document. Schrijven gebeurt met de sha van de laatst gelezen versie;
// wijzigt iemand anders het bestand tussendoor (409/422), dan lezen we opnieuw en passen we
// dezelfde wijziging nog eens toe. Lezen gebruikt ETags, zodat een ongewijzigd bestand (304)
// niet meetelt voor de rate limit.

export interface Connection { owner: string; repo: string; token: string; branch: string; /** alleen voor lokaal testen */ api?: string }

export class GitHubError extends Error {
  readonly status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}

const API = 'https://api.github.com';

function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
function fromBase64(b64: string): string {
  const bin = atob(b64.replace(/\s/g, ''));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

async function call(conn: Connection, path: string, init: RequestInit & { etag?: string } = {}): Promise<Response> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${conn.token}`,
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (init.etag) headers['If-None-Match'] = init.etag;
  if (init.body) headers['Content-Type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(`${conn.api ?? API}/repos/${encodeURIComponent(conn.owner)}/${encodeURIComponent(conn.repo)}${path}`, { ...init, headers, cache: 'no-store' });
  } catch {
    throw new GitHubError('Geen verbinding met GitHub', 0);
  }
  if (res.status === 401) throw new GitHubError('De sleutel klopt niet of is verlopen', 401);
  if (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0') throw new GitHubError('Even te veel verzoeken aan GitHub, probeer het zo opnieuw', 403);
  if (res.status === 403) throw new GitHubError('De sleutel mag deze repository niet lezen of schrijven', 403);
  return res;
}

/** Controleert of de verbinding werkt. Geeft een Nederlandse foutmelding terug, of null. */
export async function checkConnection(conn: Connection): Promise<string | null> {
  try {
    const res = await call(conn, '');
    if (res.status === 404) return 'Repository niet gevonden. Klopt de naam, en mag de sleutel erbij?';
    if (!res.ok) return `GitHub gaf fout ${res.status}`;
    const info = await res.json() as { private?: boolean; permissions?: { push?: boolean } };
    if (info.private === false) return 'Deze repository is openbaar. Gebruik een privé-repository voor je gegevens.';
    if (info.permissions && info.permissions.push === false) return 'De sleutel mag alleen lezen. Geef hem ook schrijfrechten (Contents: read and write).';
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

export class JsonFile<T> {
  data: T;
  private sha: string | null = null;
  private etag: string | undefined;
  /** Wijzigingen die nog niet op GitHub staan. Elke fn moet idempotent zijn (werk met ids). */
  private pending: { fn: (data: T) => void; message: string }[] = [];
  private flushing: Promise<void> | null = null;
  onChange: (() => void) | null = null;
  onError: ((e: unknown) => void) | null = null;

  private conn: Connection;
  readonly path: string;
  private fallback: () => T;

  constructor(conn: Connection, path: string, fallback: () => T, cached?: { data: T; sha: string | null }) {
    this.conn = conn; this.path = path; this.fallback = fallback;
    this.data = cached ? cached.data : fallback();
    if (cached) this.sha = cached.sha;
  }

  get hasPending(): boolean { return this.pending.length > 0; }

  /** Voor de lokale cache, zodat de app direct iets laat zien bij openen of zonder netwerk */
  snapshot(): { data: T; sha: string | null } { return { data: this.data, sha: this.sha }; }

  /** Haalt de nieuwste versie op. Staan er nog eigen wijzigingen klaar, dan eerst die versturen. */
  async pull(): Promise<void> {
    if (this.pending.length) return this.flush();
    await this.fetch(true);
  }

  private async fetch(useEtag: boolean): Promise<void> {
    const res = await call(this.conn, `/contents/${this.path}?ref=${encodeURIComponent(this.conn.branch)}`, { etag: useEtag ? this.etag : undefined });
    if (res.status === 304) return;
    if (res.status === 404) { // bestaat nog niet: begin leeg, wordt aangemaakt bij de eerste wijziging
      if (this.sha !== null) { this.sha = null; this.data = this.fallback(); this.onChange?.(); }
      this.etag = undefined;
      return;
    }
    if (!res.ok) throw new GitHubError(`Lezen van ${this.path} mislukt (${res.status})`, res.status);
    const body = await res.json() as { sha: string; content: string };
    this.etag = res.headers.get('etag') ?? undefined;
    if (body.sha === this.sha) return;
    try { this.data = JSON.parse(fromBase64(body.content)) as T; } catch { throw new GitHubError(`${this.path} is geen geldige JSON`, 0); }
    this.sha = body.sha;
    this.onChange?.();
  }

  /** Past een wijziging direct lokaal toe en zet hem daarna op GitHub. */
  mutate(fn: (data: T) => void, message: string): Promise<void> {
    fn(this.data);
    this.onChange?.();
    this.pending.push({ fn, message });
    return this.flush();
  }

  /** Verstuurt wat nog klaarstaat. Zonder netwerk blijft het staan voor een volgende poging. */
  flush(): Promise<void> {
    if (!this.flushing) this.flushing = this.doFlush().finally(() => { this.flushing = null; });
    return this.flushing;
  }

  private async doFlush(): Promise<void> {
    while (this.pending.length) {
      const n = this.pending.length;
      const message = this.pending.length === 1 ? this.pending[0].message : `${this.pending[0].message} (+${n - 1})`;
      try {
        await this.write(message);
        this.pending.splice(0, n); // de geschreven versie bevatte al deze wijzigingen
      } catch (e) {
        this.onError?.(e);
        if (!(e instanceof GitHubError && e.status === 0)) this.pending.splice(0, n); // alleen bij geen netwerk bewaren
        return;
      }
    }
  }

  private async write(message: string): Promise<void> {
    for (let attempt = 0; attempt < 4; attempt++) {
      const body: Record<string, string> = { message, content: toBase64(JSON.stringify(this.data, null, 2) + '\n'), branch: this.conn.branch };
      if (this.sha) body.sha = this.sha;
      const res = await call(this.conn, `/contents/${this.path}`, { method: 'PUT', body: JSON.stringify(body) });
      if (res.ok) {
        const out = await res.json() as { content: { sha: string } };
        this.sha = out.content.sha; this.etag = undefined;
        return;
      }
      if (res.status === 409 || res.status === 422) { // iemand anders was ons voor: nieuwste ophalen en eigen wijzigingen opnieuw toepassen
        await this.fetch(false);
        for (const op of this.pending) op.fn(this.data);
        this.onChange?.();
        continue;
      }
      throw new GitHubError(`Opslaan van ${this.path} mislukt (${res.status})`, res.status);
    }
    throw new GitHubError('Opslaan lukt niet: het bestand verandert steeds tegelijk', 409);
  }
}
