// The Cat The Mouse Company wordmark ("badge" design, picked 2026-10-01): "CAT THE MOUSE" in
// chunky cartoon letters (Fredoka Bold with an ink outline, extrusion and a glossy gold face)
// inside a dusk-purple badge with cat ears and a tail, a little mouse peeking over the top edge
// and "COMPANY" underneath. All vector, flattened to small images so the pages stay light.
//   - public/brand/logo-wordmark.{png,webp}      master, transparent
//   - public/brand/logo-wordmark-sm.{webp,png}   700 wide, for the start screen and headers
// Run: npm run logo
import sharp from "sharp";
import opentype from "opentype.js";
import { mkdirSync } from "node:fs";

const INK = "#2e1a26";
const font = opentype.loadSync("art-src/fonts/Fredoka-Bold.ttf");

// a word on a straight or gently arched baseline; returns svg paths + each glyph's box
function word(text, cx, baseline, size, { arc = 0, tracking = 0 } = {}) {
  const glyphs = font.stringToGlyphs(text);
  const scale = size / font.unitsPerEm;
  const adv = glyphs.map((g) => g.advanceWidth * scale + tracking);
  const total = adv.reduce((a, b) => a + b, 0) - tracking;
  let x = cx - total / 2;
  let svg = "";
  const boxes = [];
  glyphs.forEach((g, i) => {
    const w = g.advanceWidth * scale;
    const mid = x + w / 2;
    const dx = mid - cx;
    const drop = arc ? arc - Math.sqrt(arc * arc - dx * dx) : 0;
    const ang = arc ? (Math.asin(dx / arc) * 180) / Math.PI : 0;
    const p = g.getPath(x, baseline, size);
    const bb = p.getBoundingBox();
    const d = p.toPathData(2);
    if (d) svg += `<path d="${d}" transform="rotate(${ang.toFixed(2)} ${mid.toFixed(1)} ${baseline}) translate(0 ${drop.toFixed(1)})"/>`;
    boxes.push({ x1: bb.x1, x2: bb.x2, y1: bb.y1 + drop, y2: bb.y2 + drop, mid, ang });
    x += adv[i];
  });
  return { svg, boxes, width: total };
}

const defs = `
  <filter id="soft" x="-10%" y="-10%" width="120%" height="140%"><feGaussianBlur stdDeviation="8"/></filter>
  <linearGradient id="goldFace" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff7d6"/><stop offset=".4" stop-color="#ffe17a"/><stop offset=".46" stop-color="#ffcc3a"/><stop offset="1" stop-color="#ff9a2a"/></linearGradient>
  <linearGradient id="goldSide" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d8691c"/><stop offset="1" stop-color="#8a3510"/></linearGradient>
  <linearGradient id="creamFace" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset=".45" stop-color="#fff4e2"/><stop offset=".5" stop-color="#ffe6c4"/><stop offset="1" stop-color="#ffcf9a"/></linearGradient>
  <linearGradient id="creamSide" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c77a3a"/><stop offset="1" stop-color="#7a3c18"/></linearGradient>
  <linearGradient id="grey" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c9cbd2"/><stop offset="1" stop-color="#8f929b"/></linearGradient>
  <linearGradient id="badge" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5a3f78"/><stop offset="1" stop-color="#2c1f3d"/></linearGradient>
  <radialGradient id="eye" cx="45%" cy="40%" r="60%"><stop offset="0" stop-color="#e6f5a0"/><stop offset=".6" stop-color="#a9cf4a"/><stop offset="1" stop-color="#5f8a24"/></radialGradient>`;

// thick ink outline around the whole extruded block, side layers, then the glossy face
function chunky(id, paths, depth, face, side, stroke = 9) {
  const layers = [];
  for (let i = depth; i >= 1; i--) layers.push(`<use href="#${id}" transform="translate(${(i * 0.35).toFixed(2)} ${i})"/>`);
  return `<g id="${id}">${paths}</g>
  <g fill="${INK}" opacity=".45" filter="url(#soft)"><use href="#${id}" transform="translate(${depth * 0.35 + 4} ${depth + 12})"/></g>
  <g fill="${INK}" stroke="${INK}" stroke-width="${stroke * 2}" stroke-linejoin="round">${layers.join("")}<use href="#${id}"/></g>
  <g fill="url(#${side})">${layers.join("")}</g>
  <use href="#${id}" fill="url(#${face})"/>`;
}

// a little grey mouse peeking over an edge (its paws rest on y = edge)
function mouse(cx, edge, r, tilt = 0) {
  const s = (v) => (v * r).toFixed(1);
  const cy = edge - 0.55 * r;
  return `<g transform="rotate(${tilt} ${cx} ${edge})">
    ${[-1, 1].map((sd) => `<circle cx="${cx + sd * 0.62 * r}" cy="${cy - 0.62 * r}" r="${s(0.42)}" fill="#a39ca6" stroke="${INK}" stroke-width="${s(0.07)}"/><circle cx="${cx + sd * 0.62 * r}" cy="${cy - 0.62 * r}" r="${s(0.26)}" fill="#f4a3b0"/>`).join("")}
    <ellipse cx="${cx}" cy="${cy}" rx="${s(0.72)}" ry="${s(0.62)}" fill="#a39ca6" stroke="${INK}" stroke-width="${s(0.07)}"/>
    <ellipse cx="${cx}" cy="${cy + 0.2 * r}" rx="${s(0.32)}" ry="${s(0.22)}" fill="#efe3d6"/>
    ${[-1, 1].map((sd) => `<circle cx="${cx + sd * 0.26 * r}" cy="${cy - 0.08 * r}" r="${s(0.1)}" fill="#1a1015"/><circle cx="${cx + sd * 0.26 * r + 0.03 * r}" cy="${cy - 0.12 * r}" r="${s(0.035)}" fill="#fff"/>`).join("")}
    <circle cx="${cx}" cy="${cy + 0.12 * r}" r="${s(0.08)}" fill="#ff8fa3"/>
    ${[-1, 1].map((sd) => `<ellipse cx="${cx + sd * 0.36 * r}" cy="${edge - 0.02 * r}" rx="${s(0.17)}" ry="${s(0.12)}" fill="#f4a3b0" stroke="${INK}" stroke-width="${s(0.05)}"/>`).join("")}
  </g>`;
}

function tail(x, y, size, color = "url(#goldFace)") {
  const d = `M${x} ${y} C${x + size * 0.6} ${y + size * 0.1} ${x + size * 0.9} ${y - size * 0.5} ${x + size * 0.55} ${y - size * 0.85} C${x + size * 0.35} ${y - size * 1.05} ${x + size * 0.1} ${y - size * 0.85} ${x + size * 0.3} ${y - size * 0.7}`;
  return `<path d="${d}" fill="none" stroke="${INK}" stroke-width="${size * 0.26}" stroke-linecap="round"/>
    <path d="${d}" fill="none" stroke="${color}" stroke-width="${size * 0.15}" stroke-linecap="round"/>`;
}

function paw(cx, cy, r, color = "#ffd66b") {
  return `<g fill="${color}"><ellipse cx="${cx}" cy="${cy + 0.25 * r}" rx="${r * 0.55}" ry="${r * 0.45}"/>${[[-0.55, -0.25], [-0.2, -0.55], [0.2, -0.55], [0.55, -0.25]].map(([dx, dy]) => `<circle cx="${cx + dx * r}" cy="${cy + dy * r}" r="${r * 0.2}"/>`).join("")}</g>`;
}

async function render(W, H, body) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><defs>${defs}</defs>${body}</svg>`;
  mkdirSync("public/brand", { recursive: true });
  const trimmed = await sharp(await sharp(Buffer.from(svg)).png().toBuffer()).trim({ threshold: 1 }).toBuffer();
  await sharp(trimmed).png({ compressionLevel: 9 }).toFile("public/brand/logo-wordmark.png");
  await sharp(trimmed).webp({ quality: 90, alphaQuality: 92, effort: 6 }).toFile("public/brand/logo-wordmark.webp");
  await sharp(trimmed).resize({ width: 700 }).webp({ quality: 90, alphaQuality: 92, effort: 6 }).toFile("public/brand/logo-wordmark-sm.webp");
  await sharp(trimmed).resize({ width: 700 }).png({ compressionLevel: 9, palette: true, quality: 95 }).toFile("public/brand/logo-wordmark-sm.png");
  const m = await sharp(trimmed).metadata();
  const sm = await sharp("public/brand/logo-wordmark-sm.png").metadata();
  console.log("wordmark", m.width, m.height, "small", sm.width, sm.height);
}

{
  const W = 1500, H = 640;
  const line = word("CAT THE MOUSE", 750, 330, 150, { tracking: 4 });
  const bw = line.width + 140;
  const bx = 750 - bw / 2;
  const by = 160;
  const bh = 230;
  const ears = [bx + 90, bx + bw - 90].map((x, i) => {
    const s = i ? -1 : 1;
    return `<path d="M${x - s * 40} ${by + 20} L${x - s * 10} ${by - 90} L${x + s * 70} ${by + 6} Z" fill="url(#badge)" stroke="${INK}" stroke-width="12" stroke-linejoin="round"/><path d="M${x - s * 18} ${by + 4} L${x - s * 4} ${by - 52} L${x + s * 40} ${by + 2} Z" fill="#f4a9b6"/>`;
  }).join("");
  const company = word("COMPANY", 750, by + bh + 108, 70, { tracking: 30 });
  await render(W, H, `
    <g filter="url(#soft)" opacity=".5"><rect x="${bx + 8}" y="${by + 22}" width="${bw}" height="${bh}" rx="110" fill="${INK}"/></g>
    ${ears}
    <rect x="${bx}" y="${by}" width="${bw}" height="${bh}" rx="110" fill="url(#badge)" stroke="${INK}" stroke-width="12"/>
    <rect x="${bx + 16}" y="${by + 16}" width="${bw - 32}" height="${bh - 32}" rx="96" fill="none" stroke="#ffd66b" stroke-opacity=".55" stroke-width="5"/>
    ${chunky("c1", line.svg, 12, "goldFace", "goldSide", 8)}
    ${tail(bx + bw - 30, by + bh - 40, 110, "url(#badge)")}
    ${mouse(bx + bw - 240, by + 8, 50, -4)}
    <g fill="#7fe0c3" stroke="${INK}" stroke-width="12" stroke-linejoin="round" paint-order="stroke">${company.svg}</g>
    ${paw(750 - company.width / 2 - 60, by + bh + 84, 28, "#7fe0c3")}${paw(750 + company.width / 2 + 60, by + bh + 84, 28, "#7fe0c3")}
  `);
}
