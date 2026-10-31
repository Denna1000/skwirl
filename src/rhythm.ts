// Koopritme leren uit aankoopmomenten: de mediaan van de tijd tussen aankopen.

const DAY = 864e5;
/** Twee keer "gekocht" binnen 12 uur telt als één aankoop (bijv. twee keer afgetikt) */
const SAME_TRIP = 12 * 36e5;
const KEEP = 12;

export function addPurchase(bought: number[] | undefined, at: number): number[] {
  const list = (bought ?? []).slice();
  if (list.length && at - list[list.length - 1] < SAME_TRIP) list[list.length - 1] = at;
  else list.push(at);
  return list.slice(-KEEP);
}

/** Geleerd aantal dagen tussen aankopen, of null bij minder dan twee aankopen */
export function learnedInterval(bought: number[] | undefined): number | null {
  if (!bought || bought.length < 2) return null;
  const gaps = bought.slice(1).map((t, i) => (t - bought[i]) / DAY).filter((g) => g >= 0.5).sort((a, b) => a - b);
  if (!gaps.length) return null;
  const mid = gaps.length / 2;
  const median = gaps.length % 2 ? gaps[Math.floor(mid)] : (gaps[mid - 1] + gaps[mid]) / 2;
  return Math.max(1, Math.round(median));
}
