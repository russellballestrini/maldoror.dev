#!/usr/bin/env node
/** Compose faithful acceptance captures into reviewable, non-cherry-picked sheets. */
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const RUN_DIR = path.resolve(requiredArgument('--run-dir'));
const progress = readJson(path.join(RUN_DIR, 'atlas-progress.json'));
const atlas = readJson(path.join(RUN_DIR, 'runtime-config.json')).atlasPath;
const spec = readJson(atlas);
const outputDirectory = path.join(RUN_DIR, 'contact-sheets');
fs.mkdirSync(outputDirectory, { recursive: true });

const records = Object.values(progress.captures);
const sheets = [];
for (const environment of spec.environments) {
  for (const zoom of spec.zooms) {
    for (const viewport of spec.viewports) {
      const group = records
        .filter((record) => (
          record.environment === environment.id
          && record.zoom === zoom.id
          && record.viewport === viewport.id
        ))
        .sort((a, b) => siteIndex(a.siteId) - siteIndex(b.siteId));
      if (group.length === 0) continue;
      const output = path.join(
        outputDirectory,
        `${environment.id}--${zoom.id}--${viewport.id}.png`,
      );
      await composeSheet(group, output, 3);
      sheets.push({
        environment: environment.id,
        zoom: zoom.id,
        viewport: viewport.id,
        frames: group.length,
        complete: group.length === spec.sites.filter((site) => site.environment === environment.id).length,
        output,
      });
      console.log(JSON.stringify({ event: 'acceptance_sheet_written', ...sheets.at(-1) }));
    }
  }
}

const walkingReference = records
  .filter((record) => record.zoom === 'walking' && record.viewport === 'ghostty-reference')
  .sort((a, b) => siteIndex(a.siteId) - siteIndex(b.siteId));
if (walkingReference.length > 0) {
  const output = path.join(outputDirectory, 'walking-reference-all-environments.png');
  await composeSheet(walkingReference, output, 4);
  sheets.push({
    environment: 'all',
    zoom: 'walking',
    viewport: 'ghostty-reference',
    frames: walkingReference.length,
    complete: walkingReference.length === spec.sites.length,
    output,
  });
}

const report = {
  schemaVersion: 1,
  atlasVersion: spec.atlasVersion,
  capturedFrames: records.length,
  expectedFrames: spec.sites.length * spec.zooms.length * spec.viewports.length,
  sheets,
  generatedAt: new Date().toISOString(),
};
fs.writeFileSync(path.join(outputDirectory, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ event: 'acceptance_sheets_complete', ...report }, null, 2));

async function composeSheet(group, output, columns) {
  const imageWidth = 480;
  const imageHeight = 276;
  const labelHeight = 36;
  const rows = Math.ceil(group.length / columns);
  const composites = [];
  for (let index = 0; index < group.length; index++) {
    const record = group[index];
    const left = (index % columns) * imageWidth;
    const top = Math.floor(index / columns) * (imageHeight + labelHeight);
    const image = await sharp(record.imagePath)
      .resize(imageWidth, imageHeight, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
      .png()
      .toBuffer();
    composites.push({ input: image, left, top: top + labelHeight });
    composites.push({
      input: labelSvg(imageWidth, labelHeight, `${record.siteId} · ${record.environment} · ${record.zoom} · ${record.viewport}`),
      left,
      top,
    });
  }
  await sharp({
    create: {
      width: columns * imageWidth,
      height: rows * (imageHeight + labelHeight),
      channels: 3,
      background: '#11101a',
    },
  }).composite(composites).png().toFile(output);
}

function labelSvg(width, height, label) {
  const escaped = label
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
  return Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <rect width="100%" height="100%" fill="#171521"/>
      <text x="12" y="23" fill="#ded8ec" font-family="DejaVu Sans, sans-serif" font-size="13">${escaped}</text>
    </svg>
  `);
}

function siteIndex(siteId) {
  const index = spec.sites.findIndex((site) => site.id === siteId);
  return index < 0 ? Number.MAX_SAFE_INTEGER : index;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function requiredArgument(name) {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value) throw new Error(`${name} is required`);
  return value;
}
