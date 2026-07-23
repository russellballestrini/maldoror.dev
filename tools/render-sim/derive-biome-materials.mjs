/** Derive square material masters from the subscription-generated 3x2 atlas.
 *
 * Detection uses the atlas's explicit magenta gutters rather than hard-coded
 * crop coordinates. The source generation is never modified.
 */
import { deriveKeyedMaterialAtlas } from './keyed-material-atlas.mjs';

const SOURCE = process.env.MALDOROR_BIOME_ATLAS_SOURCE ??
  'assets/biomes/generated/regional-materials-atlas-v1-source.png';
const OUTPUT = process.env.MALDOROR_BIOME_MATERIAL_OUTPUT ?? 'assets/biomes/materials';
const OUTPUT_SIZE = Number.parseInt(process.env.MALDOROR_BIOME_MATERIAL_SIZE ?? '512', 10);
const NAMES = [
  'canal-town-paving',
  'forest-floor',
  'coast-marsh',
  'rural-orchard',
  'mountain-highland',
  'ancient-ruins',
];

console.log(JSON.stringify(await deriveKeyedMaterialAtlas({
  source: SOURCE,
  output: OUTPUT,
  outputSize: OUTPUT_SIZE,
  names: NAMES,
  expectedColumns: 3,
  expectedRows: 2,
}), null, 2));
