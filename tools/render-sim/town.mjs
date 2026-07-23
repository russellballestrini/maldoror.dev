/**
 * "Town" showcase — a denser canal-town scene composing terrain + buildings +
 * bridge + props + entities, rendered in OCTANT (the live fidelity mode) and
 * fullres. The goal-tracking comparison against gallery/TARGET.png.
 *
 * node tools/render-sim/town.mjs
 */
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../..');
const { ViewportRenderer } = await import(`${REPO}/packages/render/dist/pixel/viewport-renderer.js`);
const { renderOctantGridCells, renderHalfBlockGridCells, quantizeGridDithered } =
  await import(`${REPO}/packages/render/dist/pixel/pixel-renderer.js`);
const { OCTANT_CHARS } = await import(`${REPO}/packages/render/dist/pixel/octant-chars.js`);
const OCT_LOOKUP = new Map();
OCTANT_CHARS.forEach((ch, pat) => { if (!OCT_LOOKUP.has(ch.codePointAt(0))) OCT_LOOKUP.set(ch.codePointAt(0), pat); });

const OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });
const TERRAIN_DIR = path.join(REPO, 'apps/ssh-world/data/terrain');
const BUILDINGS_DIR = path.join(REPO, 'tools/render-sim/buildings-canal');
const PROPS_DIR = path.join(REPO, 'tools/render-sim/props-canal');
const RESOLUTIONS = [26, 51, 77, 102, 128, 154, 179, 205, 230, 256];

async function pngToGrid(file) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const g = [];
  for (let y = 0; y < info.height; y++) {
    const row = [];
    for (let x = 0; x < info.width; x++) {
      const i = (y * info.width + x) * 4;
      row.push(data[i + 3] < 32 ? null : { r: data[i], g: data[i + 1], b: data[i + 2] });
    }
    g.push(row);
  }
  return g;
}
function downscale(g, t) {
  const s = g.length; if (s === t) return g;
  const o = [];
  for (let y = 0; y < t; y++) { const r = []; const sy = (y * s / t) | 0; for (let x = 0; x < t; x++) r.push(g[sy][(x * s / t) | 0] ?? null); o.push(r); }
  return o;
}
function despeckle(g, passes = 3, lumMax = 80) {
  const h = g.length, w = g[0]?.length ?? 0; const lum = p => 0.299*p.r+0.587*p.g+0.114*p.b;
  for (let k = 0; k < passes; k++) { const kill = [];
    for (let y=0;y<h;y++) for (let x=0;x<w;x++){ const p=g[y][x]; if(!p||lum(p)>=lumMax)continue; let air=false;
      for(let dy=-1;dy<=1&&!air;dy++)for(let dx=-1;dx<=1;dx++){if(!dx&&!dy)continue;const ny=y+dy,nx=x+dx;if(ny<0||ny>=h||nx<0||nx>=w||!g[ny][nx]){air=true;break;}}
      if(air)kill.push([y,x]); }
    for(const [y,x] of kill) g[y][x]=null; if(!kill.length)break; }
  return g;
}
const cache = new Map();
async function loadCell(file) {
  if (cache.has(file)) return cache.get(file);
  const g = fs.existsSync(file) ? await pngToGrid(file) : null;
  cache.set(file, g); return g;
}
async function tileRes(dir, name) {
  const base = path.join(dir, name('256'));
  if (!fs.existsSync(base)) return null;
  const px = await loadCell(base);
  const res = {};
  for (const r of RESOLUTIONS) { const f = path.join(dir, name(String(r))); res[String(r)] = fs.existsSync(f) ? await loadCell(f) : downscale(px, r); }
  return { pixels: px, resolutions: res };
}

// ---- scene: 24x14 tiles. Layout string per row (chars):
//  W=water  S=stone  '.'=stone(under building/prop anchors placed separately)
const MAP = [
  'SSSSSSSSSSSSSSSSSSSSSSSS',
  'SWWWWSSSSSWWWWWWSSSSWWWS',
  'SWWWWSSSSSWWWWWWSSSSWWWS',
  'SWWWWSSSSSWWWWWWSSSSWWWS',
  'SSSSSSSSSSSSSSSSSSSSSSSS',
  'SSSSSSSSSSSSSSSSSSSSSSSS',
  'WWWWWWSSSSSSSSSSSSSWWWWWW'.slice(0,24),
  'WWWWWWSSSSSSSSSSSSSWWWWWW'.slice(0,24),
  'WWWWWWSSSSSSSSSSSSSWWWWWW'.slice(0,24),
  'SSSSSSSSSSSSSSSSSSSSSSSS',
  'SWWWWWSSSSWWWWWSSSSWWWWWS'.slice(0,24),
  'SWWWWWSSSSWWWWWSSSSWWWWWS'.slice(0,24),
  'SWWWWWSSSSWWWWWSSSSWWWWWS'.slice(0,24),
  'SSSSSSSSSSSSSSSSSSSSSSSS',
];
const H = MAP.length, W = MAP[0].length;
const at = (x,y) => (y>=0&&y<H&&x>=0&&x<W) ? MAP[y][x] : 'S';
function posHash(x,y){let h=x*374761393+y*668265263;h=(h^(h>>13))*1274126177;return Math.abs(h);}

// terrain grid with stone_to_water autotile + water variants
const grid = [];
for (let y=0;y<H;y++){ const row=[];
  for (let x=0;x<W;x++){
    if (at(x,y)==='W'){
      const variants=['water']; for(const v of[2,3]) if(fs.existsSync(path.join(TERRAIN_DIR,`water__v${v}`,'256.png'))) variants.push(`water__v${v}`);
      const id=variants[posHash(x*7+3,y*5+1)%variants.length];
      row.push(await tileRes(path.join(TERRAIN_DIR,id),(r)=>`${r}.png`));
    } else {
      const n=at(x,y-1)==='W',e=at(x+1,y)==='W',s=at(x,y+1)==='W',w=at(x-1,y)==='W';
      let nm=''; if(n)nm+='n';if(s)nm+='s';if(e)nm+='e';if(w)nm+='w';
      const have=['n','e','s','w','ne','nw','se','sw'];
      let id='stone';
      if(nm){ if(!have.includes(nm)) nm=nm[0]; id=`stone_to_water_${nm}`; }
      let t=await tileRes(path.join(TERRAIN_DIR,id),(r)=>`${r}.png`);
      row.push(t ?? await tileRes(path.join(TERRAIN_DIR,'stone'),(r)=>`${r}.png`));
    }
  }
  grid.push(row);
}

// overlays: buildings (2x2), bridge (3x2), props (1x1). anchor = top-left tile.
const overlays = new Map(); // "x,y" -> {pixels,resolutions}
async function place(dir, id, ax, ay, cols, rows) {
  const base = path.join(dir, id);
  if (!fs.existsSync(base)) return;
  for (let ty=0;ty<rows;ty++) for (let tx=0;tx<cols;tx++){
    const t = await tileRes(base, (r)=>`tile_${tx}_${ty}_${r}.png`);
    if (t) overlays.set(`${ax+tx},${ay+ty}`, t);
  }
}
await place(BUILDINGS_DIR,'shop_awning', 10, 4, 2, 2);
await place(BUILDINGS_DIR,'house_tall',  1, 9, 2, 2);
await place(PROPS_DIR,'bridge_h', 6, 6, 3, 2);   // across the middle canal
await place(PROPS_DIR,'lamp_post', 9, 5, 1, 1);
await place(PROPS_DIR,'lamp_post', 14, 5, 1, 1);
await place(PROPS_DIR,'planter', 8, 4, 1, 1);
await place(PROPS_DIR,'umbrella_stall', 18, 9, 1, 1);
await place(PROPS_DIR,'rowboat', 2, 2, 1, 1);
await place(PROPS_DIR,'rowboat', 20, 11, 1, 1);

// sprites
async function loadSprite(dir){ const sp={resolutions:{down:{}}}; const dirs=['down'];
  for(const d of dirs){ const f=path.join(dir,`frame_${d}_0_256.png`); const g=fs.existsSync(f)?despeckle(await pngToGrid(f)):null;
    sp.resolutions[d]={}; for(const r of RESOLUTIONS) sp.resolutions[d][r]=g?downscale(g,r):null; }
  return sp; }
const playerDir = fs.readdirSync(path.join(REPO,'sprites')).find(d=>fs.existsSync(path.join(REPO,'sprites',d,'frame_down_0_256.png')));
const player = await loadSprite(path.join(REPO,'sprites',playerDir));
const npcDirs = fs.readdirSync(path.join(REPO,'npcs')).filter(d=>fs.existsSync(path.join(REPO,'npcs',d,'frame_down_0_256.png'))).slice(0,2);
const npcs = []; for(const d of npcDirs) npcs.push(await loadSprite(path.join(REPO,'npcs',d)));
const entities = [ {sp:player, x:11, y:8}, {sp:npcs[0], x:15, y:5}, {sp:npcs[1], x:5, y:12} ];

// ---- fullres composite ----
async function fullres(TS=128){
  const Wp=W*TS, Hp=H*TS; const img=Buffer.alloc(Wp*Hp*3);
  const put=(x,y,c)=>{const i=(y*Wp+x)*3;img[i]=c.r;img[i+1]=c.g;img[i+2]=c.b;};
  const blit=(px,ax,ay)=>{ if(!px)return; for(let y=0;y<TS;y++)for(let x=0;x<TS;x++){const p=px[y]?.[x];if(p)put(ax*TS+x,ay*TS+y,p);} };
  for(let y=0;y<H;y++)for(let x=0;x<W;x++) blit(grid[y][x]?.resolutions?.[String(TS)], x, y);
  for(const [k,t] of overlays){ const [x,y]=k.split(',').map(Number); blit(t.resolutions?.[String(TS)], x, y); }
  for(const e of entities) blit(e.sp.resolutions.down[TS], e.x, e.y);
  await sharp(img,{raw:{width:Wp,height:Hp,channels:3}}).png().toFile(path.join(OUT,'town_fullres.png'));
  console.log('wrote town_fullres.png');
}

// ---- octant/halfblock cell render via ViewportRenderer ----
const world = {
  getTile:(x,y)=>grid[((y%H)+H)%H]?.[((x%W)+W)%W] ?? null,
  getBuildingTileAt:(x,y)=>overlays.get(`${x},${y}`) ?? null,
  getPlayers:()=>entities.filter(e=>e.sp===player).map(e=>({userId:'p',username:'',x:e.x,y:e.y,direction:'down',animationFrame:0})),
  getNPCs:()=>entities.filter(e=>e.sp!==player).map((e,i)=>({npcId:`n${i}`,name:'',x:e.x,y:e.y,direction:'down',animationFrame:0})),
  getLocalPlayerId:()=>'p',
  getPlayerSprite:()=>({frames:{down:[null],up:[null],left:[null],right:[null]},resolutions:Object.fromEntries(RESOLUTIONS.map(r=>[String(r),{down:[player.resolutions.down[r]],up:[player.resolutions.down[r]],left:[player.resolutions.down[r]],right:[player.resolutions.down[r]]}]))}),
  getNPCSprite:(id)=>{const e=entities.filter(x=>x.sp!==player)[parseInt(id.slice(1),10)]; const s=e?.sp; if(!s)return null; return {frames:{down:[null],up:[null],left:[null],right:[null]},resolutions:Object.fromEntries(RESOLUTIONS.map(r=>[String(r),{down:[s.resolutions.down[r]],up:[s.resolutions.down[r]],left:[s.resolutions.down[r]],right:[s.resolutions.down[r]]}]))};},
};

const CELL_W=10, CELL_H=20;
function raster(cells, mode){
  const rows=cells.length, cols=Math.max(...cells.map(r=>r.length)); const Wp=cols*CELL_W, Hp=rows*CELL_H;
  const img=Buffer.alloc(Wp*Hp*3); const DEF={r:20,g:20,b:25};
  const fill=(x0,y0,w,h,c)=>{for(let y=y0;y<y0+h;y++)for(let x=x0;x<x0+w;x++){const i=(y*Wp+x)*3;img[i]=c.r;img[i+1]=c.g;img[i+2]=c.b;}};
  for(let cy=0;cy<rows;cy++)for(let cx=0;cx<cols;cx++){ const cell=cells[cy]?.[cx]; const px=cx*CELL_W,py=cy*CELL_H;
    if(!cell){fill(px,py,CELL_W,CELL_H,DEF);continue;} const fg=cell.fgColor??DEF,bg=cell.bgColor??DEF;
    if(mode==='halfblock'){fill(px,py,CELL_W,CELL_H/2,fg);fill(px,py+CELL_H/2,CELL_W,CELL_H/2,bg);}
    else{fill(px,py,CELL_W,CELL_H,bg);const pat=OCT_LOOKUP.get(cell.char.codePointAt(0))??0;
      for(let r=0;r<4;r++)for(let c=0;c<2;c++) if(pat&(1<<(r*2+c))) fill(px+c*(CELL_W/2),py+r*(CELL_H/4),CELL_W/2,CELL_H/4,fg);}}
  return {img,Wp,Hp};
}
async function cellShot(mode, TS, label){
  const COLS=180, ROWS=52; const pxW=mode==='octant'?COLS*2:COLS; const pxH=mode==='octant'?ROWS*4:ROWS*2;
  const vr=new ViewportRenderer({widthTiles:(pxW/TS)|0,heightTiles:(pxH/TS)|0,pixelWidth:pxW,pixelHeight:pxH,tileRenderSize:TS});
  vr.setCamera(11,7);
  let {buffer}=vr.renderToBuffer(world,0); buffer=quantizeGridDithered(buffer,4);
  const cells=mode==='octant'?renderOctantGridCells(buffer):renderHalfBlockGridCells(buffer);
  const {img,Wp,Hp}=raster(cells,mode);
  await sharp(img,{raw:{width:Wp,height:Hp,channels:3}}).png().toFile(path.join(OUT,`town_${label}.png`));
  console.log(`wrote town_${label}.png`);
}

await fullres(128);
await cellShot('octant', 40, 'octant_wide');
await cellShot('octant', 72, 'octant_mid');
await cellShot('halfblock', 40, 'halfblock_wide');
console.log('done');
