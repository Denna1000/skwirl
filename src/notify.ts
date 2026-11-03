// Meldingen voor wie de lijst deelt: wat de één toevoegt of afstreept, ziet de ander als melding.
// Zonder eigen server: de app zet de melding klaar in melding.json en een workflow in de gegevens-repository
// verstuurt hem met Web Push (skwirl-data/scripts/stuur-melding.mjs).
import type { PushFile } from './types.js';

const OUTBOX_KEY = 'skwirl-outbox';
const DEVICE_KEY = 'skwirl-device';
/** Eerst even wachten, zodat een rondje boodschappen één melding wordt in plaats van twintig */
const WAIT_MS = 60_000;

export interface Outbox { added: string[]; removed: string[] }
let timer: number | undefined;
let send: ((o: Outbox) => Promise<void>) | null = null;

function read(): Outbox {
  try { const o = JSON.parse(localStorage.getItem(OUTBOX_KEY) ?? '') as Outbox; return { added: o.added ?? [], removed: o.removed ?? [] }; }
  catch { return { added: [], removed: [] }; }
}
function write(o: Outbox): void {
  try { localStorage.setItem(OUTBOX_KEY, JSON.stringify(o)); } catch { /* zonder opslag geen meldingen */ }
}

export function setSender(fn: (o: Outbox) => Promise<void>): void { send = fn; }

/** Onthoud een wijziging aan de lijst. Toevoegen en daarna weer afstrepen (of andersom) heft elkaar op. */
export function note(kind: 'add' | 'off', label: string): void {
  const o = read();
  const [mine, other] = kind === 'add' ? [o.added, o.removed] : [o.removed, o.added];
  const i = other.indexOf(label);
  if (i >= 0) other.splice(i, 1); else if (!mine.includes(label)) mine.push(label);
  write(o);
  clearTimeout(timer);
  timer = window.setTimeout(() => void flushOutbox(), WAIT_MS);
}

/** Verstuurt wat klaarstaat (na een minuut stilte, of als de app naar de achtergrond gaat) */
export async function flushOutbox(): Promise<void> {
  clearTimeout(timer);
  const o = read();
  if (!send || (!o.added.length && !o.removed.length)) return;
  write({ added: [], removed: [] });
  try { await send(o); } catch {
    const now = read(); // terugzetten voor een volgende keer
    write({ added: [...o.added, ...now.added], removed: [...o.removed, ...now.removed] });
  }
}

/* ---------- Web Push op deze telefoon ---------- */

export function pushSupported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

/** Vaste id voor dit apparaat, zodat aan- en uitzetten de goede telefoon raakt */
export function deviceId(): string {
  let id = '';
  try { id = localStorage.getItem(DEVICE_KEY) ?? ''; } catch { /* negeren */ }
  if (!id) { id = crypto.randomUUID(); try { localStorage.setItem(DEVICE_KEY, id); } catch { /* negeren */ } }
  return id;
}

const b64u = (b: Uint8Array): string => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64u = (s: string): Uint8Array<ArrayBuffer> => {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return new Uint8Array([...bin].map((c) => c.charCodeAt(0)));
};

/** Nieuwe sleutel om meldingen mee te ondertekenen (VAPID). Eén per huishouden, bewaard in de privé-repository. */
export async function newVapid(contact: string): Promise<NonNullable<PushFile['vapid']>> {
  const k = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', k.publicKey));
  return { publicKey: b64u(raw), privateJwk: await crypto.subtle.exportKey('jwk', k.privateKey), contact };
}

/** Meldingen aanzetten op deze telefoon; geeft het adres en de sleutels terug waar de workflow naartoe stuurt */
export async function subscribe(publicKey: string): Promise<{ endpoint: string; keys: { p256dh: string; auth: string } }> {
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  const key = sub?.options.applicationServerKey;
  if (sub && (!key || b64u(new Uint8Array(key)) !== publicKey)) { await sub.unsubscribe(); sub = null; } // andere sleutel
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: fromB64u(publicKey) });
  const j = sub.toJSON();
  if (!j.endpoint || !j.keys?.p256dh || !j.keys.auth) throw new Error('Deze telefoon gaf geen adres voor meldingen');
  return { endpoint: j.endpoint, keys: { p256dh: j.keys.p256dh, auth: j.keys.auth } };
}

export async function unsubscribe(): Promise<void> {
  const reg = await navigator.serviceWorker.getRegistration();
  await (await reg?.pushManager.getSubscription())?.unsubscribe();
}
