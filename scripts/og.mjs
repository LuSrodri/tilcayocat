// Generates the social preview image, favicon and PWA icons from the raster artwork in public/img.
// Run: npm run og
import sharp from "sharp";
import { writeFileSync } from "node:fs";

const W = 1200;
const H = 630;

const background = `
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#070b1c"/><stop offset=".6" stop-color="#101a3a"/><stop offset="1" stop-color="#1d2f55"/>
    </linearGradient>
    <radialGradient id="moon" cx="38%" cy="36%" r="60%">
      <stop offset="0" stop-color="#fffdf0"/><stop offset=".55" stop-color="#f6f0d6"/><stop offset="1" stop-color="#d9d0aa"/>
    </radialGradient>
    <radialGradient id="glow" cx="50%" cy="50%" r="50%">
      <stop offset="0" stop-color="#f6f0d6" stop-opacity=".45"/><stop offset="1" stop-color="#f6f0d6" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="shade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fff" stop-opacity=".12"/><stop offset=".4" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".2"/>
    </linearGradient>
    <radialGradient id="holeG" cx="50%" cy="30%" r="70%">
      <stop offset="0" stop-color="#2c1a0e"/><stop offset="1" stop-color="#6b4a2b"/>
    </radialGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#sky)"/>
  <g fill="#fff">
    <circle cx="90" cy="60" r="1.4"/><circle cx="240" cy="30" r="1"/><circle cx="410" cy="80" r="1.6"/><circle cx="520" cy="40" r="1"/>
    <circle cx="700" cy="70" r="1.3"/><circle cx="830" cy="28" r="1"/><circle cx="960" cy="90" r="1.5"/><circle cx="1120" cy="50" r="1"/>
    <circle cx="160" cy="120" r="1"/><circle cx="620" cy="130" r="1.2"/><circle cx="880" cy="150" r="1"/><circle cx="1180" cy="120" r="1.3"/>
    <circle cx="330" cy="160" r="1"/><circle cx="760" cy="180" r="1"/><circle cx="1040" cy="200" r="1.1"/>
  </g>
  <circle cx="1040" cy="110" r="150" fill="url(#glow)"/>
  <circle cx="1040" cy="110" r="52" fill="url(#moon)"/>
  <ellipse cx="200" cy="300" rx="420" ry="150" fill="#17263f"/>
  <ellipse cx="1000" cy="310" rx="460" ry="150" fill="#17263f"/>
  <ellipse cx="600" cy="330" rx="420" ry="120" fill="#0f1d2e"/>
</svg>`;

const foreground = `
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="shade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#080e28" stop-opacity=".55"/><stop offset=".4" stop-color="#060a1e" stop-opacity=".62"/><stop offset="1" stop-color="#030614" stop-opacity=".8"/>
    </linearGradient>
    <radialGradient id="holeG" cx="50%" cy="30%" r="70%">
      <stop offset="0" stop-color="#120b06"/><stop offset="1" stop-color="#3a2a1a"/>
    </radialGradient>
  </defs>
  <rect y="290" width="${W}" height="340" fill="url(#shade)"/>
  <rect y="288" width="${W}" height="4" fill="#78aa6e" fill-opacity=".5"/>
  <text x="70" y="150" font-family="Arial Black, Arial, Helvetica, sans-serif" font-size="84" font-weight="900" fill="#f0903f" letter-spacing="-2">Tilcayo Cat Game</text>
  <text x="74" y="212" font-family="Arial, Helvetica, sans-serif" font-size="36" font-weight="700" fill="#f2ecdf">A new cat discovered after 100+ years</text>
  <text x="74" y="260" font-family="Arial, Helvetica, sans-serif" font-size="26" fill="#b7b0a2">Be Leopardus tilcayo. Catch the mice · 5 seconds per catch</text>
  <text x="74" y="590" font-family="Arial, Helvetica, sans-serif" font-size="30" font-weight="700" fill="#f2ecdf">tilcayo.cat</text>
  <ellipse cx="330" cy="520" rx="100" ry="36" fill="url(#holeG)"/>
  <ellipse cx="600" cy="560" rx="100" ry="36" fill="url(#holeG)"/>
</svg>`;

const holeLip = `
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <path d="M230 520 a100 36 0 0 0 200 0 a100 26 0 0 1 -200 0z" fill="#5a4229"/>
  <path d="M500 560 a100 36 0 0 0 200 0 a100 26 0 0 1 -200 0z" fill="#5a4229"/>
</svg>`;

// tiled grass band
const tile = await sharp("public/img/grass.jpg").resize(300, 300).toBuffer();
const grassBand = await sharp({ create: { width: W, height: 340, channels: 3, background: "#6fae4c" } })
  .composite([{ input: tile, tile: true, blend: "over" }])
  .png()
  .toBuffer();

const catBuf = await sharp("public/img/cat.png").resize({ height: 430 }).modulate({ brightness: 0.9, saturation: 0.92 }).toBuffer();
const catMeta = await sharp(catBuf).metadata();
const mouseBuf = await sharp("public/img/mouse.png").resize({ width: 170 }).modulate({ brightness: 0.92 }).toBuffer();
const mouseMeta = await sharp(mouseBuf).metadata();

await sharp(Buffer.from(background))
  .composite([
    { input: grassBand, top: 290, left: 0 },
    { input: Buffer.from(foreground), top: 0, left: 0 },
    { input: mouseBuf, top: 520 - mouseMeta.height + 20, left: 330 - Math.round(mouseMeta.width / 2) },
    { input: Buffer.from(holeLip), top: 0, left: 0 },
    { input: catBuf, top: H - catMeta.height - 30, left: 1150 - catMeta.width }
  ])
  .png({ compressionLevel: 9 })
  .toFile("public/og.png");

// Icons: cat head-and-shoulders on a grass square.
async function icon(size, maskable) {
  const rx = maskable ? 0 : Math.round(size * 0.21);
  const bg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
    <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1d2f55"/><stop offset="1" stop-color="#070b1c"/></linearGradient></defs>
    <rect width="${size}" height="${size}" rx="${rx}" fill="url(#g)"/></svg>`;
  const scale = maskable ? 0.78 : 0.98;
  const catH = Math.round(size * scale * 1.55);
  const cat = await sharp("public/img/cat.png").resize({ height: catH }).toBuffer();
  const m = await sharp(cat).metadata();
  // crop to the top of the cat (head + chest), centred horizontally
  const cropW = Math.min(m.width, size);
  const cropped = await sharp(cat)
    .extract({ left: Math.round((m.width - cropW) / 2), top: 0, width: cropW, height: Math.min(m.height, size) })
    .toBuffer();
  const cm = await sharp(cropped).metadata();
  return sharp(Buffer.from(bg))
    .composite([{ input: cropped, top: size - cm.height, left: Math.round((size - cm.width) / 2) }])
    .png();
}

await (await icon(512, false)).toFile("public/icon-512.png");
await (await icon(512, true)).toFile("public/icon-512-maskable.png");
await (await icon(192, false)).toFile("public/icon-192.png");
await (await icon(180, false)).toFile("public/apple-touch-icon.png");
const png32 = await (await icon(32, false)).toBuffer();
writeFileSync("public/favicon.ico", pngToIco(png32, 32));
const png64 = await (await icon(64, false)).toBuffer();
writeFileSync(
  "public/favicon.svg",
  `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><image width="64" height="64" href="data:image/png;base64,${png64.toString("base64")}"/></svg>\n`
);

function pngToIco(png, size) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);
  const entry = Buffer.alloc(16);
  entry.writeUInt8(size, 0);
  entry.writeUInt8(size, 1);
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(png.length, 8);
  entry.writeUInt32LE(22, 12);
  return Buffer.concat([header, entry, png]);
}

console.log("generated og.png, icons, favicon");
