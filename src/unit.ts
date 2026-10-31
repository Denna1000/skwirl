// Prijs per kilo of liter, zodat een stuk van 500 g en een stuk van 1 kg eerlijk te vergelijken zijn.
import type { Deal } from './types.js';

export type Unit = 'kg' | 'l';
export interface Amount { amount: number; unit: Unit }

const FACTOR: Record<string, [number, Unit]> = {
  kg: [1, 'kg'], kilo: [1, 'kg'], g: [0.001, 'kg'], gr: [0.001, 'kg'], gram: [0.001, 'kg'],
  l: [1, 'l'], liter: [1, 'l'], ltr: [1, 'l'], cl: [0.01, 'l'], ml: [0.001, 'l'],
};
const NUM = '(\\d+(?:[.,]\\d+)?)';
const U = '(kg|kilo|gram|gr|g|liter|ltr|l|cl|ml)\\b';
const num = (s: string): number => parseFloat(s.replace(',', '.'));

/** Inhoud uit een omschrijving: "Beemster stuk 500 g", "Coca-Cola 2 x 1,5 L", "6 × 1 liter" */
export function amountOf(text: string): Amount | null {
  const t = text.toLowerCase();
  const multi = t.match(new RegExp(`(\\d+)\\s*[x×]\\s*${NUM}\\s*${U}`));
  if (multi) { const [f, u] = FACTOR[multi[3]]; return { amount: +(Number(multi[1]) * num(multi[2]) * f).toFixed(4), unit: u }; }
  const single = t.match(new RegExp(`${NUM}\\s*${U}`));
  if (single) { const [f, u] = FACTOR[single[2]]; return { amount: +(num(single[1]) * f).toFixed(4), unit: u }; }
  return null;
}

/** Prijs per kilo of liter. Gebruikt de effectieve prijs (na "2e halve prijs" e.d.) als die bekend is. */
export function unitPrice(dl: Pick<Deal, 'price' | 'title'> & { amount?: number | null; unit?: Unit | null; effPrice?: number | null }): { value: number; unit: Unit } | null {
  const price = dl.effPrice ?? dl.price;
  if (price === null || price === undefined) return null;
  const a = dl.amount && dl.unit ? { amount: dl.amount, unit: dl.unit } : amountOf(dl.title);
  if (!a || a.amount <= 0) return null;
  return { value: price / a.amount, unit: a.unit };
}

export const unitLabel = (u: { value: number; unit: Unit }): string =>
  `${u.value.toLocaleString('nl-NL', { style: 'currency', currency: 'EUR' })} per ${u.unit === 'kg' ? 'kilo' : 'liter'}`;
