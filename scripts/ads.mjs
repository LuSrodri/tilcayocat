// Ad images for Google Ads (Search image assets, Demand Gen, YouTube companion), built from frames of
// the trailer (tools/trailer.ts) so they show the real game:
//   node scripts/ads.mjs <landscape-frame.jpg> <portrait-frame.jpg>
// writes marketing/ads/: landscape 1200x628, square 1200x1200, portrait 960x1200, logo 1200x1200
// and logo 1200x300.
import sharp from "sharp";
import { mkdirSync } from "node:fs";

const [wideSrc, tallSrc] = process.argv.slice(2);
if (!wideSrc || !tallSrc) throw new Error("usage: node scripts/ads.mjs <16x9 frame> <9x16 frame>");
const OUT = "marketing/ads";
mkdirSync(OUT, { recursive: true });
const LOGO = "public/brand/logo-wordmark.png";
const PURPLE = { r: 43, g: 33, b: 64, alpha: 1 };

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

// headline + a "PLAY FREE" pill, over a soft dark band so they read on any frame
function overlay(w, h, { headY, head, sub, pillY, band, fs = Math.round(w * 0.06) }) {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
  <defs>
    <linearGradient id="band" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#140a1c" stop-opacity="0"/>
      <stop offset=".45" stop-color="#140a1c" stop-opacity=".62"/>
      <stop offset="1" stop-color="#140a1c" stop-opacity=".82"/>
    </linearGradient>
    <linearGradient id="gold" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fffbe6"/><stop offset=".5" stop-color="#ffd23f"/><stop offset="1" stop-color="#ff9a2a"/>
    </linearGradient>
  </defs>
  <rect x="0" y="${band}" width="${w}" height="${h - band}" fill="url(#band)"/>
  <g font-family="Fredoka, Arial Rounded MT Bold, Arial Black, sans-serif" font-weight="700" text-anchor="middle">
    <text x="${w / 2}" y="${headY}" font-size="${fs}" fill="url(#gold)" stroke="#2e1a26" stroke-width="${fs * 0.16}" paint-order="stroke">${esc(head)}</text>
    <text x="${w / 2}" y="${headY + fs * 0.85}" font-size="${Math.round(fs * 0.5)}" fill="#fff6ea" stroke="#2e1a26" stroke-width="${fs * 0.1}" paint-order="stroke">${esc(sub)}</text>
    <rect x="${w / 2 - fs * 3.3}" y="${pillY}" width="${fs * 6.6}" height="${fs * 1.35}" rx="${fs * 0.68}" fill="#ffae42" stroke="#2e1a26" stroke-width="${fs * 0.1}"/>
    <text x="${w / 2}" y="${pillY + fs * 0.95}" font-size="${Math.round(fs * 0.78)}" fill="#ffffff" stroke="#2e1a26" stroke-width="${fs * 0.1}" paint-order="stroke">▶ PLAY FREE</text>
  </g>
</svg>`);
}

async function logoAt(width) {
  return sharp(LOGO).resize({ width }).png().toBuffer();
}

async function ad(name, src, w, h, crop, text) {
  const meta = await sharp(src).metadata();
  // crop: fraction of the source to keep, centred on (cx, cy)
  const cw = Math.round(Math.min(meta.width, (meta.height * w) / h) * crop.zoom);
  const ch = Math.round((cw * h) / w);
  const left = Math.max(0, Math.min(meta.width - cw, Math.round(meta.width * crop.cx - cw / 2)));
  const top = Math.max(0, Math.min(meta.height - ch, Math.round(meta.height * crop.cy - ch / 2)));
  const logoW = Math.round(w * text.logo);
  const logo = await logoAt(logoW);
  const lm = await sharp(logo).metadata();
  await sharp(src)
    .extract({ left, top, width: cw, height: ch })
    .resize(w, h)
    .modulate({ saturation: 1.08 })
    .composite([
      { input: overlay(w, h, text), top: 0, left: 0 },
      { input: logo, top: Math.round(h * text.logoY - lm.height / 2), left: Math.round((w - logoW) / 2) }
    ])
    .jpeg({ quality: 90, mozjpeg: true })
    .toFile(`${OUT}/${name}`);
  console.log("wrote", name);
}

const head = "Catch the mice. Collect the cats.";
const sub = "Free 3D cat game in your browser";

await ad("ad-landscape-1200x628.jpg", wideSrc, 1200, 628, { zoom: 1, cx: 0.5, cy: 0.5 },
  { logo: 0.4, logoY: 0.17, band: 330, headY: 455, head, sub, pillY: 520, fs: 48 });
await ad("ad-square-1200x1200.jpg", wideSrc, 1200, 1200, { zoom: 0.82, cx: 0.62, cy: 0.5 },
  { logo: 0.62, logoY: 0.12, band: 700, headY: 930, head, sub, pillY: 1040 });
await ad("ad-portrait-960x1200.jpg", tallSrc, 960, 1200, { zoom: 1, cx: 0.5, cy: 0.42 },
  { logo: 0.78, logoY: 0.1, band: 720, headY: 950, head: "Catch the mice!", sub: "Collect the cats · free in your browser", pillY: 1050 });

// logos on the brand purple
for (const [name, w, h, lw] of [["logo-square-1200x1200.png", 1200, 1200, 1040], ["logo-landscape-1200x300.png", 1200, 300, 900]]) {
  const logo = await sharp(LOGO).resize({ width: lw, height: Math.round(h * 0.86), fit: "inside" }).png().toBuffer();
  const lm = await sharp(logo).metadata();
  await sharp({ create: { width: w, height: h, channels: 4, background: PURPLE } })
    .composite([{ input: logo, top: Math.round((h - lm.height) / 2), left: Math.round((w - lm.width) / 2) }])
    .png()
    .toFile(`${OUT}/${name}`);
  console.log("wrote", name);
}
