// Skwirl: gedeeld boodschappenlijstje met vaste producten, je eigen plekken en wekelijkse aanbiedingen.
// Alle gegevens staan als JSON in een privé GitHub-repository; deze code bevat geen persoonlijke gegevens.

import { JsonFile, checkConnection, GitHubError, type Connection } from './github.js';
import type { Address, Deal, DealsFile, Household, Kind, ListFile, ListItem, Product, Store } from './types.js';
import { parseEntry } from './parse.js';
import { iconFor } from './art.js';
import { distanceKm, searchAddress, type Place } from './geo.js';
import { DAY, esc, eur, km, uid } from './util.js';

/* ---------- Instellingen en vaste waarden ---------- */

interface Config extends Connection { name: string }
interface Ui { tab: Tab; addr: string | null; listChain: string; addAny: boolean; dealsMine: boolean }
type Tab = 'vandaag' | 'lijstje' | 'deals' | 'producten' | 'plekken';

const CFG_KEY = 'skwirl-config';
const CACHE_KEY = 'skwirl-cache';
const UI_KEY = 'skwirl-ui';
const POLL_MS = 10_000;
const MAX_RECENT = 40;

const DEFAULT_CHAINS: Household['chains'] = {
  ah: { name: 'Albert Heijn', kind: 'super' }, jumbo: { name: 'Jumbo', kind: 'super' }, lidl: { name: 'Lidl', kind: 'super' },
  vomar: { name: 'Vomar', kind: 'super' }, aldi: { name: 'Aldi', kind: 'super' }, dekamarkt: { name: 'DekaMarkt', kind: 'super' },
  kruidvat: { name: 'Kruidvat', kind: 'drogist' }, etos: { name: 'Etos', kind: 'drogist' },
  gamma: { name: 'Gamma', kind: 'bouw' }, praxis: { name: 'Praxis', kind: 'bouw' }, pets: { name: 'Pets Place', kind: 'dier' },
  bol: { name: 'bol.com', kind: 'online' },
};
const KIND_ANY: Record<Kind, string> = { super: 'elke supermarkt', drogist: 'elke drogist', online: 'online', bouw: 'elke bouwmarkt', dier: 'elke dierenwinkel', slager: 'elke slager', overig: 'overal' };
const KIND_NAME: Record<Kind, string> = { super: 'Supermarkt', drogist: 'Drogist', online: 'Online', bouw: 'Bouwmarkt', dier: 'Dierenwinkel', slager: 'Slager', overig: 'Overig' };
const CATS = ['Groente & fruit', 'Zuivel & eieren', 'Brood & ontbijt', 'Voorraadkast', 'Vlees & vis', 'Dranken', 'Baby', 'Huisdieren',
  'Wasmiddel & schoonmaak', 'Persoonlijke verzorging', 'Sportvoeding', 'Contactlenzen', 'Klussen & tuin', 'Overig'];
const QUICK = ['Bananen', 'Appels', 'Melk', 'Brood', 'Eieren', 'Kaas', 'Tomaten', 'Komkommer', 'Yoghurt', 'Mandarijnen', 'Boter', 'Koffie'];
const SPEC_CHIPS = ['bio', 'groot', 'klein', 'light', 'vegan', '500 g', '1 kg', '500 ml', '1 liter'];

const emptyHousehold = (): Household => ({ version: 1, addresses: [], stores: [], chains: { ...DEFAULT_CHAINS }, products: [] });
const emptyList = (): ListFile => ({ items: [] });
const emptyDeals = (): DealsFile => ({ updatedAt: null, source: null, deals: [] });

/* ---------- Staat ---------- */

function load<T>(key: string): T | null {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) as T : null; } catch { return null; }
}
function save(key: string, value: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* zonder opslag werkt het ook, alleen zonder cache */ }
}

let cfg = load<Config>(CFG_KEY);
const ui: Ui = Object.assign({ tab: 'vandaag', addr: null, listChain: 'ah', addAny: true, dealsMine: true } as Ui, load<Partial<Ui>>(UI_KEY));
let list: JsonFile<ListFile> | null = null;
let house: JsonFile<Household> | null = null;
let deals: JsonFile<DealsFile> | null = null;
let syncState: { kind: 'ok' | 'busy' | 'offline' | 'error'; at: number | null; msg: string } = { kind: 'busy', at: null, msg: '' };
let sheet: null | { type: 'item'; id: string } | { type: 'product'; id: string | null } | { type: 'store' } | { type: 'address' } | { type: 'share' } = null;
let draft = '';
let placeResults: Place[] = [];
let pollTimer: number | undefined;

const H = (): Household => house!.data;
const L = (): ListItem[] => list!.data.items;
const D = (): Deal[] => deals!.data.deals;
const $ = <E extends HTMLElement = HTMLElement>(sel: string): E => document.querySelector(sel) as E;

/* ---------- Afgeleide gegevens ---------- */

const chainName = (c: string): string => H().chains[c]?.name ?? c;
const kindOf = (c: string): Kind => H().chains[c]?.kind ?? 'overig';
const multiChain = (k: Kind): boolean => Object.values(H().chains).filter((x) => x.kind === k).length > 1;
const anyLabel = (kinds: Kind[]): string => { const t = kinds.map((k) => KIND_ANY[k]).join(' of '); return t.charAt(0).toUpperCase() + t.slice(1); };
const onListFor = (l: ListItem, c: string): boolean => (l.kinds ? l.kinds.includes(kindOf(c)) : l.chain === c);
const currentAddr = (): Address | null => H().addresses.find((a) => a.id === ui.addr) ?? H().addresses[0] ?? null;
const currentChain = (): string => (ui.listChain in H().chains ? ui.listChain : Object.keys(H().chains)[0]);
const product = (id: string | null): Product | undefined => (id ? H().products.find((p) => p.id === id) : undefined);

function daysLeft(p: Product): number | null {
  if (!p.lastBought) return null;
  return Math.round(p.interval - (Date.now() - p.lastBought) / DAY);
}
function nearestStore(chain: string, a: Address | null): { st: Store; d: number } | null {
  const opts = H().stores.filter((s) => s.chain === chain && s.follow);
  if (!opts.length) return null;
  return opts.map((st) => ({ st, d: st.online || !a ? 0 : distanceKm(a, st) })).sort((x, y) => x.d - y.d)[0];
}
function statusOf(p: Product): { key: string; label: string } {
  const d = daysLeft(p);
  if (d === null) return { key: 'meh', label: 'Nog niet bijgehouden' };
  if (d <= 0) return { key: 'danger', label: 'Op' };
  if (d <= 5) return { key: 'danger', label: `Nog ±${d} ${d === 1 ? 'dag' : 'dagen'}` };
  if (d <= 14) return { key: 'warn', label: `Nog ±${d} dagen` };
  return { key: 'ok', label: `Nog ±${Math.round(d / 7)} weken` };
}

/* ---------- Lijst-acties (alle wijzigingen idempotent, zodat ze opnieuw toepasbaar zijn) ---------- */

function scopeFor(chain: string, p?: Product): Pick<ListItem, 'chain' | 'kinds'> {
  if (p && p.where.length) return { chain: null, kinds: p.where };
  return ui.addAny && multiChain(kindOf(chain)) ? { chain: null, kinds: [kindOf(chain)] } : { chain, kinds: null };
}
function addItem(fields: Partial<ListItem> & { name: string }, chain = currentChain()): void {
  const p = fields.productId ? product(fields.productId) : H().products.find((x) => x.name.toLowerCase() === fields.name.toLowerCase());
  // staat het al bij "Onlangs", zet dat dan terug in plaats van een dubbele tegel
  const again = L().find((l) => l.done && l.name.toLowerCase() === fields.name.toLowerCase() && onListFor(l, chain));
  if (again && !fields.dealId) {
    const patch = { done: false, doneAt: null, createdAt: Date.now(), ...(fields.spec ? { spec: fields.spec } : {}), ...(fields.qty && fields.qty > 1 ? { qty: fields.qty } : {}) };
    setItem(again.id, patch, `+ ${again.name}`);
    return;
  }
  const item: ListItem = {
    id: uid('i'), spec: null, qty: 1, ...scopeFor(chain, p), done: false, doneAt: null, createdAt: Date.now(),
    addedBy: cfg?.name ?? null, productId: p?.id ?? null, dealId: null, ...fields,
  };
  list!.mutate((d) => { if (!d.items.some((x) => x.id === item.id)) d.items.push(item); }, `+ ${item.name}`).catch(() => {});
}
function setItem(id: string, patch: Partial<ListItem>, msg: string): void {
  list!.mutate((d) => { const it = d.items.find((x) => x.id === id); if (it) Object.assign(it, patch); }, msg).catch(() => {});
}
function removeItem(id: string): void {
  const it = L().find((x) => x.id === id);
  list!.mutate((d) => { d.items = d.items.filter((x) => x.id !== id); }, `× ${it?.name ?? 'product'}`).catch(() => {});
}
function takeOff(it: ListItem): void {
  const now = Date.now();
  list!.mutate((d) => {
    const x = d.items.find((y) => y.id === it.id); if (x) { x.done = true; x.doneAt = now; }
    const old = d.items.filter((y) => y.done).sort((a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0)).slice(MAX_RECENT).map((y) => y.id);
    if (old.length) d.items = d.items.filter((y) => !old.includes(y.id));
  }, `✓ ${it.name}`).catch(() => {});
  if (it.productId && product(it.productId)) {
    house!.mutate((h) => { const p = h.products.find((x) => x.id === it.productId); if (p) p.lastBought = now; }, `Gekocht: ${it.name}`).catch(() => {});
  }
}

/* ---------- Weergave: onderdelen ---------- */

function tile(l: ListItem): string {
  const dl = l.dealId ? D().find((d) => d.id === l.dealId) : null;
  const sp = [l.spec, dl ? dl.mech : (!l.kinds && l.chain && multiChain(kindOf(l.chain)) ? 'Alleen hier' : '')].filter(Boolean).join(' · ');
  const out = l.done;
  return `<button class="tile ${out ? 'sug' : ''}" data-action="${out ? 'li-in' : 'li-out'}" data-id="${esc(l.id)}" aria-label="${esc(l.name)}${l.spec ? ', ' + esc(l.spec) : ''}${l.qty > 1 ? `, ${l.qty} stuks` : ''}: ${out ? 'op de lijst zetten' : 'van de lijst halen'}">
    ${!out && l.qty > 1 ? `<span class="q num">${l.qty}×</span>` : ''}${iconFor(l.name)}<span class="nm">${esc(l.name)}</span>${sp ? `<span class="sp">${esc(sp)}</span>` : ''}</button>`;
}

function listPanel(chain: string, compact: boolean): string {
  const items = L().filter((l) => onListFor(l, chain));
  const todo = items.filter((l) => !l.done).sort((x, y) => x.createdAt - y.createdAt);
  const recent = items.filter((l) => l.done).sort((x, y) => (y.doneAt ?? 0) - (x.doneAt ?? 0));
  const known = new Set(items.map((l) => l.name.toLowerCase()));
  const catalog = QUICK.filter((q) => !known.has(q.toLowerCase()));
  const maxTodo = compact ? 6 : 999, maxSug = compact ? 6 : 15;
  const sugTiles = recent.slice(0, maxSug).map(tile)
    .concat(catalog.slice(0, Math.max(0, maxSug - recent.length)).map((q) => `<button class="tile sug" data-action="li-quick" data-v="${esc(q)}" aria-label="${esc(q)} op de lijst zetten">${iconFor(q)}<span class="nm">${esc(q)}</span></button>`));
  const k = kindOf(chain);
  return `
    <form class="add-row" id="li-form" autocomplete="off">
      <label for="li-new" class="sr-only">Product toevoegen</label>
      <input id="li-new" placeholder="Wat is er op? Bijv. chiazaad, bio" value="${esc(draft)}" enterkeyhint="done" maxlength="80">
      <button class="btn primary" type="submit">Toevoegen</button>
    </form>
    ${multiChain(k) ? `<div class="scope" role="group" aria-label="Waar mag het vandaan komen?"><button type="button" aria-pressed="${!ui.addAny}" data-action="li-scope" data-v="0">Alleen ${esc(chainName(chain))}</button><button type="button" aria-pressed="${ui.addAny}" data-action="li-scope" data-v="1">${esc(anyLabel([k]))}</button></div>` : ''}
    ${todo.length ? `<div class="tiles">${todo.slice(0, maxTodo).map(tile).join('')}</div>${todo.length > maxTodo ? `<button class="btn small ghost" data-tab="lijstje">Nog ${todo.length - maxTodo} meer</button>` : ''}`
      : `<div class="empty" style="padding:18px 12px">Je lijstje voor ${esc(chainName(chain))} is leeg.</div>`}
    ${compact ? '' : '<p class="hint">Tik om eraf te halen. Houd ingedrukt voor eigenschap of aantal.</p>'}
    ${sugTiles.length ? `<div class="basket-head">${recent.length ? 'Onlangs' : 'Vaak nodig'}</div><div class="tiles">${sugTiles.join('')}</div>` : ''}`;
}

function syncLabel(): string {
  const t = syncState.at ? new Date(syncState.at).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' }) : '';
  const pend = (list?.hasPending || house?.hasPending) ? ' · wordt opgeslagen' : '';
  const map = { ok: [`Gedeeld · bijgewerkt ${t}${pend}`, 'live'], busy: ['Bijwerken…', ''], offline: ['Offline · wijzigingen worden later opgeslagen', 'warn'], error: [syncState.msg, 'err'] } as const;
  const [txt, cls] = map[syncState.kind];
  return `<span class="sync ${cls}">${esc(txt)}</span>`;
}

/* ---------- Weergave: pagina's ---------- */

function relevantDeals(a: Address | null): { st: Store; d: number; items: { dl: Deal; p: Product | undefined }[]; saving: number }[] {
  const mine = D().filter((dl) => { const p = product(dl.productId); if (!p) return false; const d = daysLeft(p); return d === null || d <= 14; });
  const byChain = new Map<string, Deal[]>();
  mine.forEach((dl) => byChain.set(dl.chain, (byChain.get(dl.chain) ?? []).concat(dl)));
  return [...byChain.entries()].map(([chain, dls]) => {
    const ns = nearestStore(chain, a);
    if (!ns || (!ns.st.online && a && ns.d > a.radius)) return null;
    const items = dls.map((dl) => ({ dl, p: product(dl.productId) }));
    const saving = items.reduce((t, x) => t + (x.dl.normal && x.dl.price ? x.dl.normal - x.dl.price : 0), 0);
    return { st: ns.st, d: ns.d, items, saving };
  }).filter((x): x is NonNullable<typeof x> => !!x).sort((x, y) => y.items.length - x.items.length || y.saving - x.saving);
}

function dealLine(dl: Deal): string {
  return [dl.mech, dl.price !== null ? eur(dl.price) : '', dl.until ? `t/m ${dl.until}` : ''].filter(Boolean).join(' · ');
}

function viewVandaag(): string {
  const a = currentAddr();
  const lc = currentChain();
  const dateStr = new Date().toLocaleDateString('nl-NL', { weekday: 'long', day: 'numeric', month: 'long' });
  const listCard = `<section class="card list-card"><div class="section-head" style="margin-bottom:0"><h2>Boodschappenlijstje</h2>
      <label class="mini-pick"><span class="sr-only">Winkel</span><select data-action="li-chain-sel">${Object.keys(H().chains).map((c) => `<option value="${esc(c)}" ${c === lc ? 'selected' : ''}>${esc(chainName(c))}</option>`).join('')}</select></label></div>
      ${listPanel(lc, true)}</section>`;

  const ranked = relevantDeals(a);
  const best = ranked[0];
  let hero = '';
  if (best) {
    hero = `<section class="card hero"><div class="eyebrow">Beste stop${a ? ` vanaf ${esc(a.name.toLowerCase())}` : ''}</div>
      <div class="hero-store"><h2>${esc(best.st.name)} ${esc(best.st.place)}</h2>${best.st.online ? '' : `<span class="num">${km(best.d)}</span>`}</div>
      <ul class="hero-items">${best.items.map(({ dl, p }) => `<li><div><div><strong>${esc(p?.name ?? dl.title)}</strong></div><div class="why">${esc(dealLine(dl))}</div></div>
        ${dl.normal && dl.price ? `<div class="save num">−${eur(dl.normal - dl.price)}</div>` : ''}</li>`).join('')}</ul>
      <div class="hero-foot"><div class="hero-total">${best.saving ? `Je bespaart hier<strong class="num">${eur(best.saving)}</strong>` : ''}</div>
      <button class="btn primary" data-action="deal-store" data-chain="${esc(best.st.chain)}">Op mijn lijstje</button></div></section>`;
  } else {
    const upd = deals!.data.updatedAt ? `Laatst bijgewerkt ${new Date(deals!.data.updatedAt).toLocaleDateString('nl-NL', { day: 'numeric', month: 'long' })}.` : 'De wekelijkse Claude-taak vult de aanbiedingen.';
    hero = `<section class="card"><h2>Geen acties die nu lonen</h2><p class="sub">Er zijn geen aanbiedingen voor producten die je bijna nodig hebt bij winkels in de buurt. ${esc(upd)}</p></section>`;
  }
  const others = ranked.slice(1, 4).map((r) => `<div class="card"><div class="section-head" style="margin:0"><h3>${esc(r.st.name)} ${esc(r.st.place)}</h3><span class="num" style="color:var(--muted);font-size:13px">${r.st.online ? 'online' : km(r.d)}</span></div>
      <p class="sub" style="font-size:13.5px">${r.items.map(({ dl, p }) => esc(p?.name ?? dl.title)).join(', ')}</p>
      <div class="deal-foot" style="margin-top:8px"><span class="num" style="color:var(--pine);font-weight:600">${r.saving ? '−' + eur(r.saving) : ''}</span><button class="btn small" data-action="deal-store" data-chain="${esc(r.st.chain)}">Op lijstje</button></div></div>`).join('');

  const tracked = H().products.filter((p) => daysLeft(p) !== null).sort((x, y) => daysLeft(x)! - daysLeft(y)!).slice(0, 6);
  const supply = tracked.length ? tracked.map((p) => { const st = statusOf(p); const pct = Math.max(4, Math.min(100, (daysLeft(p)! / p.interval) * 100));
    const color = ({ danger: 'var(--danger)', warn: 'var(--warn)', ok: 'var(--ok)' } as Record<string, string>)[st.key] ?? 'var(--line)';
    return `<div class="supply"><div style="min-width:0"><div class="name">${esc(p.name)}</div><div class="meta">${p.where.length ? esc(anyLabel(p.where)) : 'Overal'}</div></div>
      <button class="btn small" data-action="prod-list" data-id="${esc(p.id)}">Op de lijst</button><div class="bar"><span style="width:${pct}%;background:${color}"></span></div></div>`; }).join('')
    : '<p class="sub" style="font-size:13.5px">Zodra je een vast product van de lijst tikt, houdt Skwirl bij wanneer het weer op is.</p>';

  return `<div class="section-head"><div><div class="eyebrow">${esc(dateStr)}</div><h1>Dit loont nu</h1></div></div>
    <div class="grid-2"><div class="stack">${listCard}${hero}
      ${others ? `<div class="eyebrow" style="margin-top:6px">Ook in de buurt</div><div class="deal-grid">${others}</div>` : ''}</div>
      <div class="stack"><section class="card"><div class="section-head"><h2>Bijna op</h2><button class="btn small ghost" data-tab="producten">Alles</button></div>${supply}</section></div></div>`;
}

function viewLijstje(): string {
  const a = currentAddr();
  const chain = currentChain();
  const open = (c: string): number => L().filter((l) => onListFor(l, c) && !l.done).length;
  const chains = Object.keys(H().chains).sort((x, y) => Number(open(y) > 0) - Number(open(x) > 0));
  const picker = chains.map((c) => `<button aria-pressed="${c === chain}" data-action="li-chain" data-v="${esc(c)}">${esc(chainName(c))}${open(c) ? `<span class="n">${open(c)}</span>` : ''}</button>`).join('');
  const ns = nearestStore(chain, a);
  const where = ns ? (ns.st.online ? 'Online bestellen' : `${ns.st.place}, ${km(ns.d)}${a ? ` vanaf ${a.name.toLowerCase()}` : ''}`) : '';
  return `<div class="section-head"><div><h1>Boodschappen</h1><p class="sub">Kies je winkel. Zet erop wat op is en tik het eraf als je het hebt.</p></div>${syncLabel()}</div>
    <nav class="shop-pick" aria-label="Winkel">${picker}</nav>
    <section class="card"><div class="section-head" style="margin-bottom:0"><h2>${esc(chainName(chain))}</h2><span class="unit">${esc(where)}</span></div>${listPanel(chain, false)}</section>`;
}

function viewDeals(): string {
  const a = currentAddr();
  const all = D().filter((dl) => !ui.dealsMine || product(dl.productId));
  const byChain = new Map<string, Deal[]>();
  all.forEach((dl) => byChain.set(dl.chain, (byChain.get(dl.chain) ?? []).concat(dl)));
  const groups = [...byChain.entries()].map(([chain, dls]) => ({ chain, dls, ns: nearestStore(chain, a) }))
    .sort((x, y) => (x.ns?.d ?? 99) - (y.ns?.d ?? 99));
  const upd = deals!.data.updatedAt ? new Date(deals!.data.updatedAt).toLocaleDateString('nl-NL', { weekday: 'long', day: 'numeric', month: 'long' }) : null;
  return `<div class="section-head"><div><h1>Aanbiedingen</h1><p class="sub">${upd ? `Opgehaald op ${esc(upd)}${deals!.data.source ? ` door ${esc(deals!.data.source)}` : ''}. Controleer de prijs in de winkel.` : 'Nog niets opgehaald. De wekelijkse Claude-taak zet hier de acties neer.'}</p></div></div>
    <div class="filters"><button class="pill" aria-pressed="${ui.dealsMine}" data-action="deals-mine" data-v="1">Voor mijn producten</button><button class="pill" aria-pressed="${!ui.dealsMine}" data-action="deals-mine" data-v="0">Alles</button></div>
    ${groups.length ? groups.map((g) => `<section class="card" style="margin-bottom:12px"><div class="section-head"><h2>${esc(chainName(g.chain))}</h2><span class="unit">${g.ns ? (g.ns.st.online ? 'Online' : `${esc(g.ns.st.place)}, ${km(g.ns.d)}`) : 'Geen vestiging gevolgd'}</span></div>
      ${g.dls.map((dl) => { const p = product(dl.productId); const on = L().some((l) => l.dealId === dl.id && !l.done);
        return `<div class="supply"><div style="min-width:0"><div class="name">${esc(p?.name ?? dl.title)}</div><div class="meta">${esc(dealLine(dl))}${dl.url ? ` · <a href="${esc(dl.url)}" target="_blank" rel="noopener">bron</a>` : ''}</div></div>
          <button class="btn small" data-action="deal-add" data-id="${esc(dl.id)}" ${on ? 'disabled' : ''}>${on ? 'Op de lijst' : 'Op lijstje'}</button></div>`; }).join('')}</section>`).join('')
      : '<div class="empty">Geen aanbiedingen om te tonen.</div>'}`;
}

function viewProducten(): string {
  const rows = H().products.slice().sort((x, y) => (daysLeft(x) ?? 999) - (daysLeft(y) ?? 999) || x.name.localeCompare(y.name)).map((p) => {
    const st = statusOf(p);
    return `<div class="prod-row">${iconFor(p.name)}<div style="min-width:0"><div style="font-weight:700">${esc(p.name)}</div>
      <div class="unit">${p.where.length ? esc(anyLabel(p.where)) : 'Overal'} · ${p.interval >= 300 ? 'jaarlijks' : `gaat ±${p.interval} dagen mee`}${p.target ? ` · doel ${eur(p.target)}` : ''}</div>
      <div class="where-tag"><span class="chip ${st.key}">${esc(st.label)}</span>${p.loose ? '<span class="chip">Los, zonder barcode</span>' : ''}</div></div>
      <div class="prod-actions"><button class="btn small" data-action="prod-list" data-id="${esc(p.id)}">Op de lijst</button><button class="btn small ghost" data-action="prod-edit" data-id="${esc(p.id)}">Bewerken</button></div></div>`;
  }).join('');
  return `<div class="section-head"><div><h1>Vaste producten</h1><p class="sub">Wat je steeds opnieuw koopt. Tik je het van de lijst, dan weet Skwirl wanneer het weer op is.</p></div>
    <button class="btn primary" data-action="prod-new">Product toevoegen</button></div>
    <section class="card">${rows || '<div class="empty">Nog geen vaste producten. Voeg toe wat je steeds opnieuw koopt.</div>'}</section>`;
}

function viewPlekken(): string {
  const addrs = H().addresses.map((a) => `<div class="card addr">
    <div><h3>${esc(a.name)}</h3><div class="unit">${esc(a.place)}</div></div>
    <button class="btn small ${currentAddr()?.id === a.id ? 'primary' : ''}" data-action="addr" data-v="${esc(a.id)}">${currentAddr()?.id === a.id ? 'Hier ben ik' : 'Kies'}</button>
    <div style="grid-column:1/-1"><label for="r-${esc(a.id)}" class="unit">Winkels tot <strong class="num" id="rv-${esc(a.id)}">${a.radius} km</strong></label>
    <input type="range" id="r-${esc(a.id)}" min="0.5" max="20" step="0.5" value="${a.radius}" data-action="radius" data-v="${esc(a.id)}"></div>
    <button class="btn small ghost" data-action="addr-del" data-v="${esc(a.id)}">Verwijderen</button></div>`).join('');
  const phys = H().stores.filter((s) => !s.online);
  const head = `<div class="store-row head" style="grid-template-columns:minmax(0,1fr) ${H().addresses.map(() => '64px').join(' ')} 48px"><span>Winkel</span>${H().addresses.map((a) => `<span class="d">${esc(a.name)}</span>`).join('')}<span>Volg</span></div>`;
  const row = (st: Store): string => `<div class="store-row" style="grid-template-columns:minmax(0,1fr) ${H().addresses.map(() => '64px').join(' ')} 48px">
    <div style="min-width:0"><strong>${esc(st.name)}</strong> <span class="unit">${esc(st.place)}</span></div>
    ${H().addresses.map((a) => { const d = st.online ? 0 : distanceKm(a, st); return `<span class="d num ${st.online || d <= a.radius ? 'in' : ''}">${st.online ? '—' : d < 30 ? km(d) : '—'}</span>`; }).join('')}
    <span class="switch"><input type="checkbox" ${st.follow ? 'checked' : ''} data-action="follow" data-v="${esc(st.id)}" aria-label="Volg ${esc(st.name)} ${esc(st.place)}"></span></div>`;
  return `<div class="section-head"><div><h1>Plekken &amp; winkels</h1><p class="sub">Vanaf deze adressen zoekt Skwirl de beste winkel.</p></div><button class="btn" data-action="addr-new">Adres toevoegen</button></div>
    <div class="deal-grid">${addrs || '<div class="empty">Nog geen adressen.</div>'}</div>
    <section class="card" style="margin-top:16px"><div class="section-head"><h2>Winkels die je volgt</h2><button class="btn small" data-action="store-new">Winkel toevoegen</button></div>
      <div class="table-scroll"><div>${head}${phys.map(row).join('')}${H().stores.filter((s) => s.online).map(row).join('')}</div></div></section>
    <section class="card" style="margin-top:16px"><h2>Samen gebruiken</h2>
      <p class="sub">Verbonden met <strong>${esc(cfg!.owner)}/${esc(cfg!.repo)}</strong> als <strong>${esc(cfg!.name)}</strong>.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px"><button class="btn" data-action="share">Telefoon koppelen</button><button class="btn ghost" data-action="disconnect">Ontkoppelen op dit apparaat</button></div></section>`;
}

/* ---------- Panelen (onderin) ---------- */

function sheetHtml(): string {
  if (!sheet) return '';
  const wrap = (title: string, body: string, art = ''): string => `<div class="sheet-bg" data-action="sh-close"></div><div class="sheet-in">
    <div class="sheet-head">${art}<h2 id="sh-h">${esc(title)}</h2><button class="x" data-action="sh-close" aria-label="Sluiten">×</button></div>${body}</div>`;

  if (sheet.type === 'item') {
    const l = L().find((x) => x.id === (sheet as { id: string }).id);
    if (!l) { sheet = null; return ''; }
    const chain = currentChain(); const specs = (l.spec ?? '').split(' · ').filter(Boolean);
    return wrap(l.name, `
      <label class="unit" for="sh-spec">Eigenschap</label>
      <input id="sh-spec" value="${esc(l.spec ?? '')}" placeholder="Bijv. bio of 500 ml" maxlength="60">
      <div class="quick" style="margin-top:8px">${SPEC_CHIPS.map((c) => `<button data-action="sh-chip" data-v="${esc(c)}" aria-pressed="${specs.includes(c)}">${esc(c)}</button>`).join('')}</div>
      <div class="sheet-row"><span>Aantal</span><div class="stepper"><button data-action="sh-qty" data-d="-1" aria-label="Minder">−</button><span class="num">${l.qty}</span><button data-action="sh-qty" data-d="1" aria-label="Meer">+</button></div></div>
      ${multiChain(kindOf(chain)) && !l.dealId ? `<div class="sheet-row"><span>Waar</span><div class="scope" style="margin:0"><button aria-pressed="${!l.kinds}" data-action="sh-scope" data-v="0">Alleen ${esc(chainName(chain))}</button><button aria-pressed="${!!l.kinds}" data-action="sh-scope" data-v="1">${esc(anyLabel([kindOf(chain)]))}</button></div></div>` : ''}
      ${l.addedBy ? `<p class="hint">Toegevoegd door ${esc(l.addedBy)}</p>` : ''}
      <div class="sheet-foot"><button class="btn" data-action="sh-del">Verwijderen</button><button class="btn primary" data-action="sh-close">Klaar</button></div>`, iconFor(l.name));
  }

  if (sheet.type === 'product') {
    const p = product(sheet.id) ?? { id: '', name: '', cat: 'Overig', where: [], loose: false, interval: 14, target: null, normal: null, lastBought: null, note: null } as Product;
    const kinds = Object.keys(KIND_NAME) as Kind[];
    return wrap(sheet.id ? p.name : 'Product toevoegen', `<form id="prod-form" class="sheet-form">
      <label>Naam<input name="name" required maxlength="80" value="${esc(p.name)}" placeholder="Bijv. Jonagold appels"></label>
      <label>Categorie<select name="cat">${CATS.map((c) => `<option ${c === p.cat ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
      <fieldset><legend>Te koop bij</legend><div class="quick">${kinds.filter((k) => k !== 'overig').map((k) => `<label class="chk-chip"><input type="checkbox" name="where" value="${k}" ${p.where.includes(k) ? 'checked' : ''}> ${esc(KIND_NAME[k])}</label>`).join('')}</div>
        <p class="hint">Niets aangevinkt = maakt niet uit waar.</p></fieldset>
      <label class="chk"><input type="checkbox" name="loose" ${p.loose ? 'checked' : ''}> Los, zonder barcode</label>
      <div class="two"><label>Gaat mee (dagen)<input name="interval" type="number" min="1" max="400" required value="${p.interval}"></label>
      <label>Doelprijs (€)<input name="target" type="number" min="0" step="0.01" value="${p.target ?? ''}"></label></div>
      <div class="sheet-foot">${sheet.id ? '<button type="button" class="btn" data-action="prod-del">Verwijderen</button>' : ''}${sheet.id ? '<button type="button" class="btn" data-action="prod-bought">Net gekocht</button>' : ''}<button class="btn primary" type="submit">Opslaan</button></div></form>`, sheet.id ? iconFor(p.name) : '');
  }

  if (sheet.type === 'address' || sheet.type === 'store') {
    const isStore = sheet.type === 'store';
    return wrap(isStore ? 'Winkel toevoegen' : 'Adres toevoegen', `<form id="${isStore ? 'store-form' : 'addr-form'}" class="sheet-form">
      ${isStore ? `<label>Keten<select name="chain">${Object.keys(H().chains).map((c) => `<option value="${esc(c)}">${esc(chainName(c))}</option>`).join('')}<option value="__new">Andere winkel…</option></select></label>
        <div class="two"><label>Naam (bij andere winkel)<input name="newName" maxlength="40" placeholder="Bijv. Slagerij Jansen"></label>
        <label>Soort<select name="newKind">${(Object.keys(KIND_NAME) as Kind[]).map((k) => `<option value="${k}">${esc(KIND_NAME[k])}</option>`).join('')}</select></label></div>`
        : '<label>Naam<input name="name" required maxlength="30" placeholder="Bijv. Thuis, Werk, Ouders"></label>'}
      <label>Adres zoeken<input name="q" id="place-q" placeholder="Straat en plaats" autocomplete="off"></label>
      <div class="place-results">${placeResults.map((r, i) => `<label class="place"><input type="radio" name="place" value="${i}" ${i === 0 ? 'checked' : ''}> ${esc(r.label)}</label>`).join('')}</div>
      <p class="hint">Adressen zoeken gaat via PDOK, de openbare adresdienst van de overheid.</p>
      <div class="sheet-foot"><button type="button" class="btn" data-action="place-search">Zoeken</button><button class="btn primary" type="submit" ${placeResults.length ? '' : 'disabled'}>Toevoegen</button></div></form>`);
  }

  // koppelen
  const link = shareLink();
  return wrap('Telefoon koppelen', `<p class="sub">Open deze link op de andere telefoon. Daar vult de app de koppeling zelf in en vraagt alleen een naam.</p>
    <p class="warn-note">In de link zit de sleutel van jullie gegevens. Stuur hem alleen naar je vriendin, bijvoorbeeld via AirDrop of WhatsApp, en verwijder het bericht daarna.</p>
    <input readonly value="${esc(link)}" id="share-link" class="mono">
    <div class="sheet-foot"><button class="btn" data-action="copy-link">Kopiëren</button>${'share' in navigator ? '<button class="btn primary" data-action="native-share">Delen</button>' : ''}</div>`);
}

function shareLink(): string {
  const payload = btoa(JSON.stringify({ owner: cfg!.owner, repo: cfg!.repo, branch: cfg!.branch, token: cfg!.token })).replace(/=+$/, '');
  return `${location.origin}${location.pathname}#koppel=${payload}`;
}

/* ---------- Koppelscherm ---------- */

function setupHtml(prefill: Partial<Config>, error = ''): string {
  const fromLink = !!prefill.token;
  return `<div class="ob-in">
    <div class="ob-hero"><span class="logo" aria-label="Skwirl">${$('header .logo').innerHTML}</span><p class="tag">Slim inslaan. Nooit te veel betalen.</p></div>
    <form id="setup-form" class="card sheet-form" autocomplete="off">
      <h2>${fromLink ? 'Bijna klaar' : 'Koppel je gegevens'}</h2>
      <p class="sub">${fromLink ? 'De koppeling staat al klaar. Hoe heet je?' : 'Skwirl bewaart alles in een privé-repository op GitHub. Zie de README voor de stappen.'}</p>
      <label>Je naam<input name="name" required maxlength="30" value="${esc(prefill.name ?? '')}" placeholder="Zo zien anderen wie iets toevoegde"></label>
      <div ${fromLink ? 'hidden' : ''}>
        <label>GitHub-gebruikersnaam<input name="owner" required value="${esc(prefill.owner ?? '')}" autocapitalize="off" spellcheck="false"></label>
        <label>Repository met gegevens<input name="repo" required value="${esc(prefill.repo ?? 'skwirl-data')}" autocapitalize="off" spellcheck="false"></label>
        <label>Sleutel (fine-grained token)<input name="token" type="password" required value="${esc(prefill.token ?? '')}" autocapitalize="off" spellcheck="false"></label>
        <input type="hidden" name="branch" value="${esc(prefill.branch ?? 'main')}">
      </div>
      ${error ? `<p class="warn-note">${esc(error)}</p>` : ''}
      <button class="btn primary" type="submit" style="min-height:48px;justify-content:center">Verbinden</button>
    </form></div>`;
}

let setupPrefill: Partial<Config> = {};
function showSetup(error = ''): void {
  const ob = $('#ob');
  ob.classList.add('open');
  ob.innerHTML = setupHtml(setupPrefill, error);
}

/* ---------- Render ---------- */

const TABS: [Tab, string, string][] = [
  ['vandaag', 'Vandaag', '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>'],
  ['lijstje', 'Boodschappen', '<path d="M4 7h2.5l2 10h9.5l2-7.5H7.4"/><circle cx="10" cy="20" r="1.2"/><circle cx="17" cy="20" r="1.2"/>'],
  ['deals', 'Deals', '<path d="M3.5 12.5V4.5a1 1 0 0 1 1-1h8l8 8-9 9z"/><circle cx="8.5" cy="8.5" r="1.5"/>'],
  ['producten', 'Producten', '<path d="M3.5 7.5 12 3l8.5 4.5v9L12 21l-8.5-4.5z"/><path d="M3.5 7.5 12 12l8.5-4.5M12 12v9"/>'],
];
const VIEWS: Record<Tab, () => string> = { vandaag: viewVandaag, lijstje: viewLijstje, deals: viewDeals, producten: viewProducten, plekken: viewPlekken };

function render(): void {
  if (!list || !house || !deals) return;
  save(UI_KEY, ui);
  const ae = document.activeElement as HTMLInputElement | null;
  const keep = ae && ae.id === 'li-new' ? { s: ae.selectionStart, e: ae.selectionEnd } : null;
  const openCount = L().filter((l) => !l.done).length;
  const addrs = H().addresses;
  $('#addr-pick').hidden = !addrs.length;
  $<HTMLSelectElement>('#addr-sel').innerHTML = addrs.map((a) => `<option value="${esc(a.id)}" ${currentAddr()?.id === a.id ? 'selected' : ''}>${esc(a.name)}</option>`).join('');
  $('#tabs').innerHTML = TABS.map(([k, l, ic]) => `<button ${ui.tab === k ? 'aria-current="page"' : ''} data-tab="${k}"><svg viewBox="0 0 24 24" aria-hidden="true">${ic}</svg><span class="l">${l}</span>${k === 'lijstje' && openCount ? `<span class="count">${openCount}</span>` : ''}</button>`).join('');
  const hb = $('#hb-plekken'); if (ui.tab === 'plekken') hb.setAttribute('aria-current', 'page'); else hb.removeAttribute('aria-current');
  $('#view').innerHTML = VIEWS[ui.tab]();
  renderSheet();
  if (keep) { const inp = document.getElementById('li-new') as HTMLInputElement | null; if (inp) { inp.focus(); try { inp.setSelectionRange(keep.s, keep.e); } catch { /* negeren */ } } }
}
function renderSheet(): void {
  const sh = $('#sheet');
  // niet opnieuw opbouwen terwijl iemand in het paneel typt
  if (sheet && sh.classList.contains('open') && sh.contains(document.activeElement) && (document.activeElement as HTMLElement).tagName === 'INPUT' && (document.activeElement as HTMLInputElement).type !== 'checkbox' && (document.activeElement as HTMLInputElement).type !== 'radio') return;
  const html = sheetHtml();
  sh.classList.toggle('open', !!sheet);
  sh.innerHTML = html;
}

let toastTimer: number | undefined;
function toast(msg: string): void {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = window.setTimeout(() => t.classList.remove('show'), 2800);
}

/* ---------- Synchroniseren ---------- */

function persistCache(): void {
  if (!list || !house || !deals) return;
  save(CACHE_KEY, { list: list.snapshot(), house: house.snapshot(), deals: deals.snapshot() });
}
function onSyncError(e: unknown): void {
  if (e instanceof GitHubError && e.status === 0) syncState = { kind: 'offline', at: syncState.at, msg: '' };
  else { syncState = { kind: 'error', at: syncState.at, msg: e instanceof Error ? e.message : String(e) }; toast(syncState.msg); }
  render();
}
async function pullAll(): Promise<void> {
  if (!list || !house || !deals) return;
  try {
    await Promise.all([list.pull(), house.pull(), deals.pull()]);
    syncState = { kind: 'ok', at: Date.now(), msg: '' };
  } catch (e) { onSyncError(e); return; }
  render();
}
function startPolling(): void {
  clearInterval(pollTimer);
  pollTimer = window.setInterval(() => { if (document.visibilityState === 'visible') void pullAll(); }, POLL_MS);
}

async function connect(): Promise<void> {
  const conn: Connection = { owner: cfg!.owner, repo: cfg!.repo, token: cfg!.token, branch: cfg!.branch || 'main', api: cfg!.api };
  const cache = load<{ list: { data: ListFile; sha: string | null }; house: { data: Household; sha: string | null }; deals: { data: DealsFile; sha: string | null } }>(CACHE_KEY);
  list = new JsonFile(conn, 'list.json', emptyList, cache?.list);
  house = new JsonFile(conn, 'household.json', emptyHousehold, cache?.house);
  deals = new JsonFile(conn, 'deals.json', emptyDeals, cache?.deals);
  for (const f of [list, house, deals] as JsonFile<unknown>[]) {
    f.onChange = () => { persistCache(); render(); };
    f.onError = onSyncError;
  }
  $('#ob').classList.remove('open'); $('#ob').innerHTML = '';
  render();
  await pullAll();
  if (!H().chains || !Object.keys(H().chains).length) house.mutate((h) => { h.chains = { ...DEFAULT_CHAINS, ...(h.chains ?? {}) }; }, 'Ketens toegevoegd').catch(() => {});
  startPolling();
}

/* ---------- Interactie ---------- */

let pressTimer: number | undefined, pressed = false, pressXY: [number, number] | null = null;
document.addEventListener('pointerdown', (e) => {
  pressed = false;
  const t = (e.target as HTMLElement).closest<HTMLElement>('.tile[data-id]'); if (!t) return;
  pressXY = [e.clientX, e.clientY];
  pressTimer = window.setTimeout(() => { pressed = true; sheet = { type: 'item', id: t.dataset.id! }; navigator.vibrate?.(10); render(); }, 450);
});
document.addEventListener('pointermove', (e) => { if (pressTimer && pressXY && Math.hypot(e.clientX - pressXY[0], e.clientY - pressXY[1]) > 10) { clearTimeout(pressTimer); pressTimer = undefined; } });
for (const ev of ['pointerup', 'pointercancel']) document.addEventListener(ev, () => { clearTimeout(pressTimer); pressTimer = undefined; });
document.addEventListener('contextmenu', (e) => { const t = (e.target as HTMLElement).closest<HTMLElement>('.tile[data-id]'); if (t) { e.preventDefault(); sheet = { type: 'item', id: t.dataset.id! }; render(); } });

function saveItemSpec(): void {
  const inp = document.getElementById('sh-spec') as HTMLInputElement | null;
  const l = sheet?.type === 'item' ? L().find((x) => x.id === (sheet as { id: string }).id) : null;
  if (inp && l && inp.value.trim() !== (l.spec ?? '')) setItem(l.id, { spec: inp.value.trim() || null }, `${l.name}: ${inp.value.trim() || 'geen eigenschap'}`);
}

document.addEventListener('click', (e) => {
  if (pressed) { pressed = false; return; } // klik die bij ingedrukt houden hoort
  const target = e.target as HTMLElement;
  const tabEl = target.closest<HTMLElement>('[data-tab]');
  if (tabEl) { e.preventDefault(); ui.tab = tabEl.dataset.tab as Tab; try { history.replaceState(null, '', '#' + ui.tab); } catch { /* negeren */ } render(); window.scrollTo(0, 0); return; }
  const el = target.closest<HTMLElement>('[data-action]');
  if (!el || !list || !house) return;
  const act = el.dataset.action, v = el.dataset.v ?? '', id = el.dataset.id ?? '';
  switch (act) {
    case 'li-out': { const it = L().find((x) => x.id === id); if (!it) return; el.classList.add('pop'); setTimeout(() => takeOff(it), 140); break; }
    case 'li-in': el.classList.add('pop'); setTimeout(() => setItem(id, { done: false, doneAt: null, createdAt: Date.now() }, `+ ${L().find((x) => x.id === id)?.name ?? ''}`), 140); break;
    case 'li-quick': el.classList.add('pop'); addItem({ name: v }); break;
    case 'li-chain': ui.listChain = v; render(); break;
    case 'li-scope': ui.addAny = v === '1'; render(); break;
    case 'sh-close': if (sheet?.type === 'item') saveItemSpec(); sheet = null; placeResults = []; render(); break;
    case 'sh-del': if (sheet?.type === 'item') { const sid = sheet.id; sheet = null; removeItem(sid); } break;
    case 'sh-qty': { const l = sheet?.type === 'item' ? L().find((x) => x.id === (sheet as { id: string }).id) : null; if (l) setItem(l.id, { qty: Math.max(1, Math.min(99, l.qty + Number(el.dataset.d))) }, `${l.name}: aantal`); break; }
    case 'sh-scope': { const l = sheet?.type === 'item' ? L().find((x) => x.id === (sheet as { id: string }).id) : null; const c = currentChain();
      if (l) setItem(l.id, v === '1' ? { kinds: [kindOf(c)], chain: null } : { kinds: null, chain: c }, `${l.name}: winkel`); break; }
    case 'sh-chip': {
      const l = sheet?.type === 'item' ? L().find((x) => x.id === (sheet as { id: string }).id) : null; if (!l) return;
      const inp = document.getElementById('sh-spec') as HTMLInputElement | null;
      const cur = (inp ? inp.value : l.spec ?? '').split(' · ').map((x) => x.trim()).filter(Boolean);
      const next = cur.includes(v) ? cur.filter((x) => x !== v) : cur.concat(v);
      inp?.blur(); setItem(l.id, { spec: next.join(' · ') || null }, `${l.name}: ${next.join(', ') || 'geen eigenschap'}`); break;
    }
    case 'prod-list': { const p = product(id); if (p) { addItem({ name: p.name, productId: p.id }); toast(`${p.name} staat op je lijst`); } break; }
    case 'prod-new': sheet = { type: 'product', id: null }; render(); break;
    case 'prod-edit': sheet = { type: 'product', id }; render(); break;
    case 'prod-del': if (sheet?.type === 'product' && sheet.id) { const pid = sheet.id; const name = product(pid)?.name; sheet = null;
      house.mutate((h) => { h.products = h.products.filter((p) => p.id !== pid); }, `Product weg: ${name}`).catch(() => {}); } break;
    case 'prod-bought': if (sheet?.type === 'product' && sheet.id) { const pid = sheet.id; const now = Date.now(); sheet = null;
      house.mutate((h) => { const p = h.products.find((x) => x.id === pid); if (p) p.lastBought = now; }, 'Net gekocht').catch(() => {}); toast('Bijgehouden: net gekocht'); } break;
    case 'deal-add': { const dl = D().find((x) => x.id === id); if (!dl) return; const p = product(dl.productId);
      addItem({ name: p?.name ?? dl.title, productId: p?.id ?? null, dealId: dl.id, chain: dl.chain, kinds: null }, dl.chain); toast(`Op je ${chainName(dl.chain)}-lijst gezet`); break; }
    case 'deal-store': { const r = relevantDeals(currentAddr()).find((x) => x.st.chain === el.dataset.chain); if (!r) return;
      r.items.filter(({ dl }) => !L().some((l) => l.dealId === dl.id && !l.done)).forEach(({ dl, p }) => addItem({ name: p?.name ?? dl.title, productId: p?.id ?? null, dealId: dl.id, chain: dl.chain, kinds: null }, dl.chain));
      ui.listChain = r.st.chain; toast(`${r.items.length} producten op je ${chainName(r.st.chain)}-lijst gezet`); render(); break; }
    case 'deals-mine': ui.dealsMine = v === '1'; render(); break;
    case 'addr': ui.addr = v; render(); break;
    case 'addr-new': placeResults = []; sheet = { type: 'address' }; render(); break;
    case 'store-new': placeResults = []; sheet = { type: 'store' }; render(); break;
    case 'addr-del': { const a = H().addresses.find((x) => x.id === v); if (a && confirm(`${a.name} verwijderen?`)) house.mutate((h) => { h.addresses = h.addresses.filter((x) => x.id !== v); }, `Adres weg: ${a.name}`).catch(() => {}); break; }
    case 'place-search': void doPlaceSearch(); break;
    case 'share': sheet = { type: 'share' }; render(); break;
    case 'copy-link': navigator.clipboard?.writeText(shareLink()).then(() => toast('Link gekopieerd'), () => toast('Kopiëren lukt niet, selecteer de link zelf')); break;
    case 'native-share': navigator.share?.({ title: 'Skwirl', text: 'Open deze link om onze Skwirl-lijst te koppelen', url: shareLink() }).catch(() => {}); break;
    case 'disconnect': if (confirm('Skwirl op dit apparaat ontkoppelen? Je gegevens blijven op GitHub staan.')) { localStorage.removeItem(CFG_KEY); localStorage.removeItem(CACHE_KEY); location.reload(); } break;
  }
});

async function doPlaceSearch(): Promise<void> {
  const q = (document.getElementById('place-q') as HTMLInputElement | null)?.value.trim();
  if (!q) { toast('Typ eerst een straat en plaats'); return; }
  const form = document.querySelector<HTMLFormElement>('#addr-form, #store-form');
  const keep = form ? Object.fromEntries(new FormData(form) as unknown as Iterable<[string, string]>) : {};
  try { placeResults = await searchAddress(q); } catch (e) { toast(e instanceof Error ? e.message : 'Zoeken mislukt'); return; }
  if (!placeResults.length) toast('Niets gevonden. Probeer straat, huisnummer en plaats.');
  (document.activeElement as HTMLElement | null)?.blur();
  render();
  const f2 = document.querySelector<HTMLFormElement>('#addr-form, #store-form');
  if (f2) for (const [k, val] of Object.entries(keep)) { const inp = f2.elements.namedItem(k) as HTMLInputElement | null; if (inp && inp.type !== 'radio') inp.value = val; }
}

document.addEventListener('change', (e) => {
  const el = e.target as HTMLInputElement;
  const act = el.dataset.action;
  if (!house) return;
  if (act === 'addr-sel') { ui.addr = el.value; render(); }
  else if (act === 'li-chain-sel') { ui.listChain = el.value; render(); }
  else if (act === 'follow') { const sid = el.dataset.v!; const on = el.checked; house.mutate((h) => { const s = h.stores.find((x) => x.id === sid); if (s) s.follow = on; }, `${on ? 'Volg' : 'Volg niet meer'}: ${sid}`).catch(() => {}); }
  else if (act === 'radius') { const aid = el.dataset.v!; const r = parseFloat(el.value); house.mutate((h) => { const a = h.addresses.find((x) => x.id === aid); if (a) a.radius = r; }, 'Straal aangepast').catch(() => {}); }
  else if (el.id === 'sh-spec') saveItemSpec();
});

document.addEventListener('input', (e) => {
  const el = e.target as HTMLInputElement;
  if (el.dataset.action === 'radius') { const lab = document.getElementById('rv-' + el.dataset.v); if (lab) lab.textContent = el.value + ' km'; }
  if (el.id === 'li-new') draft = el.value;
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && sheet) { sheet = null; render(); }
  if (e.key === 'Enter' && (e.target as HTMLElement).id === 'place-q') { e.preventDefault(); void doPlaceSearch(); }
});

document.addEventListener('submit', (e) => {
  const form = e.target as HTMLFormElement;
  e.preventDefault();
  const fd = new FormData(form);
  const get = (k: string): string => String(fd.get(k) ?? '').trim();

  if (form.id === 'setup-form') { void doSetup({ name: get('name'), owner: get('owner'), repo: get('repo'), token: get('token'), branch: get('branch') || 'main' }); return; }
  if (!list || !house) return;

  if (form.id === 'li-form') {
    const text = draft.trim(); if (!text) { toast('Typ eerst wat er op is'); return; }
    draft = ''; const inp = document.getElementById('li-new') as HTMLInputElement | null; if (inp) inp.value = '';
    addItem(parseEntry(text));
    return;
  }
  if (form.id === 'prod-form' && sheet?.type === 'product') {
    const pid = sheet.id ?? uid('p');
    const target = parseFloat(get('target'));
    const fields = { name: get('name'), cat: get('cat'), where: fd.getAll('where').map(String) as Kind[], loose: fd.get('loose') === 'on', interval: Math.max(1, parseInt(get('interval'), 10) || 14), target: target > 0 ? target : null };
    if (!fields.name) { toast('Geef het product een naam'); return; }
    const isNew = !sheet.id; sheet = null;
    house.mutate((h) => {
      const p = h.products.find((x) => x.id === pid);
      if (p) Object.assign(p, fields);
      else h.products.push({ id: pid, normal: null, lastBought: null, note: null, ...fields });
    }, `${isNew ? 'Nieuw product' : 'Product'}: ${fields.name}`).catch(() => {});
    toast(isNew ? `${fields.name} toegevoegd` : 'Opgeslagen');
    return;
  }
  if ((form.id === 'addr-form' || form.id === 'store-form') && placeResults.length) {
    const pl = placeResults[Number(fd.get('place') ?? 0)] ?? placeResults[0];
    if (form.id === 'addr-form') {
      const name = get('name') || 'Adres';
      const a: Address = { id: uid('a'), name, place: pl.place, lat: +pl.lat.toFixed(5), lon: +pl.lon.toFixed(5), radius: 5 };
      house.mutate((h) => { if (!h.addresses.some((x) => x.id === a.id)) h.addresses.push(a); }, `Adres: ${name}`).catch(() => {});
      if (!ui.addr) ui.addr = a.id;
    } else {
      let chain = get('chain'); const newName = get('newName');
      const newChain = chain === '__new' ? { id: newName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || uid('c'), name: newName || 'Winkel', kind: get('newKind') as Kind } : null;
      if (newChain) chain = newChain.id;
      const st: Store = { id: uid('s'), chain, name: newChain ? newChain.name : chainName(chain), place: pl.place, type: KIND_NAME[newChain ? newChain.kind : kindOf(chain)], lat: +pl.lat.toFixed(5), lon: +pl.lon.toFixed(5), follow: true };
      house.mutate((h) => { if (newChain && !h.chains[newChain.id]) h.chains[newChain.id] = { name: newChain.name, kind: newChain.kind }; if (!h.stores.some((x) => x.id === st.id)) h.stores.push(st); }, `Winkel: ${st.name} ${st.place}`).catch(() => {});
    }
    sheet = null; placeResults = []; render();
  }
});

async function doSetup(c: Config): Promise<void> {
  if (!c.name || !c.owner || !c.repo || !c.token) { setupPrefill = c; showSetup('Vul alle velden in'); return; }
  const btn = document.querySelector<HTMLButtonElement>('#setup-form button[type=submit]'); if (btn) { btn.disabled = true; btn.textContent = 'Verbinden…'; }
  const err = await checkConnection(c);
  if (err) { setupPrefill = c; showSetup(err); return; }
  cfg = c; save(CFG_KEY, cfg);
  await connect();
}

/* ---------- Start ---------- */

function readLinkConfig(): Partial<Config> | null {
  const m = location.hash.match(/^#koppel=([A-Za-z0-9+/_-]+)$/);
  if (!m) return null;
  try {
    const raw = JSON.parse(atob(m[1].replace(/-/g, '+').replace(/_/g, '/'))) as Partial<Config>;
    history.replaceState(null, '', location.pathname); // sleutel niet in de geschiedenis laten staan
    return raw;
  } catch { return null; }
}

const fromLink = readLinkConfig();
const hashTab = location.hash.slice(1) as Tab;
if (hashTab in VIEWS) ui.tab = hashTab;
if (fromLink) { setupPrefill = { ...fromLink, name: '' }; showSetup(); }
else if (cfg) void connect();
else showSetup();

document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void pullAll(); });
window.addEventListener('online', () => { void pullAll(); });
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
