// Bouwt de app naar dist/: TypeScript compileren en de vaste bestanden kopiëren. Geen bundler nodig.
import { cpSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

rmSync('dist', { recursive: true, force: true });
execFileSync(process.platform === 'win32' ? 'node_modules/.bin/tsc.cmd' : 'node_modules/.bin/tsc', ['-p', '.'], { stdio: 'inherit' });
cpSync('public', 'dist', { recursive: true });

// Versie in de service worker zetten, zodat telefoons een nieuwe versie oppakken
const files = ['index.html', 'style.css', 'js/app.js', 'js/deals.js', 'js/rhythm.js', 'js/unit.js', 'js/github.js', 'js/art.js', 'js/geo.js', 'js/parse.js', 'js/util.js'];
const hash = createHash('sha256');
for (const f of files) hash.update(readFileSync(`dist/${f}`));
const sw = readFileSync('dist/sw.js', 'utf8').replace('__VERSION__', hash.digest('hex').slice(0, 10));
writeFileSync('dist/sw.js', sw);
console.log('Klaar: dist/');
