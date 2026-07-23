/**
 * Render any image through the REAL octant cell pipeline and rasterize the
 * result — "what this image looks like in the terminal". For evaluating dense
 * generated districts against the octant fidelity ceiling.
 *
 * node tools/render-sim/octant-image.mjs <image> [cols=200]
 */
import sharp from 'sharp';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../..');
const { renderOctantGridCells, quantizeGridDithered } =
  await import(`${REPO}/packages/render/dist/pixel/pixel-renderer.js`);
const { OCTANT_CHARS } = await import(`${REPO}/packages/render/dist/pixel/octant-chars.js`);
const OCT = new Map(); OCTANT_CHARS.forEach((ch,p)=>{ if(!OCT.has(ch.codePointAt(0))) OCT.set(ch.codePointAt(0),p); });

const file = process.argv[2];
const cols = parseInt(process.argv[3] || '200', 10);
const meta = await sharp(file).metadata();
// octant = 2 px wide, 4 px tall per cell. Keep image aspect.
const cellAspect = 2 / 4; // px w/h per cell -> to keep image aspect, rows derived
const pxW = cols * 2;
const pxH = Math.round(pxW * (meta.height / meta.width));
const { data, info } = await sharp(file).resize(pxW, pxH, { fit: 'fill' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const grid = [];
for (let y = 0; y < info.height; y++) {
  const row = [];
  for (let x = 0; x < info.width; x++) {
    const i = (y * info.width + x) * 4;
    row.push({ r: data[i], g: data[i+1], b: data[i+2] });
  }
  grid.push(row);
}
const q = quantizeGridDithered(grid, 4);
const cells = renderOctantGridCells(q);

// rasterize (10x20 px per cell)
const CW = 10, CH = 20;
const rows = cells.length, ccols = Math.max(...cells.map(r=>r.length));
const W = ccols*CW, H = rows*CH;
const img = Buffer.alloc(W*H*3);
const fill=(x0,y0,w,h,c)=>{for(let y=y0;y<y0+h;y++)for(let x=x0;x<x0+w;x++){const i=(y*W+x)*3;img[i]=c.r;img[i+1]=c.g;img[i+2]=c.b;}};
for (let cy=0;cy<rows;cy++) for (let cx=0;cx<ccols;cx++){
  const cell=cells[cy]?.[cx]; const px=cx*CW,py=cy*CH; if(!cell){fill(px,py,CW,CH,{r:20,g:20,b:25});continue;}
  const fg=cell.fgColor??{r:20,g:20,b:25}, bg=cell.bgColor??{r:20,g:20,b:25};
  fill(px,py,CW,CH,bg); const pat=OCT.get(cell.char.codePointAt(0))??0;
  for(let r=0;r<4;r++)for(let c=0;c<2;c++) if(pat&(1<<(r*2+c))) fill(px+c*(CW/2),py+r*(CH/4),CW/2,CH/4,fg);
}
const out = file.replace(/\.png$/,'') + `_octant${cols}.png`;
await sharp(img,{raw:{width:W,height:H,channels:3}}).png().toFile(out);
console.log(`wrote ${out}  (${ccols}x${rows} cells)`);
