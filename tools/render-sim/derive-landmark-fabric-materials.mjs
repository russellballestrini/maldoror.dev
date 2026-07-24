import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = path.resolve(import.meta.dirname, '../..');
const SOURCE = path.join(
  ROOT,
  'assets/biomes/generated/canal-town-limestone-plaza-v2-terminal-source.png',
);
const OUTPUT = path.join(
  ROOT,
  'assets/biomes/settlement-materials/canal-town-limestone-plaza-master-v2-terminal.png',
);
const SOURCE_SHA256 = 'c50c7f7ba02b4084b30b2911f3e380f4436b5eb8084a10c80c1f027dd5fec595';
const OUTPUT_SHA256 = '9d4454cf0efa5f53010eb1de2596ee11961507c1771771a159d2fe717a2ffbae';

if (sha256File(SOURCE) !== SOURCE_SHA256) {
  throw new Error('Canal-town limestone plaza source hash changed');
}
const sourceMetadata = await sharp(SOURCE).metadata();
if (sourceMetadata.width !== 1254 || sourceMetadata.height !== 1254) {
  throw new Error(`Unexpected limestone plaza source dimensions: ${JSON.stringify(sourceMetadata)}`);
}
const temporary = `${OUTPUT}.tmp.png`;
try {
  await sharp(SOURCE)
    .resize(192, 192, { fit: 'cover', kernel: 'lanczos3' })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toFile(temporary);
  const outputHash = sha256File(temporary);
  if (outputHash !== OUTPUT_SHA256) {
    throw new Error(`Derived limestone plaza hash changed: ${outputHash}`);
  }
  fs.renameSync(temporary, OUTPUT);
} finally {
  if (fs.existsSync(temporary)) fs.rmSync(temporary);
}

console.log(JSON.stringify({
  generation: 'built-in Codex/ChatGPT image generation subscription; no metered API',
  source: path.relative(ROOT, SOURCE),
  sourceSha256: SOURCE_SHA256,
  output: path.relative(ROOT, OUTPUT),
  outputSha256: OUTPUT_SHA256,
  dimensions: [192, 192],
}, null, 2));

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}
