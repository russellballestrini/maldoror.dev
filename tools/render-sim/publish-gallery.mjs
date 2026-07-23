/**
 * Publish the current render-sim screenshots as a new gallery iteration.
 *
 * Copies tools/render-sim/out/*.png into gallery/<NNN>-<slug>/ together with
 * a notes.md, then regenerates gallery/index.html (newest first).
 * The gallery dir is served at https://maldoror.dev/gallery via Caddy.
 *
 * Usage: node tools/render-sim/publish-gallery.mjs <slug> "<notes markdown>"
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, 'out');
const GALLERY = path.join(__dirname, 'gallery');

const slug = (process.argv[2] || 'iteration').replace(/[^a-z0-9-]/gi, '-').toLowerCase();
const notes = process.argv[3] || '';

fs.mkdirSync(GALLERY, { recursive: true });

// Next iteration number
const existing = fs.readdirSync(GALLERY).filter(d => /^\d{3}-/.test(d)).sort();
const next = existing.length ? parseInt(existing[existing.length - 1].slice(0, 3), 10) + 1 : 0;
const dirname = `${String(next).padStart(3, '0')}-${slug}`;
const dest = path.join(GALLERY, dirname);
fs.mkdirSync(dest, { recursive: true });

// Copy screenshots
const shots = fs.existsSync(OUT) ? fs.readdirSync(OUT).filter(f => f.endsWith('.png')) : [];
for (const f of shots) fs.copyFileSync(path.join(OUT, f), path.join(dest, f));
fs.writeFileSync(path.join(dest, 'notes.md'), `# ${dirname}\n\n${new Date().toISOString()}\n\n${notes}\n`);
console.log(`published ${dest} (${shots.length} images)`);

// Regenerate index.html
const iters = fs.readdirSync(GALLERY).filter(d => /^\d{3}-/.test(d)).sort().reverse();
const sections = iters.map(d => {
  const files = fs.readdirSync(path.join(GALLERY, d)).filter(f => f.endsWith('.png')).sort();
  let noteHtml = '';
  const notesFile = path.join(GALLERY, d, 'notes.md');
  if (fs.existsSync(notesFile)) {
    const raw = fs.readFileSync(notesFile, 'utf8')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;');
    noteHtml = `<pre class="notes">${raw}</pre>`;
  }
  const imgs = files.map(f =>
    `<figure><a href="/gallery/${d}/${f}"><img loading="lazy" src="/gallery/${d}/${f}" alt="${f}"></a><figcaption>${f}</figcaption></figure>`
  ).join('\n');
  return `<section><h2>${d}</h2>${noteHtml}<div class="grid">${imgs}</div></section>`;
}).join('\n');

fs.writeFileSync(path.join(GALLERY, 'index.html'), `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>maldoror — render gallery</title>
<style>
  :root { color-scheme: dark; }
  body { background:#0d0d12; color:#cfcfe0; font-family:ui-monospace,monospace; margin:2rem auto; max-width:1200px; padding:0 1rem; }
  h1 { color:#c864ff; letter-spacing:.1em; }
  h2 { color:#e0a0ff; border-bottom:1px solid #333; padding-bottom:.3rem; margin-top:3rem; }
  .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(340px,1fr)); gap:1rem; }
  figure { margin:0; background:#16161f; border:1px solid #2a2a3a; border-radius:6px; padding:.5rem; }
  img { width:100%; height:auto; image-rendering:pixelated; display:block; }
  figcaption { font-size:.75rem; color:#8888a0; padding-top:.4rem; }
  .notes { background:#14141c; border-left:3px solid #c864ff; padding:.8rem; white-space:pre-wrap; font-size:.85rem; color:#a8a8c0; }
</style>
<h1>MALDOROR — render engine gallery</h1>
<p>Ongoing visual iterations of the terminal render engine. Each section is one iteration of the
headless simulator (<code>tools/render-sim</code>) — the same pipeline the SSH game renders with.</p>
${sections}
`);
console.log(`index.html regenerated (${iters.length} iterations)`);
