/**
 * District-as-playable-scene prototype: load a generated district image, derive
 * a WALKABILITY mask (pale stone plaza = walkable; water/foliage/buildings =
 * blocked), composite the player sprite on a walkable spot, and octant-render
 * the whole thing. Proves the "camera-locked room" playable model.
 *
 * node tools/render-sim/octant-scene.mjs <district.png> [cols=300]
 * Writes <district>_scene_octant.png and <district>_walkmask.png
 */
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../..');
const { renderOctantGridCells, quantizeGridDithered } =
  await import(`${REPO}/packages/render/dist/pixel/pixel-renderer.js`);
const { OCTANT_CHARS } = await import(`${REPO}/packages/render/dist/pixel/octant-chars.js`);
const OCT = new Map(); OCTANT_CHARS.forEach((ch,p)=>{ if(!OCT.has(ch.codePointAt(0))) OCT.set(ch.codePointAt(0),p); });

const file = process.argv[2] || path.join(REPO, 'tools/render-sim/districts/district_1.png');
const cols = parseInt(process.argv[3] || '300', 10);
const pxW = cols * 2;

const src = await sharp(file).metadata();
const pxH = Math.round(pxW * (src.height / src.width));
const { data, info } = await sharp(file).resize(pxW, pxH, { fit: 'fill' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });

// pixel grid + walkability. Pale warm stone plaza = walkable.
const grid = [], walk = [];
for (let y = 0; y < info.height; y++) {
  const grow = [], wrow = [];
  for (let x = 0; x < info.width; x++) {
    const i = (y * info.width + x) * 4;
    const r = data[i], g = data[i+1], b = data[i+2];
    grow.push({ r, g, b });
    const bright = (r+g+b)/3;
    // Exclusion classifier: a pixel is BLOCKED if it's water (teal: blue/green
    // dominate red), foliage (green clearly dominant), or dark (roof shadow /
    // deep water). Everything else — the warm tan/cream flagstone paths, steps,
    // bridges — is walkable. Rough but far more robust across districts than a
    // narrow "is-pale-stone" threshold.
    const isWater = (b > r + 6 && g > r - 4) || (g > r + 6 && b > r - 4 && b > 100);
    const isFoliage = g > r + 18 && g > b + 10;
    const isDark = bright < 95;
    wrow.push(!(isWater || isFoliage || isDark));
  }
  grid.push(grow); walk.push(wrow);
}

// morphological open on the mask (remove tiny speckles) — a walkable pixel must
// have a walkable majority in its 3x3 neighbourhood.
function clean(w) {
  const h = w.length, wd = w[0].length; const out = w.map(r=>r.slice());
  for (let y=1;y<h-1;y++) for (let x=1;x<wd-1;x++){
    let n=0; for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++) if(w[y+dy][x+dx]) n++;
    out[y][x] = n >= 6;
  }
  return out;
}
const wmask = clean(clean(walk));

// find a big walkable spot near center for the player
function findSpot(){
  const cy = (pxH/2)|0, cx = (pxW/2)|0;
  for (let r=0;r<pxW;r++) for (const [sx,sy] of [[cx+r,cy],[cx-r,cy],[cx,cy+r],[cx,cy-r],[cx+r,cy+r],[cx-r,cy-r]]) {
    if (sy>10 && sy<pxH-30 && sx>10 && sx<pxW-10 && wmask[sy]?.[sx]) {
      // require a walkable patch
      let ok=true; for(let dy=-6;dy<=6&&ok;dy++)for(let dx=-4;dx<=4;dx++) if(!wmask[sy+dy]?.[sx+dx]) ok=false;
      if (ok) return { x:sx, y:sy };
    }
  }
  return { x:(pxW/2)|0, y:(pxH/2)|0 };
}
const spot = findSpot();

// composite player sprite (despeckled) onto the pixel grid at the spot
async function loadPlayer(){
  const dir = fs.readdirSync(path.join(REPO,'sprites')).find(d=>fs.existsSync(path.join(REPO,'sprites',d,'frame_down_0_256.png')));
  const f = path.join(REPO,'sprites',dir,'frame_down_0_256.png');
  const { data:d2, info:i2 } = await sharp(f).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  const g=[]; for(let y=0;y<i2.height;y++){const row=[];for(let x=0;x<i2.width;x++){const i=(y*i2.width+x)*4;row.push(d2[i+3]<40?null:{r:d2[i],g:d2[i+1],b:d2[i+2]});}g.push(row);} return g;
}
const player = await loadPlayer();
// scale player to ~ 3.5 tiles tall relative to scene (heuristic: pxH/16)
const targetH = Math.round(pxH/9), srcH = player.length, srcW = player[0].length, targetW = Math.round(targetH*srcW/srcH);
const px0 = spot.x - (targetW/2|0), py0 = spot.y - targetH + 4; // feet at spot
for (let y=0;y<targetH;y++) for (let x=0;x<targetW;x++){
  const sp = player[(y*srcH/targetH)|0]?.[(x*srcW/targetW)|0];
  if (sp){ const gy=py0+y, gx=px0+x; if(grid[gy]?.[gx]) grid[gy][gx]={r:sp.r,g:sp.g,b:sp.b}; }
}
// soft shadow under player
for (let y=-2;y<=2;y++) for (let x=-(targetW/2|0);x<=(targetW/2|0);x++){
  const gy=spot.y+3+y, gx=spot.x+x; const c=grid[gy]?.[gx]; if(c && Math.abs(y)+Math.abs(x/ (targetW/3))<3){ grid[gy][gx]={r:c.r*0.6|0,g:c.g*0.6|0,b:c.b*0.6|0}; }
}

// octant render + rasterize
const q = quantizeGridDithered(grid, 4);
const cells = renderOctantGridCells(q);
const CW=10, CH=20; const rows=cells.length, ccols=Math.max(...cells.map(r=>r.length)); const W=ccols*CW,Hh=rows*CH;
const img=Buffer.alloc(W*Hh*3);
const fill=(x0,y0,w,h,c)=>{for(let y=y0;y<y0+h;y++)for(let x=x0;x<x0+w;x++){const i=(y*W+x)*3;img[i]=c.r;img[i+1]=c.g;img[i+2]=c.b;}};
for(let cy=0;cy<rows;cy++)for(let cx=0;cx<ccols;cx++){const cell=cells[cy]?.[cx];const px=cx*CW,py=cy*CH;if(!cell){fill(px,py,CW,CH,{r:20,g:20,b:25});continue;}
  const fg=cell.fgColor??{r:20,g:20,b:25},bg=cell.bgColor??{r:20,g:20,b:25};fill(px,py,CW,CH,bg);const pat=OCT.get(cell.char.codePointAt(0))??0;
  for(let r=0;r<4;r++)for(let c=0;c<2;c++)if(pat&(1<<(r*2+c)))fill(px+c*(CW/2),py+r*(CH/4),CW/2,CH/4,fg);}
const out=file.replace(/\.png$/,'')+'_scene_octant.png';
await sharp(img,{raw:{width:W,height:Hh,channels:3}}).png().toFile(out);
console.log(`wrote ${out}  (player at ${spot.x},${spot.y})`);

// walkmask debug (green=walkable over dimmed scene)
const mimg=Buffer.alloc(pxW*pxH*3);
for(let y=0;y<pxH;y++)for(let x=0;x<pxW;x++){const c=grid[y][x];const i=(y*pxW+x)*3;
  if(wmask[y][x]){mimg[i]=60;mimg[i+1]=230;mimg[i+2]=90;}else{mimg[i]=c.r*0.4|0;mimg[i+1]=c.g*0.4|0;mimg[i+2]=c.b*0.4|0;}}
await sharp(mimg,{raw:{width:pxW,height:pxH,channels:3}}).png().toFile(file.replace(/\.png$/,'')+'_walkmask.png');
console.log('wrote walkmask debug');
