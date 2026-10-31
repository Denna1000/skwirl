export const esc = (s: unknown): string => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
export const uid = (p = ''): string => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
export const eur = (n: number): string => n.toLocaleString('nl-NL', { style: 'currency', currency: 'EUR' });
export const km = (n: number): string => n.toLocaleString('nl-NL', { maximumFractionDigits: 1, minimumFractionDigits: 1 }) + ' km';
export const DAY = 864e5;
