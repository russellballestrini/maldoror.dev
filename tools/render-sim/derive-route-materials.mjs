import { deriveKeyedMaterialAtlas } from './keyed-material-atlas.mjs';

const source = process.env.MALDOROR_ROUTE_ATLAS_SOURCE ??
  'assets/routes/generated/regional-route-materials-atlas-v1-source.png';
const output = process.env.MALDOROR_ROUTE_MATERIAL_OUTPUT ?? 'assets/routes/materials';
const outputSize = Number.parseInt(process.env.MALDOROR_ROUTE_MATERIAL_SIZE ?? '512', 10);

console.log(JSON.stringify(await deriveKeyedMaterialAtlas({
  source,
  output,
  outputSize,
  names: ['arterial-stone', 'local-earth', 'trail-floor', 'bridge-timber'],
  expectedColumns: 2,
  expectedRows: 2,
}), null, 2));
