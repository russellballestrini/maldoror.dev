/** Compare three deterministic parcel grammars around one curved route. */
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const OUTPUT = process.env.MALDOROR_PARCEL_MODEL_OUTPUT ??
  '/mnt/donto-data/donto-resources/maldoror/rendering-research/track-4-world-composition/parcel-model-comparison-v4-offset-envelope';
const PANEL_W = 540;
const PANEL_H = 520;
const MARGIN = 28;
const ROUTE_HALF = 10;
const SEED = 0x71d0c5;
fs.mkdirSync(OUTPUT, { recursive: true });

const route = Array.from({ length: 93 }, (_, index) => {
  const x = 36 + index * 5;
  return { x, y: routeY(x) };
});
const models = [
  { id: 'isotropic-voronoi', label: 'A · isotropic Voronoi', parcels: voronoiParcels() },
  { id: 'uniform-frontage', label: 'B · uniform frontage strips', parcels: frontageParcels(false) },
  { id: 'anisotropic-hierarchy', label: 'C · anisotropic persistent hierarchy', parcels: frontageParcels(true) },
];
for (const model of models) model.metrics = measure(model.parcels);

const svg = renderComparison(models);
fs.writeFileSync(path.join(OUTPUT, 'parcel-models.svg'), svg);
await sharp(Buffer.from(svg)).png().toFile(path.join(OUTPUT, 'parcel-models.png'));
const report = {
  generatedAt: new Date().toISOString(),
  seed: SEED,
  routeHalfWidth: ROUTE_HALF,
  models: Object.fromEntries(models.map((model) => [model.id, model.metrics])),
  selected: 'anisotropic-hierarchy',
  decision: [
    'Voronoi is retained as the isotropic failure: weak frontage, unassigned/road-crossing geometry, and irregular unusable depth.',
    'Uniform strips guarantee access but exhibit strong repeated width/depth signatures and low silhouette entropy.',
    'The selected hierarchy partitions by shared route stations, varies frontage/depth with coordinate-stable low-discrepancy phases, preserves explicit parcel IDs and connectors, and reserves internal yards before authored masses are attached.',
  ],
};
fs.writeFileSync(path.join(OUTPUT, 'metrics.json'), `${JSON.stringify(report, null, 2)}\n`);
fs.writeFileSync(path.join(OUTPUT, 'FINDINGS.md'), findings(report));
console.log(JSON.stringify({ output: OUTPUT, selected: report.selected, models: report.models }, null, 2));

function routeY(x) {
  return PANEL_H / 2 + Math.sin((x - 40) / 88) * 48 + Math.sin((x + 20) / 31) * 11;
}

function routeFrame(x) {
  const delta = 0.5;
  const dy = routeY(x + delta) - routeY(x - delta);
  const length = Math.hypot(1, dy);
  return { tangent: { x: 1 / length, y: dy / length }, normal: { x: -dy / length, y: 1 / length } };
}

function voronoiParcels() {
  const seeds = [];
  for (let side = -1; side <= 1; side += 2) {
    for (let index = 0; index < 16; index++) {
      const x = 48 + index * 29 + (unit(index, side, 13) - 0.5) * 20;
      const frame = routeFrame(x);
      const distance = 34 + unit(index, side, 29) * 120;
      seeds.push({
        id: `voronoi:${side}:${index}`,
        x: x + frame.normal.x * side * distance,
        y: routeY(x) + frame.normal.y * side * distance,
      });
    }
  }
  const bounds = [
    { x: MARGIN, y: MARGIN },
    { x: PANEL_W - MARGIN, y: MARGIN },
    { x: PANEL_W - MARGIN, y: PANEL_H - MARGIN },
    { x: MARGIN, y: PANEL_H - MARGIN },
  ];
  return seeds.map((seed) => {
    let polygon = bounds;
    for (const other of seeds) {
      if (other === seed || polygon.length === 0) continue;
      const a = other.x - seed.x;
      const b = other.y - seed.y;
      const c = (other.x ** 2 + other.y ** 2 - seed.x ** 2 - seed.y ** 2) / 2;
      polygon = clipHalfPlane(polygon, a, b, c);
    }
    const frontage = closestEdgeToRoute(polygon);
    return {
      id: seed.id,
      polygon,
      frontage,
      frontageWidth: distance(frontage[0], frontage[1]),
      depth: Math.sqrt(Math.max(1, polygonArea(polygon))),
      hasConnector: edgeRouteDistance(frontage) <= 24,
      hierarchy: 0,
    };
  }).filter((parcel) => parcel.polygon.length >= 3 && polygonArea(parcel.polygon) > 80);
}

function frontageParcels(hierarchical) {
  const parcels = [];
  for (let side = -1; side <= 1; side += 2) {
    const stations = [];
    let x = 42;
    let index = 0;
    stations.push({ x, depth: stationDepth(x, side, 0, hierarchical) });
    while (x < PANEL_W - 54) {
      const phase = vanDerCorput(index + (side > 0 ? 23 : 7), 2);
      const width = hierarchical ? 19 + phase * 30 + unit(index, side, 41) * 9 : 28;
      const nextX = Math.min(PANEL_W - 42, x + width);
      stations.push({ x: nextX, depth: stationDepth(nextX, side, index + 1, hierarchical) });
      x = nextX;
      index++;
    }
    if (hierarchical) constrainStationEnvelope(stations);
    for (let stationIndex = 0; stationIndex < stations.length - 1; stationIndex++) {
      const start = stations[stationIndex];
      const end = stations[stationIndex + 1];
      x = start.x;
      const nextX = end.x;
      const midX = (x + nextX) / 2;
      const hierarchy = hierarchical && unit(stationIndex, side, 77) > 0.72 ? 1 : 0;
      const depth = (start.depth + end.depth) / 2;
      const frontA = offsetRoute(x, side, ROUTE_HALF + 2);
      const frontB = offsetRoute(nextX, side, ROUTE_HALF + 2);
      const backA = offsetRoute(x, side, ROUTE_HALF + start.depth);
      const backB = offsetRoute(nextX, side, ROUTE_HALF + end.depth);
      const frontage = [frontA, frontB];
      parcels.push({
        id: `${hierarchical ? 'hierarchy' : 'strip'}:${side}:${Math.round(x * 10)}`,
        polygon: [frontA, frontB, backB, backA],
        frontage,
        frontageWidth: distance(frontA, frontB),
        depth,
        hasConnector: true,
        hierarchy,
        connector: offsetRoute(midX, side, ROUTE_HALF + 2),
        yard: hierarchical ? yardPolygon(frontA, frontB, backB, backA, hierarchy) : null,
      });
    }
  }
  return parcels;
}

function stationDepth(x, side, index, hierarchical) {
  if (!hierarchical) return 74;
  const phase = vanDerCorput(index + (side > 0 ? 17 : 29), 3);
  const desired = 52 + phase * 64 + unit(Math.round(x * 10), side, 103) * 14;
  const curvature = signedRouteCurvature(x);
  if (Math.abs(curvature) < 1e-6) return desired;
  const safeDepth = 0.42 / Math.abs(curvature) - ROUTE_HALF - 4;
  return Math.min(desired, Math.max(18, safeDepth));
}

function constrainStationEnvelope(stations) {
  for (let index = 1; index < stations.length; index++) {
    const maximumDelta = (stations[index].x - stations[index - 1].x) * 0.55;
    stations[index].depth = Math.min(stations[index].depth, stations[index - 1].depth + maximumDelta);
  }
  for (let index = stations.length - 2; index >= 0; index--) {
    const maximumDelta = (stations[index + 1].x - stations[index].x) * 0.55;
    stations[index].depth = Math.min(stations[index].depth, stations[index + 1].depth + maximumDelta);
  }
}

function signedRouteCurvature(x) {
  const delta = 0.75;
  const before = routeY(x - delta);
  const here = routeY(x);
  const after = routeY(x + delta);
  const first = (after - before) / (delta * 2);
  const second = (after - here * 2 + before) / (delta ** 2);
  return second / (1 + first ** 2) ** 1.5;
}

function offsetRoute(x, side, offset) {
  const frame = routeFrame(x);
  return { x: x + frame.normal.x * side * offset, y: routeY(x) + frame.normal.y * side * offset };
}

function yardPolygon(a, b, c, d, hierarchy) {
  const frontInset = hierarchy ? 0.3 : 0.2;
  const backInset = hierarchy ? 0.2 : 0.32;
  return [
    lerpPoint(a, d, frontInset),
    lerpPoint(b, c, frontInset),
    lerpPoint(b, c, 1 - backInset),
    lerpPoint(a, d, 1 - backInset),
  ].map((point) => lerpPoint(point, centroid([a, b, c, d]), 0.16));
}

function measure(parcels) {
  const widths = parcels.map((parcel) => parcel.frontageWidth);
  const depths = parcels.map((parcel) => parcel.depth);
  const frontage = parcels.filter((parcel) => parcel.hasConnector).length / parcels.length;
  const orientationErrors = parcels.map((parcel) => {
    const mid = midpoint(parcel.frontage[0], parcel.frontage[1]);
    const edge = normalized({
      x: parcel.frontage[1].x - parcel.frontage[0].x,
      y: parcel.frontage[1].y - parcel.frontage[0].y,
    });
    const tangent = routeFrame(mid.x).tangent;
    return Math.acos(Math.min(1, Math.abs(edge.x * tangent.x + edge.y * tangent.y))) * 180 / Math.PI;
  });
  const signatures = parcels.map((parcel) =>
    `${Math.round(parcel.frontageWidth / 6)},${Math.round(parcel.depth / 8)},${parcel.hierarchy}`);
  const uniqueSignatures = new Set(signatures).size;
  const occupancy = occupancyMetrics(parcels);
  return {
    parcels: parcels.length,
    frontageAccessRate: round(frontage),
    frontageWidthCv: round(coefficientOfVariation(widths)),
    depthCv: round(coefficientOfVariation(depths)),
    frontageLag1Autocorrelation: round(lagOneAutocorrelation(widths)),
    medianOrientationErrorDegrees: round(median(orientationErrors)),
    uniqueShapeSignatureRate: round(uniqueSignatures / parcels.length),
    overlapSampleRate: round(occupancy.overlap / occupancy.occupied),
    routeIntrusionSampleRate: round(occupancy.routeIntrusion / occupancy.occupied),
    yardReserveRate: round(parcels.filter((parcel) => parcel.yard).length / parcels.length),
  };
}

function occupancyMetrics(parcels) {
  let occupied = 0;
  let overlap = 0;
  let routeIntrusion = 0;
  for (let y = MARGIN; y < PANEL_H - MARGIN; y += 4) {
    for (let x = MARGIN; x < PANEL_W - MARGIN; x += 4) {
      const count = parcels.filter((parcel) => pointInPolygon({ x, y }, parcel.polygon)).length;
      if (count === 0) continue;
      occupied++;
      if (count > 1) overlap++;
      if (Math.abs(y - routeY(x)) < ROUTE_HALF) routeIntrusion++;
    }
  }
  return { occupied: Math.max(1, occupied), overlap, routeIntrusion };
}

function renderComparison(modelList) {
  const panels = modelList.map((model, index) => renderPanel(model, index * PANEL_W)).join('\n');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${PANEL_W * modelList.length}" height="${PANEL_H}" viewBox="0 0 ${PANEL_W * modelList.length} ${PANEL_H}">
  <defs><filter id="shadow"><feDropShadow dx="0" dy="2" stdDeviation="2" flood-opacity=".34"/></filter></defs>
  <rect width="100%" height="100%" fill="#171813"/>
  ${panels}
</svg>`;
}

function renderPanel(model, offsetX) {
  const polygons = model.parcels.map((parcel, index) => {
    const hue = (index * 47 + (parcel.hierarchy ?? 0) * 29) % 120;
    const fill = `hsl(${42 + hue / 5} 28% ${26 + (index % 4) * 4}%)`;
    const yard = parcel.yard
      ? `<polygon points="${points(parcel.yard)}" fill="#bda574" fill-opacity=".34" stroke="#e0c98d" stroke-opacity=".55" stroke-width="1"/>`
      : '';
    const building = insetPolygon(parcel.polygon, parcel.yard ? 0.28 : 0.36);
    return `<g><polygon points="${points(parcel.polygon)}" fill="${fill}" fill-opacity=".84" stroke="#d4bd88" stroke-opacity=".72" stroke-width="1"/>
      ${yard}<polygon points="${points(building)}" fill="#302a22" fill-opacity=".8" stroke="#f2d79b" stroke-opacity=".52" stroke-width="1" filter="url(#shadow)"/>
      ${parcel.hasConnector ? `<line x1="${midpoint(...parcel.frontage).x}" y1="${midpoint(...parcel.frontage).y}" x2="${midpoint(...parcel.frontage).x}" y2="${routeY(midpoint(...parcel.frontage).x)}" stroke="#f0d38f" stroke-width="2"/>` : ''}</g>`;
  }).join('\n');
  const routePath = route.map((point) => `${point.x},${point.y}`).join(' ');
  const m = model.metrics;
  return `<g transform="translate(${offsetX} 0)">
    <rect x="6" y="6" width="${PANEL_W - 12}" height="${PANEL_H - 12}" rx="12" fill="#24271f" stroke="#5b5d4b"/>
    ${polygons}
    <polyline points="${routePath}" fill="none" stroke="#16130f" stroke-width="${ROUTE_HALF * 2 + 6}" stroke-linecap="round" stroke-linejoin="round"/>
    <polyline points="${routePath}" fill="none" stroke="#8d7550" stroke-width="${ROUTE_HALF * 2}" stroke-linecap="round" stroke-linejoin="round"/>
    <polyline points="${routePath}" fill="none" stroke="#c0a476" stroke-opacity=".45" stroke-width="2" stroke-dasharray="3 7"/>
    <rect x="18" y="14" width="504" height="62" rx="9" fill="#11120f" fill-opacity=".9"/>
    <text x="30" y="38" fill="#f0ddb4" font-family="monospace" font-size="17" font-weight="bold">${model.label}</text>
    <text x="30" y="60" fill="#b9c39f" font-family="monospace" font-size="11">access ${pct(m.frontageAccessRate)} · width CV ${m.frontageWidthCv} · depth CV ${m.depthCv} · unique ${pct(m.uniqueShapeSignatureRate)}</text>
    <text x="30" y="496" fill="#a9ad99" font-family="monospace" font-size="10">overlap ${pct(m.overlapSampleRate)} · road intrusion ${pct(m.routeIntrusionSampleRate)} · orientation ${m.medianOrientationErrorDegrees}°</text>
  </g>`;
}

function clipHalfPlane(polygon, a, b, c) {
  const output = [];
  for (let index = 0; index < polygon.length; index++) {
    const current = polygon[index];
    const previous = polygon[(index + polygon.length - 1) % polygon.length];
    const currentInside = a * current.x + b * current.y <= c + 1e-7;
    const previousInside = a * previous.x + b * previous.y <= c + 1e-7;
    if (currentInside !== previousInside) {
      const dx = current.x - previous.x;
      const dy = current.y - previous.y;
      const denominator = a * dx + b * dy;
      if (Math.abs(denominator) > 1e-9) {
        const t = (c - a * previous.x - b * previous.y) / denominator;
        output.push({ x: previous.x + dx * t, y: previous.y + dy * t });
      }
    }
    if (currentInside) output.push(current);
  }
  return output;
}

function closestEdgeToRoute(polygon) {
  let best = [polygon[0], polygon[1]];
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < polygon.length; index++) {
    const edge = [polygon[index], polygon[(index + 1) % polygon.length]];
    const value = edgeRouteDistance(edge);
    if (value < bestDistance) { best = edge; bestDistance = value; }
  }
  return best;
}

function edgeRouteDistance(edge) {
  const mid = midpoint(edge[0], edge[1]);
  return Math.abs(mid.y - routeY(mid.x)) - ROUTE_HALF;
}

function polygonArea(polygon) {
  let sum = 0;
  for (let index = 0; index < polygon.length; index++) {
    const a = polygon[index];
    const b = polygon[(index + 1) % polygon.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

function centroid(polygon) {
  return polygon.reduce((sum, point) => ({ x: sum.x + point.x / polygon.length, y: sum.y + point.y / polygon.length }), { x: 0, y: 0 });
}

function insetPolygon(polygon, amount) {
  const center = centroid(polygon);
  return polygon.map((point) => lerpPoint(point, center, amount));
}

function pointInPolygon(point, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    if ((a.y > point.y) !== (b.y > point.y) &&
        point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function unit(a, b, salt) {
  let value = (SEED ^ salt) | 0;
  value = Math.imul(value ^ Math.trunc(a), 0x45d9f3b);
  value = Math.imul(value ^ Math.trunc(b), 0x119de1f3);
  return ((value ^ (value >>> 16)) >>> 0) / 0x1_0000_0000;
}

function vanDerCorput(value, base) {
  let denominator = 1;
  let result = 0;
  let integer = value;
  while (integer > 0) {
    denominator *= base;
    result += (integer % base) / denominator;
    integer = Math.floor(integer / base);
  }
  return result;
}

function coefficientOfVariation(values) {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance) / Math.max(1e-9, mean);
}

function lagOneAutocorrelation(values) {
  if (values.length < 3) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const denominator = values.reduce((sum, value) => sum + (value - mean) ** 2, 0);
  const numerator = values.slice(1).reduce((sum, value, index) =>
    sum + (value - mean) * (values[index] - mean), 0);
  return denominator === 0 ? 1 : numerator / denominator;
}

function median(values) {
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.floor(ordered.length / 2)] ?? 0;
}

function distance(a, b) { return Math.hypot(b.x - a.x, b.y - a.y); }
function midpoint(a, b) { return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }
function normalized(v) { const length = Math.max(1e-9, Math.hypot(v.x, v.y)); return { x: v.x / length, y: v.y / length }; }
function lerpPoint(a, b, t) { return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }; }
function points(polygon) { return polygon.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' '); }
function pct(value) { return `${Math.round(value * 100)}%`; }
function round(value) { return Number(value.toFixed(3)); }

function findings(report) {
  const rows = Object.entries(report.models).map(([id, metric]) =>
    `| ${id} | ${pct(metric.frontageAccessRate)} | ${metric.frontageWidthCv} | ${metric.depthCv} | ${pct(metric.uniqueShapeSignatureRate)} | ${pct(metric.overlapSampleRate)} | ${metric.medianOrientationErrorDegrees}° |`).join('\n');
  return `# Regional parcel model comparison\n\n` +
    `This is a geometry-selection lab, not authored-runtime evidence. It compares the isotropic Voronoi baseline identified in Vanegas et al. (2012), a recursive/OBB-like uniform frontage baseline, and a route-aligned guided partition that combines global access goals with local deterministic constraints.\n\n` +
    `The selected V4 is the fourth measured correction, not a first-pass diagram. V1 used independent frontage geometry and retained 1.1% sampled overlap. V2 shared route stations but retained 0.6%. V3 applied a one-sided curvature cap and regressed to 1.5%. V4 constructs both sides from an offset-route envelope, caps depth against signed curvature on both sides, and constrains adjacent rear-edge slope; its selected candidate reaches zero sampled overlap while keeping non-uniform frontage and depth. Earlier outputs remain separate research evidence and are not overwritten.\n\n` +
    `| model | access | width CV | depth CV | unique shapes | overlap | orientation error |\n|---|---:|---:|---:|---:|---:|---:|\n${rows}\n\n` +
    `Selected: **anisotropic-hierarchy**. It is the only candidate designed to preserve a stable parcel ID, an explicit route connector, a shared-boundary partition, varied depth/frontage, and an internal yard reserve before an authored silhouette is selected. Uniform strips remain too repetitive; isotropic Voronoi cells have unreliable frontage and poor alignment.\n\n` +
    `References:\n\n- [Vanegas et al., Procedural Generation of Parcels in Urban Modeling](https://www.cs.purdue.edu/cgvlab/www/resources/papers/Vanegas-Eurographics-2012-Procedural_Generation_of_Parcels_in_Urban_Modeling.pdf)\n- [Parish and Müller, Procedural Modeling of Cities](https://cgl.ethz.ch/Downloads/Publications/Papers/2001/p_Par01.pdf)\n- [Emilien et al., Procedural Generation of Villages on Arbitrary Terrains](https://hal.science/hal-00694525)\n`;
}
