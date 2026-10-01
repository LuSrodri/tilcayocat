// The Cat The Mouse Company wordmark: chunky cartoon letters with a 3D extrusion, gloss and ink
// outline, a ribbon for "COMPANY", the 3D grey tabby peeking in from the left and a mouse on the
// ribbon tail. The ribbon runs across the cat's chest. Everything is flattened to 2D images, so the page only downloads a small WebP.
//   - public/brand/logo-wordmark.{webp,png}   (1400×760 master, transparent)
//   - public/brand/logo-wordmark-sm.webp      (700 wide, for the start screen)
// Run: npm run logo   (needs art-src/renders/logo-head.png and mouse.png, see `npm run og`)
import sharp from "sharp";
import opentype from "opentype.js";
import { mkdirSync } from "node:fs";

const W = 1400;
const H = 760;
const INK = "#2e1a26";
const font = opentype.loadSync("art-src/fonts/Fredoka-Bold.ttf");

// A word laid out on a gentle upward arc: one <path> per glyph, rotated to follow the curve.
function arcWord(text, cx, baseline, size, radius, tracking = 0) {
  const glyphs = font.stringToGlyphs(text);
  const scale = size / font.unitsPerEm;
  const advances = glyphs.map((g) => g.advanceWidth * scale + tracking);
  const total = advances.reduce((a, b) => a + b, 0) - tracking;
  let x = cx - total / 2;
  let out = "";
  glyphs.forEach((g, i) => {
    const mid = x + (g.advanceWidth * scale) / 2;
    const dx = mid - cx;
    const drop = radius - Math.sqrt(radius * radius - dx * dx);
    const angle = (Math.asin(dx / radius) * 180) / Math.PI;
    const d = g.getPath(x, baseline, size).toPathData(2);
    if (d) out += `<path d="${d}" transform="rotate(${angle.toFixed(2)} ${mid.toFixed(1)} ${baseline}) translate(0 ${drop.toFixed(1)})"/>`;
    x += advances[i];
  });
  return out;
}

// Stack copies of a word down-right for depth, ink around the whole block, then the glossy face.
function chunky(id, glyphs, { depth, side, face, stroke = 9 }) {
  const layers = [];
  for (let i = depth; i >= 1; i--) layers.push(`<use href="#${id}" transform="translate(${(i * 0.45).toFixed(2)} ${i})"/>`);
  return `
  <g id="${id}">${glyphs}</g>
  <g fill="${INK}" stroke="${INK}" stroke-width="${stroke * 2.4}" stroke-linejoin="round" filter="url(#soft)" opacity=".5">
    <use href="#${id}" transform="translate(${depth * 0.45 + 6} ${depth + 14})"/>
  </g>
  <g fill="${INK}" stroke="${INK}" stroke-width="${stroke * 2}" stroke-linejoin="round">${layers.join("")}<use href="#${id}"/></g>
  <g fill="url(#${side})">${layers.join("")}</g>
  <use href="#${id}" fill="url(#${face})" stroke="${INK}" stroke-width="${stroke * 0.7}" stroke-linejoin="round"/>
  <use href="#${id}" fill="none" stroke="#ffffff" stroke-opacity=".55" stroke-width="2.4" transform="translate(-1.5 -2.5)"/>`;
}

const ribbonTop = 528;
const ribbonH = 92;
const rL = 215;
const rR = 1285;
const sag = 34;
const ribbon = `
  <g stroke="${INK}" stroke-width="8" stroke-linejoin="round">
    <path d="M${rL + 35} ${ribbonTop + 30} L${rL - 75} ${ribbonTop + 34} L${rL - 40} ${ribbonTop + 34 + ribbonH / 2} L${rL - 75} ${ribbonTop + 34 + ribbonH} L${rL + 35} ${ribbonTop + 30 + ribbonH} Z" fill="#a8326a"/>
    <path d="M${rR - 35} ${ribbonTop + 30} L${rR + 75} ${ribbonTop + 34} L${rR + 40} ${ribbonTop + 34 + ribbonH / 2} L${rR + 75} ${ribbonTop + 34 + ribbonH} L${rR - 35} ${ribbonTop + 30 + ribbonH} Z" fill="#a8326a"/>
    <path d="M${rL} ${ribbonTop + ribbonH} L${rL + 35} ${ribbonTop + 30 + ribbonH} L${rL + 35} ${ribbonTop + ribbonH - 4} Z" fill="#6e1d44"/>
    <path d="M${rR} ${ribbonTop + ribbonH} L${rR - 35} ${ribbonTop + 30 + ribbonH} L${rR - 35} ${ribbonTop + ribbonH - 4} Z" fill="#6e1d44"/>
    <path d="M${rL} ${ribbonTop} Q${(rL + rR) / 2} ${ribbonTop - sag * 2} ${rR} ${ribbonTop} L${rR} ${ribbonTop + ribbonH} Q${(rL + rR) / 2} ${ribbonTop + ribbonH - sag * 2} ${rL} ${ribbonTop + ribbonH} Z" fill="url(#ribbon)"/>
  </g>
  <path d="M${rL + 14} ${ribbonTop + 14} Q${(rL + rR) / 2} ${ribbonTop - sag * 2 + 14} ${rR - 14} ${ribbonTop + 14}" fill="none" stroke="#ffffff" stroke-opacity=".45" stroke-width="5" stroke-linecap="round"/>`;

const ribbonR = ((rR - rL) / 2) ** 2 / (2 * sag) + sag / 2;
const company = arcWord("COMPANY", (rL + rR) / 2, ribbonTop + 72, 78, ribbonR, 10);

const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <filter id="soft" x="-10%" y="-10%" width="120%" height="140%"><feGaussianBlur stdDeviation="9"/></filter>
    <linearGradient id="goldFace" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fffbe6"/><stop offset=".36" stop-color="#ffe68a"/><stop offset=".42" stop-color="#ffd23f"/><stop offset="1" stop-color="#ff9a2a"/>
    </linearGradient>
    <linearGradient id="goldSide" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d9721e"/><stop offset="1" stop-color="#8a3a12"/></linearGradient>
    <linearGradient id="mintFace" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#f2fffb"/><stop offset=".36" stop-color="#b8f7e6"/><stop offset=".42" stop-color="#7fe0c3"/><stop offset="1" stop-color="#36b394"/>
    </linearGradient>
    <linearGradient id="mintSide" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#23866e"/><stop offset="1" stop-color="#11493f"/></linearGradient>
    <linearGradient id="ribbon" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffb0c9"/><stop offset=".5" stop-color="#ff7aa6"/><stop offset="1" stop-color="#d94f86"/></linearGradient>
  </defs>
  ${chunky("catthe", arcWord("CAT THE", 930, 235, 150, 1100, 4), { depth: 14, side: "mintSide", face: "mintFace", stroke: 8 })}
  ${chunky("mouse", arcWord("MOUSE", 930, 470, 230, 1500, 4), { depth: 20, side: "goldSide", face: "goldFace", stroke: 10 })}
  ${ribbon}
  <g fill="#ffffff" stroke="${INK}" stroke-width="7" stroke-linejoin="round" paint-order="stroke">${company}</g>
</svg>`;

// the 3D tabby (head and shoulders) and a mouse, rendered from the game's own models
const head = await sharp("art-src/renders/logo-head.png").trim({ threshold: 1 }).toBuffer();
const headH = 600;
const headBuf = await sharp(head).resize({ height: headH }).toBuffer();
const hm = await sharp(headBuf).metadata();
const cat = await sharp(headBuf).extract({ left: 0, top: 0, width: hm.width, height: Math.round(headH * 0.86) }).toBuffer();
const mouse = await sharp("art-src/renders/mouse.png").trim({ threshold: 1 }).resize({ height: 150 }).toBuffer();
const mm = await sharp(mouse).metadata();

mkdirSync("public/brand", { recursive: true });
const master = await sharp({ create: { width: W, height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
  .composite([
    { input: cat, left: 10, top: 90 },
    { input: Buffer.from(svg), left: 0, top: 0 },
    { input: mouse, left: rR + 30 - Math.round(mm.width / 2), top: ribbonTop - mm.height + 40 }
  ])
  .png()
  .toBuffer();
const trimmed = await sharp(master).trim({ threshold: 1 }).toBuffer();
await sharp(trimmed).png({ compressionLevel: 9 }).toFile("public/brand/logo-wordmark.png");
await sharp(trimmed).webp({ quality: 88, alphaQuality: 90, effort: 6 }).toFile("public/brand/logo-wordmark.webp");
await sharp(trimmed).resize({ width: 700 }).webp({ quality: 86, alphaQuality: 90, effort: 6 }).toFile("public/brand/logo-wordmark-sm.webp");
await sharp(trimmed).resize({ width: 700 }).png({ compressionLevel: 9, palette: true, quality: 92 }).toFile("public/brand/logo-wordmark-sm.png");
const meta = await sharp(trimmed).metadata();
console.log("wordmark", meta.width, meta.height);
