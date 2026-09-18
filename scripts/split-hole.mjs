// Splits the burrow sprite into a back layer (whole sprite) and a front layer that keeps only
// the near rim: for every column inside the opening, pixels BELOW the lowest dark interior
// pixel stay, everything else becomes fully transparent. The mouse is drawn between the two.
import sharp from "sharp";

const SRC = "art-src/hole.png";
const { data, info } = await sharp(SRC).trim({ threshold: 8 }).raw().ensureAlpha().toBuffer({ resolveWithObject: true });
const { width: W, height: H } = info;
const px = (x, y) => (y * W + x) * 4;

// The opening is the connected dark region around the centre of the sprite (flood fill),
// which keeps pebble shadows and grass outlines in the rim out of it.
const dark = (x, y) => {
  const i = px(x, y);
  return data[i + 3] > 128 && data[i] < 95 && data[i + 1] < 65 && data[i + 2] < 50;
};
const inside = new Uint8Array(W * H);
const stack = [[Math.floor(W / 2), Math.floor(H / 2)]];
while (stack.length) {
  const [x, y] = stack.pop();
  if (x < 0 || y < 0 || x >= W || y >= H) continue;
  const k = y * W + x;
  if (inside[k] || !dark(x, y)) continue;
  inside[k] = 1;
  stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
}
const edge = new Int32Array(W).fill(-1);
let x0 = W, x1 = -1;
for (let x = 0; x < W; x++) {
  for (let y = H - 1; y >= 0; y--) {
    if (inside[y * W + x]) {
      edge[x] = y;
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      break;
    }
  }
}
const smooth = new Int32Array(W).fill(-1);
for (let x = x0; x <= x1; x++) {
  let s = 0, n = 0;
  for (let k = -4; k <= 4; k++) {
    const xx = x + k;
    if (xx >= x0 && xx <= x1 && edge[xx] >= 0) { s += edge[xx]; n++; }
  }
  smooth[x] = n ? Math.round(s / n) : -1;
}

const front = Buffer.from(data);
for (let x = 0; x < W; x++) {
  const e = smooth[x];
  for (let y = 0; y < H; y++) {
    // keep the rim just below the opening edge (a couple of px overlap hides seams)
    const keep = e >= 0 && y > e - 2;
    if (!keep) front[px(x, y) + 3] = 0;
  }
}

const opts = { raw: { width: W, height: H, channels: 4 } };
const out = async (buf, name, w) => {
  const base = sharp(buf, opts).resize({ width: w });
  await base.clone().webp({ quality: 88, alphaQuality: 92, effort: 6 }).toFile(`public/img/${name}.webp`);
  await base.clone().png({ compressionLevel: 9, palette: true, quality: 90 }).toFile(`public/img/${name}.png`);
};
await out(Buffer.from(data), "hole-back", 640);
await out(front, "hole-front", 640);

// report the opening geometry as percentages of the sprite box, for the CSS
let top = H;
for (let y = 0; y < H && top === H; y++) for (let x = 0; x < W; x++) if (inside[y * W + x]) { top = y; break; }
const bottom = Math.max(...smooth.filter((v) => v >= 0));
console.log(`sprite ${W}x${H}; opening x ${((x0 / W) * 100).toFixed(1)}%–${((x1 / W) * 100).toFixed(1)}%, y ${((top / H) * 100).toFixed(1)}%–${((bottom / H) * 100).toFixed(1)}%`);
