/** Derive scale-authored district/regional masters from the keyed 3x2 atlas. */
import { deriveKeyedMaterialAtlas } from './keyed-material-atlas.mjs';

const SOURCE = process.env.MALDOROR_OVERVIEW_MATERIAL_SOURCE ??
  'assets/biomes/generated/regional-overview-materials-atlas-v1-source.png';
const OUTPUT = process.env.MALDOROR_OVERVIEW_MATERIAL_OUTPUT ??
  'assets/biomes/overview-materials';
const OUTPUT_SIZE = Number.parseInt(
  process.env.MALDOROR_OVERVIEW_MATERIAL_SIZE ?? '512',
  10,
);
const NAMES = [
  'canal-town-overview',
  'forest-overview',
  'coast-overview',
  'rural-overview',
  'mountain-overview',
  'ruins-overview',
];

console.log(JSON.stringify(await deriveKeyedMaterialAtlas({
  source: SOURCE,
  output: OUTPUT,
  outputSize: OUTPUT_SIZE,
  names: NAMES,
  expectedColumns: 3,
  expectedRows: 2,
}), null, 2));
