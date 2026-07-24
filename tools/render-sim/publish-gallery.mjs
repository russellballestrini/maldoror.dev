/**
 * Publish the current render-sim screenshots as a new gallery iteration.
 *
 * Copies tools/render-sim/out/*.png into gallery/<NNN>-<slug>/ together with
 * a notes.md, then regenerates gallery/index.html (newest first).
 * The gallery dir is served at https://maldoror.dev/gallery via Caddy.
 *
 * Usage: node tools/render-sim/publish-gallery.mjs <slug> "<notes markdown>"
 *   [--files=one.png,two.png] [--comparison=one.png]
 *   [--comparison-label="LIVE ANSI · 160×46 · v1234567"]
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, 'out');
const GALLERY = path.join(__dirname, 'gallery');

const slug = (process.argv[2] || 'iteration').replace(/[^a-z0-9-]/gi, '-').toLowerCase();
const notes = process.argv[3] || '';
const filesOption = process.argv.slice(4).find((arg) => arg.startsWith('--files='));
const comparisonOption = process.argv.slice(4).find((arg) => arg.startsWith('--comparison='));
const comparisonLabelOption = process.argv.slice(4).find((arg) => arg.startsWith('--comparison-label='));

fs.mkdirSync(GALLERY, { recursive: true });

// Next iteration number
const existing = fs.readdirSync(GALLERY).filter(d => /^\d{3}-/.test(d)).sort();
const next = existing.length ? parseInt(existing[existing.length - 1].slice(0, 3), 10) + 1 : 0;
const dirname = `${String(next).padStart(3, '0')}-${slug}`;
const dest = path.join(GALLERY, dirname);
fs.mkdirSync(dest, { recursive: true });

// Copy screenshots
const requested = filesOption
  ? filesOption.slice('--files='.length).split(',').map((file) => path.basename(file.trim())).filter(Boolean)
  : null;
const shots = requested ?? (fs.existsSync(OUT) ? fs.readdirSync(OUT).filter(f => f.endsWith('.png')) : []);
for (const shot of shots) {
  if (!shot.endsWith('.png') || !fs.existsSync(path.join(OUT, shot))) {
    throw new Error(`gallery input does not exist in ${OUT}: ${shot}`);
  }
}
for (const f of shots) fs.copyFileSync(path.join(OUT, f), path.join(dest, f));
fs.writeFileSync(path.join(dest, 'notes.md'), `# ${dirname}\n\n${new Date().toISOString()}\n\n${notes}\n`);
console.log(`published ${dest} (${shots.length} images)`);

if (comparisonOption) {
  const currentFile = path.basename(comparisonOption.slice('--comparison='.length));
  const currentPath = path.join(OUT, currentFile);
  const targetPath = path.join(GALLERY, 'TARGET.png');
  if (!fs.existsSync(currentPath)) throw new Error(`comparison input does not exist in ${OUT}: ${currentFile}`);
  if (!fs.existsSync(targetPath)) throw new Error(`comparison target does not exist: ${targetPath}`);

  const panelWidth = 720;
  const panelHeight = 416;
  const labelHeight = 40;
  const target = await sharp(targetPath)
    .resize(panelWidth, panelHeight, { fit: 'cover', position: 'centre' })
    .png()
    .toBuffer();
  const current = await sharp(currentPath)
    .resize(panelWidth, panelHeight, { fit: 'cover', position: 'centre' })
    .png()
    .toBuffer();
  const currentLabel = comparisonLabelOption
    ? comparisonLabelOption.slice('--comparison-label='.length)
    : 'LIVE ANSI';
  const escapeXml = (value) => value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
  const labels = Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="${panelWidth * 2}" height="${labelHeight}">
      <rect width="100%" height="100%" fill="#0d0d12"/>
      <text x="${panelWidth / 2}" y="29" fill="#f3eee7" text-anchor="middle" font-family="DejaVu Sans Mono, monospace" font-size="25">TARGET</text>
      <text x="${panelWidth + panelWidth / 2}" y="29" fill="#f3eee7" text-anchor="middle" font-family="DejaVu Sans Mono, monospace" font-size="25">${escapeXml(currentLabel)}</text>
    </svg>
  `);
  await sharp({
    create: {
      width: panelWidth * 2,
      height: panelHeight + labelHeight,
      channels: 3,
      background: '#0d0d12',
    },
  }).composite([
    { input: labels, left: 0, top: 0 },
    { input: target, left: 0, top: labelHeight },
    { input: current, left: panelWidth, top: labelHeight },
  ]).png().toFile(path.join(GALLERY, 'COMPARISON.png'));
  console.log(`comparison updated from ${currentFile}`);
}

// Regenerate index.html
const iters = fs.readdirSync(GALLERY).filter(d => /^\d{3}-/.test(d)).sort().reverse();
const sections = iters.map(d => {
  const files = fs.readdirSync(path.join(GALLERY, d)).filter(f => f.endsWith('.png')).sort();
  let noteHtml = '';
  const notesFile = path.join(GALLERY, d, 'notes.md');
  if (fs.existsSync(notesFile)) {
    const raw = fs.readFileSync(notesFile, 'utf8')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    noteHtml = `<pre class="notes">${raw}</pre>`;
  }
  const imgs = files.map(f =>
    `<figure><a href="/gallery/${d}/${f}"><img loading="lazy" src="/gallery/${d}/${f}" alt="${f}"></a><figcaption>${f}</figcaption></figure>`
  ).join('\n');
  return `<section><h2>${d}</h2>${noteHtml}<div class="grid">${imgs}</div></section>`;
}).join('\n');

fs.writeFileSync(path.join(GALLERY, 'index.html'), `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>maldoror — render gallery</title>
<style>
  :root {
    color-scheme: dark;
    --canvas:#0d0d12;
    --surface:#15151d;
    --surface-raised:#191923;
    --line:#333346;
    --ink:#ececf7;
    --muted:#aaaabe;
    --quiet:#8d8da3;
    --violet:#c864ff;
    --violet-soft:#e0a0ff;
  }
  * { box-sizing:border-box; }
  body {
    background:var(--canvas);
    color:var(--ink);
    font-family:"DejaVu Sans Mono",ui-monospace,monospace;
    margin:0 auto;
    max-width:1440px;
    padding:clamp(1.25rem,3vw,3rem) clamp(1rem,3vw,2.5rem) 8rem;
  }
  header { padding:clamp(1rem,4vw,4.5rem) 0 clamp(2.5rem,6vw,6rem); }
  h1 {
    color:var(--violet);
    font-size:clamp(2rem,5vw,4.75rem);
    letter-spacing:-.03em;
    line-height:.96;
    margin:0 0 1.5rem;
    text-wrap:balance;
  }
  header p { color:var(--muted); line-height:1.65; margin:0; max-width:72ch; text-wrap:pretty; }
  section { margin-top:clamp(3.5rem,8vw,8rem); }
  h2 {
    border-bottom:1px solid var(--line);
    color:var(--violet-soft);
    font-size:clamp(1.15rem,2vw,1.7rem);
    letter-spacing:-.02em;
    margin:0 0 1.5rem;
    padding-bottom:.75rem;
    text-wrap:balance;
  }
  .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(min(100%,420px),1fr)); gap:clamp(1rem,2vw,1.75rem); }
  figure { background:var(--surface); border:1px solid var(--line); border-radius:6px; margin:0; overflow:hidden; }
  figure a { background:#08080b; display:block; overflow:hidden; }
  img {
    display:block;
    height:auto;
    image-rendering:pixelated;
    transition:filter 180ms ease-out,transform 180ms ease-out;
    width:100%;
  }
  figure a:hover img { filter:brightness(1.08); transform:scale(1.008); }
  figcaption { color:var(--quiet); font-size:.76rem; line-height:1.45; padding:.7rem .8rem .8rem; overflow-wrap:anywhere; }
  .notes {
    background:var(--surface-raised);
    border:1px solid var(--line);
    border-radius:5px;
    color:var(--muted);
    font-family:inherit;
    font-size:clamp(.78rem,1.1vw,.88rem);
    line-height:1.6;
    margin:0 0 1.5rem;
    max-width:78ch;
    padding:clamp(.9rem,2vw,1.35rem);
    white-space:pre-wrap;
  }
  code { color:var(--violet-soft); }
  @media (prefers-reduced-motion:reduce) { img { transition:none; } figure a:hover img { transform:none; } }
</style>
</head>
<body>
<header>
<h1>MALDOROR<br>render evidence</h1>
<p>Faithful visual iterations from the terminal world renderer. Every frame below comes through the same provider and pixel pipeline used by the SSH experience; rejected experiments stay visible beside selected checkpoints.</p>
</header>
<section><h2>🎯 TARGET vs NOW</h2>
<div class="grid"><figure style="grid-column:1/-1"><a href="/gallery/COMPARISON.png"><img loading="lazy" src="/gallery/COMPARISON.png" alt="target vs now"></a>
<figcaption>Goal tracking: TARGET mockup vs the faithfully replayed live 160×46 SSH world.</figcaption></figure></div></section>
<section><h2>🎯 TARGET (mockup)</h2>
<div class="grid"><figure><a href="/gallery/TARGET.png"><img loading="lazy" src="/gallery/TARGET.png" alt="target mockup"></a>
<figcaption>The goal: a dense, warm, painterly canal-town rendered as pure ANSI in Ghostty.</figcaption></figure></div></section>
${sections}
</body>
</html>`);
console.log(`index.html regenerated (${iters.length} iterations)`);
