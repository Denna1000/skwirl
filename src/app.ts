// Skwirl: gedeeld boodschappenlijstje met vaste producten, je eigen plekken en wekelijkse aanbiedingen.
// Alle gegevens staan als JSON in een privé GitHub-repository; deze code bevat geen persoonlijke gegevens.

import { JsonFile, checkConnection, GitHubError, type Connection } from './github.js';
import type { Address, Deal, DealsFile, FolderLink, Household, Kind, ListFile, ListItem, Product, Store } from './types.js';
import { parseEntry } from './parse.js';
import { dealWhen } from './deals.js';
import { addPurchase, learnedInterval } from './rhythm.js';
import { unitLabel, unitPrice } from './unit.js';
import { iconFor } from './art.js';
import { distanceKm, searchAddress, type Place } from './geo.js';
import { DAY, esc, eur, km, uid } from './util.js';

/* ---------- Instellingen en vaste waarden ---------- */

interface Config extends Connection { name: string }
interface Ui { tab: Tab; addr: string | null; listChain: string; addAny: boolean; dealsMine: boolean }
type Tab = 'vandaag' | 'lijstje' | 'deals' | 'producten' | 'plekken';

const APP_VERSION = '__VERSION__'; // wordt bij het bouwen ingevuld
const CFG_KEY = 'skwirl-config';
const CACHE_KEY = 'skwirl-cache';
const UI_KEY = 'skwirl-ui';
const POLL_MS = 10_000;
const MAX_RECENT = 40;

const DEFAULT_CHAINS: Household['chains'] = {
  ah: { name: 'Albert Heijn', kind: 'super' }, jumbo: { name: 'Jumbo', kind: 'super' }, lidl: { name: 'Lidl', kind: 'super' },
  vomar: { name: 'Vomar', kind: 'super' }, ekoplaza: { name: 'Ekoplaza', kind: 'bio' }, aldi: { name: 'Aldi', kind: 'super' }, dekamarkt: { name: 'DekaMarkt', kind: 'super' },
  kruidvat: { name: 'Kruidvat', kind: 'drogist' }, etos: { name: 'Etos', kind: 'drogist' },
  gamma: { name: 'Gamma', kind: 'bouw' }, praxis: { name: 'Praxis', kind: 'bouw' }, pets: { name: 'Pets Place', kind: 'dier' },
  bol: { name: 'bol.com', kind: 'online' },
};
// Vaste actiepagina's als de geplande taak (nog) geen folderlink heeft gevonden
const FOLDER_PAGES: Record<string, string> = {
  ah: 'https://www.ah.nl/bonus/folder', jumbo: 'https://www.jumbo.com/aanbiedingen', lidl: 'https://www.lidl.nl/c/aanbiedingen/a10008785',
  vomar: 'https://www.vomar.nl/aanbiedingen', ekoplaza: 'https://www.ekoplaza.nl/nl/aanbiedingen', kruidvat: 'https://www.kruidvat.nl/acties', etos: 'https://www.etos.nl/acties/',
  gamma: 'https://www.gamma.nl/folder', pets: 'https://www.petsplace.nl/acties', bol: 'https://www.bol.com/nl/nl/sf/aanbiedingen/',
};
const KIND_ANY: Record<Kind, string> = { super: 'elke supermarkt', bio: 'de natuurwinkel', drogist: 'elke drogist', online: 'online', bouw: 'elke bouwmarkt', dier: 'elke dierenwinkel', slager: 'elke slager', overig: 'overal' };
const KIND_NAME: Record<Kind, string> = { super: 'Supermarkt', bio: 'Natuurwinkel (Ekoplaza)', drogist: 'Drogist', online: 'Online', bouw: 'Bouwmarkt', dier: 'Dierenwinkel', slager: 'Slager', overig: 'Overig' };
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
const ui: Ui = Object.assign({ tab: 'vandaag', addr: null, listChain: 'ah', addAny: true, dealsMine: false } as Ui, load<Partial<Ui>>(UI_KEY));
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
/** Acties die nu lopen of nog komen; verlopen acties tellen nergens mee */
const liveDeals = (): Deal[] => D().filter((dl) => dealWhen(dl).state !== 'expired');
const $ = <E extends HTMLElement = HTMLElement>(sel: string): E => document.querySelector(sel) as E;

/* ---------- Afgeleide gegevens ---------- */

const chainName = (c: string): string => H().chains[c]?.name ?? (c === 'online' ? 'Online' : c);
const kindOf = (c: string): Kind => H().chains[c]?.kind ?? (c === 'online' ? 'online' : 'overig');
/** Ketens waarvan je minstens één winkel volgt; alleen die verschijnen in lijst, Vandaag en Folders */
function followedChains(): string[] {
  const followed = new Set(H().stores.filter((s) => s.follow).map((s) => s.chain));
  const keys = Object.keys(H().chains).filter((c) => followed.has(c));
  return keys.length ? keys : Object.keys(H().chains); // niets gevolgd: toon alles, anders is er geen lijst
}
const multiChain = (k: Kind): boolean => followedChains().filter((c) => kindOf(c) === k).length > 1;
const anyLabel = (kinds: Kind[]): string => { const t = kinds.map((k) => KIND_ANY[k]).join(' of '); return t.charAt(0).toUpperCase() + t.slice(1); };
const onListFor = (l: ListItem, c: string): boolean => (l.kinds ? l.kinds.includes(kindOf(c)) : l.chain === c);
const currentAddr = (): Address | null => H().addresses.find((a) => a.id === ui.addr) ?? H().addresses[0] ?? null;
const currentChain = (): string => { const fc = followedChains(); return fc.includes(ui.listChain) ? ui.listChain : fc[0]; };
const product = (id: string | null): Product | undefined => (id ? H().products.find((p) => p.id === id) : undefined);

/** Dagen tussen aankopen: geleerd uit je aankopen, anders een eerder ingestelde waarde */
const intervalOf = (p: Product): number | null => learnedInterval(p.bought) ?? p.interval ?? null;
function daysLeft(p: Product): number | null {
  const iv = intervalOf(p);
  if (!p.lastBought || !iv) return null;
  return Math.round(iv - (Date.now() - p.lastBought) / DAY);
}
const ONLINE_STORE: Store = { id: 'online', chain: 'online', name: 'Online', place: 'webshops', type: 'Online', online: true, follow: true };
function nearestStore(chain: string, a: Address | null): { st: Store; d: number } | null {
  if (chain === 'online') return { st: ONLINE_STORE, d: 0 };
  const opts = H().stores.filter((s) => s.chain === chain && s.follow);
  if (!opts.length) return null;
  return opts.map((st) => ({ st, d: st.online || !a ? 0 : distanceKm(a, st) })).sort((x, y) => x.d - y.d)[0];
}
/* ---------- Lijst-acties (alle wijzigingen idempotent, zodat ze opnieuw toepasbaar zijn) ---------- */

function scopeFor(chain: string, p?: Product): Pick<ListItem, 'chain' | 'kinds'> {
  if (p && p.where.length) return { chain: null, kinds: p.where };
  return ui.addAny && multiChain(kindOf(chain)) ? { chain: null, kinds: [kindOf(chain)] } : { chain, kinds: null };
}
/** "yoghurt" wordt "Volle yoghurt" als dat je enige vaste product met yoghurt is */
function matchProduct(name: string): Product | undefined {
  const n = name.toLowerCase().trim();
  const exact = H().products.find((x) => x.name.toLowerCase() === n);
  if (exact) return exact;
  const hits = H().products.filter((x) => x.name.toLowerCase().includes(n.replace(/s$|en$/, '')));
  return hits.length === 1 && n.length >= 3 ? hits[0] : undefined;
}
function addItem(fields: Partial<ListItem> & { name: string }, chain = currentChain()): void {
  const p = fields.productId ? product(fields.productId) : matchProduct(fields.name);
  if (p && !fields.productId && !fields.dealId) fields = { ...fields, name: p.name };
  // staat het al bij "Onlangs", zet dat dan terug in plaats van een dubbele tegel
  const again = L().find((l) => l.done && l.name.toLowerCase() === fields.name.toLowerCase() && (l.spec ?? '') === (fields.spec ?? '') && onListFor(l, chain));
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
    house!.mutate((h) => { const p = h.products.find((x) => x.id === it.productId); if (p) { p.lastBought = now; p.bought = addPurchase(p.bought, now); } }, `Gekocht: ${it.name}`).catch(() => {});
  }
}

/* ---------- Weergave: onderdelen ---------- */

function tile(l: ListItem): string {
  const dl = l.dealId ? D().find((d) => d.id === l.dealId) : null;
  const sp = [l.spec, dl ? [dl.mech, dealWhen(dl).short].filter(Boolean).join(' ') : (!l.kinds && l.chain && multiChain(kindOf(l.chain)) ? 'Alleen hier' : '')].filter(Boolean).join(' · ');
  const out = l.done;
  return `<button class="tile ${out ? 'sug' : ''}" data-action="${out ? 'li-in' : 'li-out'}" data-id="${esc(l.id)}" aria-label="${esc(l.name)}${l.spec ? ', ' + esc(l.spec) : ''}${l.qty > 1 ? `, ${l.qty} stuks` : ''}: ${out ? 'op de lijst zetten' : 'van de lijst halen'}">
    ${!out && l.qty > 1 ? `<span class="q num">${l.qty}×</span>` : ''}${iconFor(l.name)}<span class="nm">${esc(l.name)}</span>${sp ? `<span class="sp">${esc(sp)}</span>` : ''}</button>`;
}

function listPanel(chain: string, compact: boolean): string {
  const items = L().filter((l) => onListFor(l, chain));
  const todo = items.filter((l) => !l.done).sort((x, y) => x.createdAt - y.createdAt);
  const recent = items.filter((l) => l.done).sort((x, y) => (y.doneAt ?? 0) - (x.doneAt ?? 0));
  const known = new Set(items.map((l) => l.name.toLowerCase()));
  const k = kindOf(chain);
  // al je vaste producten, in jouw woorden ("Volle yoghurt", "Kipfilet broodbeleg"); wat hier te koop is eerst
  const onListNow = new Set(todo.map((l) => `${l.name.toLowerCase()}|${(l.spec ?? '').toLowerCase()}`));
  const mine = H().products
    .sort((x, y) => Number(!!x.where.length && !x.where.includes(k)) - Number(!!y.where.length && !y.where.includes(k)) || x.name.localeCompare(y.name));
  const productNames = new Set(H().products.map((p) => p.name.toLowerCase()));
  // algemene suggesties alleen als geen vast product dat al dekt ("Yoghurt" niet als je "Volle yoghurt" hebt)
  const covered = (q: string): boolean => H().products.some((p) => p.name.toLowerCase().includes(q.toLowerCase().replace(/s$|en$/, '')));
  const catalog = QUICK.filter((q) => !known.has(q.toLowerCase()) && !covered(q));
  const maxTodo = compact ? 6 : 999, maxSug = compact ? 6 : 18;
  // per vast product een tegel voor de gewone keuze en één per variant ("Bananen" en "Bananen · biologisch")
  const prodTiles = (p: Product): string[] => [null, ...(p.variants ?? [])]
    .filter((v) => !onListNow.has(`${p.name.toLowerCase()}|${(v ?? '').toLowerCase()}`))
    .map((v) => `<button class="tile sug" data-action="li-prod" data-id="${esc(p.id)}" data-spec="${esc(v ?? '')}" aria-label="${esc(p.name)}${v ? ', ' + esc(v) : ''} op de lijst zetten">${iconFor(p.name)}<span class="nm">${esc(p.name)}</span>${v ? `<span class="sp var">${esc(v)}</span>` : p.wants ? `<span class="sp">${esc(p.wants)}</span>` : ''}</button>`);
  // vaste producten altijd allemaal; daarna onlangs gekocht en algemene suggesties tot het maximum
  const extra = recent.filter((l) => !productNames.has(l.name.toLowerCase())).map(tile)
    .concat(catalog.map((q) => `<button class="tile sug" data-action="li-quick" data-v="${esc(q)}" aria-label="${esc(q)} op de lijst zetten">${iconFor(q)}<span class="nm">${esc(q)}</span></button>`))
    .slice(0, Math.max(0, maxSug - mine.length));
  const sugTiles = mine.flatMap(prodTiles).concat(extra);
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
    ${sugTiles.length ? `<div class="basket-head">Snel toevoegen</div><div class="tiles">${sugTiles.join('')}</div>` : ''}`;
}

function syncLabel(): string {
  const t = syncState.at ? new Date(syncState.at).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' }) : '';
  const pend = (list?.hasPending || house?.hasPending) ? ' · wordt opgeslagen' : '';
  const map = { ok: [`Gedeeld · bijgewerkt ${t}${pend}`, 'live'], busy: ['Bijwerken…', ''], offline: ['Offline · wijzigingen worden later opgeslagen', 'warn'], error: [syncState.msg, 'err'] } as const;
  const [txt, cls] = map[syncState.kind];
  return `<span class="sync ${cls}">${esc(txt)}</span>`;
}

/* ---------- Weergave: pagina's ---------- */


const dealShop = (dl: Deal): string => dl.shop || chainName(dl.chain);
/** Goedkoopste eerst: per kilo/liter als beide dat hebben, anders per verpakking */
function compareValue(a: Deal, b: Deal): number {
  const ua = unitPrice(a), ub = unitPrice(b);
  if (ua && ub && ua.unit === ub.unit) return ua.value - ub.value;
  return (a.effPrice ?? a.price ?? 999) - (b.effPrice ?? b.price ?? 999);
}
/** "€ 1,49 · € 10,98 per kilo" */
function priceText(dl: Deal): string {
  const up = unitPrice(dl);
  return [dl.price !== null ? eur(dl.price) : '', up ? unitLabel(up) : ''].filter(Boolean).join(' · ');
}
/** Een actie telt mee als je een winkel van die keten volgt, of als het een online actie is */
const dealVisible = (dl: Deal): boolean => dl.chain === 'online' || followedChains().includes(dl.chain);
/* Wat je over een actie zei ("Bedoel ik" / "Bedoel ik niet"), per product op titel */
const titleKey = (t: string): string => t.toLowerCase().replace(/\s+/g, ' ').trim();
function feedback(p: Product, dl: Deal): 'yes' | 'no' | null {
  const k = titleKey(dl.title);
  if ((p.dislikes ?? []).some((x) => titleKey(x) === k)) return 'no';
  if ((p.likes ?? []).some((x) => titleKey(x) === k)) return 'yes';
  return null;
}
/** Twijfelgeval waar je nog niets over zei */
const doubtful = (p: Product, dl: Deal): boolean => dl.match === 'twijfel' && feedback(p, dl) !== 'yes';
/** De actie hoort echt bij het product (niet afgewezen) */
const linked = (dl: Deal): Product | undefined => { const p = product(dl.productId); return p && feedback(p, dl) !== 'no' ? p : undefined; };
const fbButtons = (dl: Deal): string => `<div class="fb"><span>Is dit wat je zoekt?</span><button class="btn small" data-action="deal-fb" data-id="${esc(dl.id)}" data-v="yes">Bedoel ik</button><button class="btn small ghost" data-action="deal-fb" data-id="${esc(dl.id)}" data-v="no">Bedoel ik niet</button></div>`;

/** Alle lopende en komende acties voor een vast product: nu eerst, zeker voor twijfel, dan goedkoopst */
function productDeals(p: Product): { dl: Deal; w: ReturnType<typeof dealWhen> }[] {
  // alleen acties bij een soort winkel waar je dit product koopt (bijv. niet Ekoplaza bij "elke supermarkt")
  const sold = (dl: Deal): boolean => !p.where.length || p.where.includes(kindOf(dl.chain));
  return liveDeals().filter((dl) => dl.productId === p.id && dealVisible(dl) && sold(dl) && feedback(p, dl) !== 'no').map((dl) => ({ dl, w: dealWhen(dl) }))
    .sort((x, y) => Number(x.w.state === 'soon') - Number(y.w.state === 'soon') || Number(doubtful(p, x.dl)) - Number(doubtful(p, y.dl)) || compareValue(x.dl, y.dl) || x.w.startsIn - y.w.startsIn);
}
function productDealRow(p: Product, dl: Deal, w: ReturnType<typeof dealWhen>): string {
  const on = L().some((l) => l.dealId === dl.id && !l.done);
  const advice = w.state === 'soon' ? waitAdvice(p, w.startsIn) : '';
  return `<div class="pd-row"><div style="min-width:0">
      <div class="meta"><span class="chip ${w.state === 'soon' ? 'soon' : 'ok'}">${esc(w.state === 'soon' ? w.short : 'Nu')}</span>${doubtful(p, dl) ? ' <span class="chip warn">Misschien</span>' : ''} <strong>${esc(dealShop(dl))}</strong> · ${esc([dl.mech, priceText(dl)].filter(Boolean).join(' · '))}</div>
      <div class="meta when ${w.state}">${esc(w.label)}${dl.title && dl.title !== p.name ? ` · ${esc(dl.title)}` : ''}</div>
      ${dl.note ? `<div class="meta match">${esc(dl.note)}</div>` : ''}${advice ? `<div class="meta wait-tip">${esc(advice)}</div>` : ''}${doubtful(p, dl) ? fbButtons(dl) : ''}</div>
    <button class="btn small" data-action="deal-add" data-id="${esc(dl.id)}" ${on ? 'disabled' : ''}>${on ? 'Op de lijst' : 'Op lijstje'}</button></div>`;
}

/** Kort advies: wachten op de actie of niet */
function waitAdvice(p: Product, startsIn: number): string {
  const left = daysLeft(p);
  if (left === null) return '';
  return left >= startsIn ? 'Wacht even, je hebt nog genoeg.' : 'Eerder op. Koop nu alleen wat je nodig hebt.';
}
const SPAN_CHIP: Record<string, string> = { dag: 'Dagactie', weekend: 'Weekend' };

/** Wacht dit product (of alles) nog op een scan die je zelf startte? */
function searching(p?: Product): boolean {
  const last = deals!.data.updatedAt ? Date.parse(deals!.data.updatedAt) : 0;
  const asked = Math.max(H().scanAllAt ?? 0, p?.scanAt ?? 0);
  return asked > last && Date.now() - asked < 30 * 60e3; // na een half uur geven we het op
}

function viewVandaag(): string {
  const dateStr = new Date().toLocaleDateString('nl-NL', { weekday: 'long', day: 'numeric', month: 'long' });
  const all = H().products.map((p) => ({ p, ds: productDeals(p) }));
  const nowList = all.map(({ p, ds }) => ({ p, ds: ds.filter((d) => d.w.state === 'now') })).filter((x) => x.ds.length).sort((x, y) => x.p.name.localeCompare(y.p.name));
  // komende acties, bijv. uit de folder van volgende week; eerstvolgende eerst
  const soonList = all.map(({ p, ds }) => ({ p, ds: ds.filter((d) => d.w.state === 'soon') })).filter((x) => x.ds.length)
    .sort((x, y) => x.ds[0].w.startsIn - y.ds[0].w.startsIn || x.p.name.localeCompare(y.p.name));
  const none = all.filter((x) => !x.ds.length).map((x) => x.p);
  const upd = deals!.data.updatedAt ? new Date(deals!.data.updatedAt).toLocaleString('nl-NL', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : null;
  const status = searching() ? 'Skwirl zoekt nu naar acties…' : upd ? `Laatst gezocht: ${upd}` : 'Nog niet gezocht';
  const card = ({ p, ds }: { p: Product; ds: ReturnType<typeof productDeals> }): string => `<section class="card pd">
      <div class="pd-name">${iconFor(p.name)}<span>${esc(p.name)}</span>${searching(p) ? '<span class="chip soon">Wordt gezocht…</span>' : ''}</div>
      ${ds.map(({ dl, w }) => productDealRow(p, dl, w)).join('')}</section>`;
  const cards = `<h2 class="group-h">Nu in de aanbieding</h2>${nowList.length ? nowList.map(card).join('') : '<p class="sub group-sub">Op dit moment geen acties voor je vaste producten.</p>'}`
    + `<h2 class="group-h">Binnenkort in de aanbieding</h2><p class="sub group-sub">${soonList.length ? 'Uit de folder van volgende week of acties die later beginnen.' : 'Nog geen komende acties gevonden. Zodra de folder van volgende week online staat, pikt de scan hem op.'}</p>${soonList.map(card).join('')}`;
  const rest = none.length ? `<section class="card"><h3>Nu geen actie</h3><div class="none-list">${none.map((p) => `<span class="chip">${esc(p.name)}${searching(p) ? ' · zoeken…' : ''}</span>`).join('')}</div></section>` : '';
  return `<div class="section-head"><div><div class="eyebrow">${esc(dateStr)}</div><h1>In de aanbieding</h1><p class="sub">${esc(status)}</p><p class="hint">Staat je Mac aan? Dan haalt die bij "Nu zoeken" binnen een kwartier ook de folders van AH en Vomar op.</p></div>
      <button class="btn" data-action="scan-all" ${searching() ? 'disabled' : ''}>Nu zoeken</button></div>
    <div class="stack">${H().products.length ? cards : '<div class="empty">Voeg bij Producten toe wat je steeds opnieuw koopt. Skwirl zoekt dan de acties.</div>'}${rest}</div>`;
}

function viewLijstje(): string {
  const a = currentAddr();
  const chain = currentChain();
  const open = (c: string): number => L().filter((l) => onListFor(l, c) && !l.done).length;
  const chains = followedChains().sort((x, y) => Number(open(y) > 0) - Number(open(x) > 0));
  const picker = chains.map((c) => `<button aria-pressed="${c === chain}" data-action="li-chain" data-v="${esc(c)}">${esc(chainName(c))}${open(c) ? `<span class="n">${open(c)}</span>` : ''}</button>`).join('');
  const ns = nearestStore(chain, a);
  const where = ns ? (ns.st.online ? 'Online bestellen' : `${ns.st.place}, ${km(ns.d)}${a ? ` vanaf ${a.name.toLowerCase()}` : ''}`) : '';
  return `<div class="section-head"><div><h1>Boodschappen</h1><p class="sub">Kies je winkel. Zet erop wat op is en tik het eraf als je het hebt.</p></div>${syncLabel()}</div>
    <nav class="shop-pick" aria-label="Winkel">${picker}</nav>
    <section class="card"><div class="section-head" style="margin-bottom:0"><h2>${esc(chainName(chain))}</h2><span class="unit">${esc(where)}</span></div>${listPanel(chain, false)}</section>`;
}

function dealRow(dl: Deal): string {
  const p = linked(dl); const on = L().some((l) => l.dealId === dl.id && !l.done);
  const w = dealWhen(dl);
  const chip = dl.span && SPAN_CHIP[dl.span] ? `<span class="chip warn">${SPAN_CHIP[dl.span]}</span> ` : '';
  const mine = p ? (doubtful(p, dl) ? '<span class="chip warn">Misschien jouw product</span> ' : '<span class="chip ok">Jouw product</span> ') : '';
  return `<div class="supply"><div style="min-width:0"><div class="name">${esc(p?.name ?? dl.title)}</div>
    <div class="meta">${mine}${chip}${dl.shop ? `<strong>${esc(dl.shop)}</strong> · ` : ''}${esc([dl.mech, priceText(dl), dl.normal && dl.price ? `was ${eur(dl.normal)}` : ''].filter(Boolean).join(' · '))}</div>
    <div class="meta when ${w.state}">${esc(w.label)}</div>${dl.note && p ? `<div class="meta match">${esc(dl.note)}</div>` : ''}${p && doubtful(p, dl) ? fbButtons(dl) : ''}</div>
    <button class="btn small" data-action="deal-add" data-id="${esc(dl.id)}" ${on ? 'disabled' : ''}>${on ? 'Op de lijst' : 'Op lijstje'}</button></div>`;
}

/** Folderlinks van een keten: wat de taak vond, anders de vaste actiepagina */
function folderLinks(chain: string): { label: string; url: string }[] {
  const found = (deals!.data.folders ?? []).filter((f: FolderLink) => f.chain === chain)
    .map((f) => ({ f, w: dealWhen({ from: f.from, until: f.until, span: 'week' }) })).filter(({ w }) => w.state !== 'expired')
    .sort((x, y) => x.w.startsIn - y.w.startsIn)
    .map(({ f, w }) => ({ label: w.state === 'soon' ? 'Folder volgende week' : 'Folder deze week', url: f.url }));
  if (found.length) return found;
  return FOLDER_PAGES[chain] ? [{ label: 'Acties bekijken', url: FOLDER_PAGES[chain] }] : [];
}

function viewDeals(): string {
  const a = currentAddr();
  // winkels met acties eerst, online achteraan, verder op afstand
  const hasDeals = (c: string): boolean => liveDeals().some((dl) => dl.chain === c && true);
  const chainKeys = followedChains().concat(liveDeals().some((dl) => dl.chain === 'online') ? ['online'] : []);
  const chains = chainKeys.map((c) => ({ c, ns: nearestStore(c, a) }))
    .sort((x, y) => Number(!hasDeals(x.c)) - Number(!hasDeals(y.c)) || Number(!!x.ns?.st.online) - Number(!!y.ns?.st.online) || (x.ns?.d ?? 99) - (y.ns?.d ?? 99));
  const upd = deals!.data.updatedAt ? new Date(deals!.data.updatedAt).toLocaleDateString('nl-NL', { weekday: 'long', day: 'numeric', month: 'long' }) : null;
  const cards = chains.map(({ c, ns }) => {
    const dls = liveDeals().filter((dl) => dl.chain === c && true)
      .sort((x, y) => dealWhen(x).startsIn - dealWhen(y).startsIn || Number(!product(x.productId)) - Number(!product(y.productId)) || (x.productId && x.productId === y.productId ? compareValue(x, y) : 0));
    const short = dls.filter((dl) => dl.span === 'dag' || dl.span === 'weekend');
    const week = dls.filter((dl) => !short.includes(dl) && dealWhen(dl).state === 'now');
    const next = dls.filter((dl) => !short.includes(dl) && dealWhen(dl).state === 'soon');
    const part = (title: string, list: Deal[]): string => list.length ? `<div class="basket-head">${title}</div>${list.map(dealRow).join('')}` : '';
    const links = folderLinks(c);
    return `<section class="card folder-card">
      <div class="section-head" style="margin-bottom:4px"><div><h2>${esc(chainName(c))}</h2><span class="unit">${ns ? (c === 'online' ? 'Alle webshops' : ns.st.online ? 'Online' : `${esc(ns.st.place)}, ${km(ns.d)}`) : ''}</span></div></div>
      ${links.length ? `<div class="folder-links">${links.map((l) => `<a class="btn small" href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)} ↗</a>`).join('')}</div>` : ''}
      ${part('Dag- en weekendacties', short)}${part('Deze week', week)}${part('Volgende week', next)}
      ${dls.length ? '' : `<p class="sub" style="font-size:13.5px">Nog geen acties opgehaald.</p>`}</section>`;
  }).join('');
  return `<div class="section-head"><div><h1>Folders</h1><p class="sub">${upd ? `Bijgewerkt op ${esc(upd)}. Controleer de prijs in de winkel.` : 'Nog niets opgehaald. De geplande Claude-taak zet hier de acties neer.'}</p></div></div>
    ${cards || '<div class="empty">Voeg bij Plekken de winkels toe waar je komt.</div>'}`;
}

function viewProducten(): string {
  const rows = H().products.slice().sort((x, y) => x.name.localeCompare(y.name)).map((p) => {
    return `<div class="prod-row">${iconFor(p.name)}<div style="min-width:0"><div style="font-weight:700">${esc(p.name)}</div>
      <div class="unit">${esc([p.brand, p.where.length ? anyLabel(p.where) : 'Overal'].filter(Boolean).join(' · '))}</div>
      ${p.wants || p.avoid || p.variants?.length ? `<div class="unit prefs">${p.wants ? `<span>Wel: ${esc(p.wants)}</span>` : ''}${p.variants?.length ? `<span>Ook: ${esc(p.variants.join(', '))}</span>` : ''}${p.avoid ? `<span>Niet: ${esc(p.avoid)}</span>` : ''}</div>` : ''}
      ${p.loose || searching(p) ? `<div class="where-tag">${p.loose ? '<span class="chip">Los, zonder barcode</span>' : ''}${searching(p) ? '<span class="chip soon">Wordt gezocht…</span>' : ''}</div>` : ''}
      ${productDeals(p).slice(0, 2).map(({ dl, w }) => productDealRow(p, dl, w)).join('')}</div>
      <div class="prod-actions">${p.where.includes('online') ? `<button class="btn small ghost" data-action="prod-scan" data-id="${esc(p.id)}" ${searching(p) ? 'disabled' : ''}>Zoek nu online</button>` : ''}<button class="btn small ghost" data-action="prod-edit" data-id="${esc(p.id)}">Bewerken</button></div></div>`;
  }).join('');
  return `<div class="section-head"><div><h1>Vaste producten</h1><p class="sub">Wat je steeds opnieuw koopt. Skwirl zoekt ma, do en za de acties die passen bij wat je wilt. Online producten kun je ook direct laten zoeken.</p></div>
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
  const followed = H().stores.filter((s) => s.follow).sort((x, y) => Number(!!x.online) - Number(!!y.online));
  const row = (st: Store): string => {
    const dists = st.online ? 'Online' : H().addresses.map((a) => { const d = distanceKm(a, st); return `<span class="${d <= a.radius ? 'in' : ''}">${esc(a.name)} ${d < 30 ? km(d) : '—'}</span>`; }).join(' · ');
    return `<div class="st-row"><div style="min-width:0"><strong>${esc(st.name)}</strong> <span class="unit">${esc(st.place)}</span><div class="st-d num">${dists}</div></div>
      <button class="x" data-action="store-del" data-v="${esc(st.id)}" aria-label="${esc(st.name)} ${esc(st.place)} verwijderen" title="Verwijderen">×</button></div>`;
  };
  return `<div class="section-head"><div><h1>Plekken &amp; winkels</h1><p class="sub">Vanaf deze adressen zoekt Skwirl de beste winkel.</p></div><button class="btn" data-action="addr-new">Adres toevoegen</button></div>
    <div class="deal-grid">${addrs || '<div class="empty">Nog geen adressen.</div>'}</div>
    <section class="card" style="margin-top:16px"><div class="section-head"><div><h2>Je winkels</h2><span class="unit">Groen = binnen je straal</span></div><button class="btn small" data-action="store-new">Winkel toevoegen</button></div>
      ${followed.map(row).join('') || '<div class="empty">Nog geen winkels. Voeg de winkels toe waar je komt.</div>'}
</section>
    <section class="card" style="margin-top:16px"><h2>Samen gebruiken</h2>
      <p class="sub">Verbonden met <strong>${esc(cfg!.owner)}/${esc(cfg!.repo)}</strong> als <strong>${esc(cfg!.name)}</strong>.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px"><button class="btn" data-action="share">Telefoon koppelen</button><button class="btn ghost" data-action="disconnect">Ontkoppelen op dit apparaat</button></div>
      <p class="hint">Versie ${esc(APP_VERSION.slice(0, 7))}</p></section>`;
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
    const p = product(sheet.id) ?? { id: '', name: '', where: [], loose: false, normal: null, lastBought: null, note: null } as Product;
    const kinds: Kind[] = ['super', 'bio', 'drogist', 'online', 'slager', 'bouw'];
    return wrap(sheet.id ? p.name : 'Product toevoegen', `<form id="prod-form" class="sheet-form">
      <label>Naam<input name="name" required maxlength="80" value="${esc(p.name)}" placeholder="Bijv. Jonagold appels"></label>
      <label>Merk<input name="brand" maxlength="40" value="${esc(p.brand ?? '')}" placeholder="Leeg = maakt niet uit"></label>
      <label>Wat wil je precies?<input name="wants" maxlength="120" value="${esc(p.wants ?? '')}" placeholder="Bijv. groot stuk, jong belegen · halfvol · voor avondeten"></label>
      <label>Varianten die je soms koopt<input name="variants" maxlength="120" value="${esc((p.variants ?? []).join(', '))}" placeholder="Bijv. biologisch (met komma's)"></label>
      <label>Wat juist niet?<input name="avoid" maxlength="120" value="${esc(p.avoid ?? '')}" placeholder="Bijv. plakken · vleeswaren voor op brood"></label>
      <p class="hint">Hiermee kiest de aanbiedingen-taak alleen acties die echt bij je passen. Elke variant krijgt een eigen tegel bij Boodschappen en wordt apart gezocht.</p>
      <fieldset><legend>Te koop bij</legend><div class="quick">${kinds.map((k) => `<label class="chk-chip"><input type="checkbox" name="where" value="${k}" ${p.where.includes(k) ? 'checked' : ''}> ${esc(KIND_NAME[k])}</label>`).join('')}</div>
        <p class="hint">Niets aangevinkt = maakt niet uit waar.</p></fieldset>
      <label class="chk"><input type="checkbox" name="loose" ${p.loose ? 'checked' : ''}> Los, zonder barcode</label>
      ${sheet.id && ((p.likes ?? []).length || (p.dislikes ?? []).length) ? `<fieldset><legend>Geleerd van jou</legend><div class="learned">
        ${(p.likes ?? []).map((t) => `<span class="chip ok">✓ ${esc(t)} <button type="button" data-action="fb-forget" data-kind="likes" data-v="${esc(t)}" aria-label="Vergeet ${esc(t)}">×</button></span>`).join('')}
        ${(p.dislikes ?? []).map((t) => `<span class="chip danger">✗ ${esc(t)} <button type="button" data-action="fb-forget" data-kind="dislikes" data-v="${esc(t)}" aria-label="Vergeet ${esc(t)}">×</button></span>`).join('')}</div></fieldset>` : ''}
      <div class="sheet-foot">${sheet.id ? '<button type="button" class="btn" data-action="prod-del">Verwijderen</button>' : ''}<button class="btn primary" type="submit">Opslaan</button></div></form>`, sheet.id ? iconFor(p.name) : '');
  }

  if (sheet.type === 'address' || sheet.type === 'store') {
    const isStore = sheet.type === 'store';
    return wrap(isStore ? 'Winkel toevoegen' : 'Adres toevoegen', `<form id="${isStore ? 'store-form' : 'addr-form'}" class="sheet-form">
      ${isStore ? `<label>Keten<select name="chain">${Object.entries({ ...DEFAULT_CHAINS, ...H().chains }).sort((x, y) => x[1].name.localeCompare(y[1].name)).map(([c, v]) => `<option value="${esc(c)}">${esc(v.name)}</option>`).join('')}<option value="__new">Andere winkel…</option></select></label>
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
  ['deals', 'Folders', '<path d="M4 5.5h12.5v13a1.5 1.5 0 0 0 1.5 1.5H5.5A1.5 1.5 0 0 1 4 18.5z"/><path d="M16.5 9H20v9.5a1.5 1.5 0 0 1-3 0M7 9h6.5M7 12.5h6.5M7 16h4"/>'],
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
  // Ekoplaza is een natuurwinkel, geen gewone supermarkt: "elke supermarkt" geldt daar niet
  if (H().chains?.ekoplaza?.kind === 'super') house.mutate((h) => { if (h.chains.ekoplaza) h.chains.ekoplaza.kind = 'bio'; h.stores.filter((s) => s.chain === 'ekoplaza').forEach((s) => { s.type = KIND_NAME.bio; }); }, 'Ekoplaza is een natuurwinkel').catch(() => {});
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
    case 'li-prod': { const p = product(id); if (!p) return; el.classList.add('pop'); addItem({ name: p.name, productId: p.id, spec: el.dataset.spec || null });
      const k = kindOf(currentChain()); if (p.where.length && !p.where.includes(k)) toast(`${p.name} staat op je lijst voor ${anyLabel(p.where).toLowerCase()}`); break; }
    case 'scan-all': { const now = Date.now(); house.mutate((h) => { h.scanAllAt = now; }, 'Zoek alle producten nu').catch(() => {}); toast('Skwirl zoekt nu alle acties. Dat duurt 5 à 10 minuten.'); break; }
    case 'prod-scan': { const p = product(id); if (!p) return; const now = Date.now();
      house.mutate((h) => { const x = h.products.find((q) => q.id === p.id); if (x) x.scanAt = now; }, `Zoek product: ${p.name}`).catch(() => {});
      toast(`Skwirl zoekt online naar acties voor ${p.name}. Dat duurt een paar minuten.`); break; }
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
    case 'prod-new': sheet = { type: 'product', id: null }; render(); break;
    case 'prod-edit': sheet = { type: 'product', id }; render(); break;
    case 'prod-del': if (sheet?.type === 'product' && sheet.id) { const pid = sheet.id; const name = product(pid)?.name; sheet = null;
      house.mutate((h) => { h.products = h.products.filter((p) => p.id !== pid); }, `Product weg: ${name}`).catch(() => {}); } break;
    case 'deal-fb': {
      const dl = D().find((x) => x.id === id); const p = dl && product(dl.productId); if (!dl || !p) return;
      const yes = v === 'yes'; const title = dl.title;
      house.mutate((h) => {
        const x = h.products.find((q) => q.id === p.id); if (!x) return;
        const k = titleKey(title);
        x.likes = (x.likes ?? []).filter((t) => titleKey(t) !== k); x.dislikes = (x.dislikes ?? []).filter((t) => titleKey(t) !== k);
        (yes ? x.likes : x.dislikes).push(title);
        x.likes = x.likes.slice(-30); x.dislikes = x.dislikes.slice(-30);
      }, `Feedback ${p.name}: ${yes ? 'bedoel ik' : 'bedoel ik niet'}`).catch(() => {});
      toast(yes ? `Onthouden: dit bedoel je met ${p.name}` : `Onthouden: dit bedoel je niet met ${p.name}. Skwirl laat het voortaan weg.`);
      break;
    }
    case 'fb-forget': {
      if (sheet?.type !== 'product' || !sheet.id) return; const pid = sheet.id; const kind = el.dataset.kind as 'likes' | 'dislikes';
      house.mutate((h) => { const x = h.products.find((q) => q.id === pid); if (x) x[kind] = (x[kind] ?? []).filter((t) => titleKey(t) !== titleKey(v)); }, 'Feedback vergeten').catch(() => {});
      break;
    }
    case 'deal-add': { const dl = D().find((x) => x.id === id); if (!dl) return; const p = product(dl.productId);
      const online = dl.chain === 'online';
      addItem({ name: p?.name ?? dl.title, productId: p?.id ?? null, dealId: dl.id, chain: online ? null : dl.chain, kinds: online ? ['online'] : null, spec: dl.shop ?? null }, online ? currentChain() : dl.chain);
      toast(`Op je ${online ? 'online' : chainName(dl.chain)}-lijst gezet`); break; }
    case 'addr': ui.addr = v; render(); break;
    case 'addr-new': placeResults = []; sheet = { type: 'address' }; render(); break;
    case 'store-new': placeResults = []; sheet = { type: 'store' }; render(); break;
    case 'store-del': { const st = H().stores.find((x) => x.id === v); if (st && confirm(`${st.name} ${st.place} verwijderen? Je kunt hem later opnieuw toevoegen.`)) house.mutate((h) => { h.stores = h.stores.filter((x) => x.id !== v); }, `Winkel weg: ${st.name} ${st.place}`).catch(() => {}); break; }
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
    const fields = { name: get('name'), brand: get('brand') || null, wants: get('wants') || null, avoid: get('avoid') || null, variants: get('variants').split(',').map((x) => x.trim()).filter(Boolean).slice(0, 6), where: fd.getAll('where').map(String) as Kind[], loose: fd.get('loose') === 'on' };
    if (!fields.name) { toast('Geef het product een naam'); return; }
    const isNew = !sheet.id; sheet = null;
    house.mutate((h) => {
      const p = h.products.find((x) => x.id === pid);
      if (p) Object.assign(p, fields);
      else h.products.push({ id: pid, normal: null, lastBought: null, note: null, bought: [], ...fields });
    }, `${isNew ? 'Nieuw product' : 'Product'}: ${fields.name}`).catch(() => {});
    toast(isNew ? `${fields.name} toegevoegd. Skwirl zoekt nu acties, dat duurt een paar minuten.` : 'Opgeslagen. Skwirl zoekt opnieuw acties.');
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
      const known = chain !== '__new' && !H().chains[chain] && DEFAULT_CHAINS[chain] ? { id: chain, ...DEFAULT_CHAINS[chain] } : null;
      const newChain = chain === '__new' ? { id: newName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || uid('c'), name: newName || 'Winkel', kind: get('newKind') as Kind } : known;
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
const hashTab = (location.hash.slice(1) === 'folders' ? 'deals' : location.hash.slice(1)) as Tab;
if (hashTab in VIEWS) ui.tab = hashTab;
if (fromLink) { setupPrefill = { ...fromLink, name: '' }; showSetup(); }
else if (cfg) void connect();
else showSetup();

document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void pullAll(); });
window.addEventListener('online', () => { void pullAll(); });
// Nieuwe versie van de app: de service worker neemt het over en de pagina laadt zichzelf opnieuw
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('sw.js').catch(() => {});
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController) location.reload(); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') navigator.serviceWorker.getRegistration().then((r) => r?.update()).catch(() => {});
  });
}
