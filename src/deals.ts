// Geldigheid van acties: komt eraan, loopt nu, of is voorbij. Datums zijn 'YYYY-MM-DD' (lokale tijd, t/m = hele dag).
import type { Deal } from './types.js';

export type DealState = 'soon' | 'now' | 'expired';
export interface DealWhen { state: DealState; /** dagen tot de actie begint (0 = vandaag) */ startsIn: number; label: string; short: string }

const DAY = 864e5;
const ISO = /^\d{4}-\d{2}-\d{2}$/;

function day(s: string): Date { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
function startOfDay(t: Date): Date { return new Date(t.getFullYear(), t.getMonth(), t.getDate()); }
const fmt = (d: Date): string => d.toLocaleDateString('nl-NL', { weekday: 'short', day: 'numeric', month: 'short' }).replace('.', '');
const wd = (d: Date): string => d.toLocaleDateString('nl-NL', { weekday: 'short' }).replace('.', '');

export function dealWhen(dl: Pick<Deal, 'from' | 'until' | 'span'>, now = new Date()): DealWhen {
  const today = startOfDay(now);
  const from = dl.from && ISO.test(dl.from) ? day(dl.from) : null;
  const until = dl.until && ISO.test(dl.until) ? day(dl.until) : null;
  const startsIn = from ? Math.round((from.getTime() - today.getTime()) / DAY) : 0;
  const state: DealState = until && until < today ? 'expired' : startsIn > 0 ? 'soon' : 'now';
  const kind = dl.span === 'dag' ? 'Dagactie' : dl.span === 'weekend' ? 'Weekendactie' : '';

  let label: string, short: string;
  if (dl.until && !until) { // vrije tekst uit een oudere versie
    label = `t/m ${dl.until}`; short = label;
  } else if (state === 'soon') {
    const range = from && until && until.getTime() !== from.getTime() ? `${fmt(from)} t/m ${fmt(until)}` : fmt(from!);
    label = `${kind ? kind + ' ' : 'Vanaf '}${range}`; short = `vanaf ${startsIn === 1 ? 'morgen' : wd(from!)}`;
  } else if (until && until.getTime() === today.getTime()) {
    label = kind === 'Dagactie' || (from && from.getTime() === until.getTime()) ? 'Alleen vandaag' : `${kind ? kind + ', l' : 'L'}aatste dag vandaag`; short = 'alleen vandaag';
  } else if (until) {
    label = `${kind ? kind + ', n' : 'N'}og t/m ${fmt(until)}`; short = `t/m ${wd(until)}`;
  } else {
    label = kind || 'Nu'; short = '';
  }
  return { state, startsIn, label, short };
}
