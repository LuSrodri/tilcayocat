// Generates the social preview image, favicon and PWA icons from the cat artwork.
// Run: npm run og
import sharp from "sharp";
import { readFileSync, writeFileSync } from "node:fs";

const cat = readFileSync("src/art/cat.svg", "utf8");
const mouse = readFileSync("src/art/mouse.svg", "utf8");

// Inline SVG fragments need unique ids when composed together; the cat and mouse don't collide.
const catInner = cat.replace(/<svg[^>]*>/, "").replace("</svg>", "");
const mouseInner = mouse.replace(/<svg[^>]*>/, "").replace("</svg>", "");

const og = `
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#bfe3f3"/><stop offset="1" stop-color="#e8f4e2"/>
    </linearGradient>
    <linearGradient id="grass" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#86c25f"/><stop offset=".4" stop-color="#6fae4c"/><stop offset="1" stop-color="#5a9640"/>
    </linearGradient>
    <radialGradient id="holeG" cx="50%" cy="30%" r="70%">
      <stop offset="0" stop-color="#2c1a0e"/><stop offset="1" stop-color="#6b4a2b"/>
    </radialGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#sky)"/>
  <ellipse cx="200" cy="300" rx="420" ry="150" fill="#8fbf86"/>
  <ellipse cx="1000" cy="310" rx="460" ry="150" fill="#8fbf86"/>
  <ellipse cx="600" cy="330" rx="420" ry="120" fill="#6aa65a"/>
  <rect y="290" width="1200" height="340" fill="url(#grass)"/>
  <rect y="288" width="1200" height="6" fill="#86c25f"/>

  <!-- title -->
  <text x="70" y="150" font-family="Arial, Helvetica, sans-serif" font-size="96" font-weight="700" fill="#a9541b" stroke="#fffaf1" stroke-width="10" paint-order="stroke" letter-spacing="-2">Tilcayo Cat</text>
  <text x="74" y="212" font-family="Arial, Helvetica, sans-serif" font-size="38" font-weight="700" fill="#1f1a16">Catch the mice · 5 seconds per catch</text>
  <text x="74" y="262" font-family="Arial, Helvetica, sans-serif" font-size="28" fill="#5b514a">Play as Leopardus tilcayo, the first new wild cat in 100+ years</text>
  <text x="74" y="590" font-family="Arial, Helvetica, sans-serif" font-size="30" font-weight="700" fill="#fffaf1">tilcayo.cat</text>

  <!-- holes -->
  <g>
    <ellipse cx="300" cy="500" rx="90" ry="34" fill="url(#holeG)"/>
    <path d="M210 500 a90 34 0 0 0 180 0 a90 26 0 0 1 -180 0z" fill="#8a6136"/>
    <ellipse cx="560" cy="540" rx="90" ry="34" fill="url(#holeG)"/>
    <path d="M470 540 a90 34 0 0 0 180 0 a90 26 0 0 1 -180 0z" fill="#8a6136"/>
  </g>
  <!-- mouse peeking from the first hole -->
  <g transform="translate(240 402) scale(1.05)">${mouseInner}</g>
  <path d="M210 500 a90 34 0 0 0 180 0 a90 26 0 0 1 -180 0z" fill="#8a6136"/>
  <!-- cat -->
  <g transform="translate(780 215) scale(0.98)">${catInner}</g>
</svg>`;

await sharp(Buffer.from(og), { density: 96 }).png({ compressionLevel: 9 }).toFile("public/og.png");

// Icon: head-and-shoulders crop of the cat on a grass disc.
const icon = (size, pad) => `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#86c25f"/><stop offset="1" stop-color="#5a9640"/></linearGradient>
    <clipPath id="round"><rect width="512" height="512" rx="${pad ? 0 : 110}"/></clipPath>
  </defs>
  <g clip-path="url(#round)">
    <rect width="512" height="512" fill="url(#bg)"/>
    <g transform="translate(${pad ? 76 : 36} ${pad ? 90 : 60}) scale(${pad ? 0.9 : 1.1})">${catInner}</g>
  </g>
</svg>`;

await sharp(Buffer.from(icon(512, false))).png().toFile("public/icon-512.png");
await sharp(Buffer.from(icon(512, true))).png().toFile("public/icon-512-maskable.png");
await sharp(Buffer.from(icon(192, false))).png().toFile("public/icon-192.png");
await sharp(Buffer.from(icon(180, false))).png().toFile("public/apple-touch-icon.png");
const png32 = await sharp(Buffer.from(icon(32, false))).png().toBuffer();
// A PNG-in-ICO container: supported by every current browser.
writeFileSync("public/favicon.ico", pngToIco(png32, 32));
writeFileSync("public/favicon.svg", icon(64, false).trim() + "\n");

function pngToIco(png, size) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);
  const entry = Buffer.alloc(16);
  entry.writeUInt8(size, 0);
  entry.writeUInt8(size, 1);
  entry.writeUInt8(0, 2);
  entry.writeUInt8(0, 3);
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(png.length, 8);
  entry.writeUInt32LE(22, 12);
  return Buffer.concat([header, entry, png]);
}

console.log("generated og.png, icons, favicon");
