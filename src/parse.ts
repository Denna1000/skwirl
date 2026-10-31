// Vrije invoer omzetten naar product, eigenschap en aantal:
// "chiazaad, bio" · "melk 500 ml" · "2 kg jonagold" · "3x yoghurt" · "bio eieren"

const UNIT = '(\\d+(?:[.,]\\d+)?)\\s*(kg|kilo|g|gr|gram|l|liter|ml|cl|pond|ons|stuks?)';

export interface Entry { name: string; spec: string | null; qty: number }

export function parseEntry(text: string): Entry {
  const [head, ...rest] = text.split(',');
  const specs = rest.map((x) => x.trim()).filter(Boolean);
  let name = head.trim().replace(/\s+/g, ' ');
  let qty = 1;
  let m: RegExpMatchArray | null;
  if ((m = name.match(new RegExp('^' + UNIT + '\\s+(.+)$', 'i')))) { specs.unshift(`${m[1]} ${m[2].toLowerCase()}`); name = m[3]; }
  else if ((m = name.match(new RegExp('^(.+?)\\s+' + UNIT + '$', 'i')))) { specs.unshift(`${m[2]} ${m[3].toLowerCase()}`); name = m[1]; }
  else if ((m = name.match(/^(\d{1,2})\s*[x×]?\s+(.+)$/i))) { qty = Number(m[1]); name = m[2]; }
  if (/\bbio(logisch)?\b/i.test(name)) { name = name.replace(/\bbio(logisch)?\b/i, '').trim(); specs.unshift('bio'); }
  name = (name || text.trim()).slice(0, 80);
  return { name: name.charAt(0).toUpperCase() + name.slice(1), spec: specs.join(' · ') || null, qty };
}
