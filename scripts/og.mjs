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
      <stop offset="0" stop-color="#bfe3f3"/><stop offset="1" stop-color="#e8f4e2"/>
    </linearGradient>
    <linearGradient id="shade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fff" stop-opacity=".12"/><stop offset=".4" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".2"/>
    </linearGradient>
    <radialGradient id="holeG" cx="50%" cy="30%" r="70%">
      <stop offset="0" stop-color="#2c1a0e"/><stop offset="1" stop-color="#6b4a2b"/>
    </radialGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#sky)"/>
  <ellipse cx="200" cy="300" rx="420" ry="150" fill="#8fbf86"/>
  <ellipse cx="1000" cy="310" rx="460" ry="150" fill="#8fbf86"/>
  <ellipse cx="600" cy="330" rx="420" ry="120" fill="#6aa65a"/>
</svg>`;

const foreground = `
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="shade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fff" stop-opacity=".12"/><stop offset=".4" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".2"/>
    </linearGradient>
    <radialGradient id="holeG" cx="50%" cy="30%" r="70%">
      <stop offset="0" stop-color="#2c1a0e"/><stop offset="1" stop-color="#6b4a2b"/>
    </radialGradient>
  </defs>
  <rect y="290" width="${W}" height="340" fill="url(#shade)"/>
  <rect y="288" width="${W}" height="6" fill="#a4d67c"/>
  <text x="70" y="150" font-family="Arial, Helvetica, sans-serif" font-size="96" font-weight="700" fill="#a9541b" stroke="#fffaf1" stroke-width="10" paint-order="stroke" letter-spacing="-2">Tilcayo Cat</text>
  <text x="74" y="212" font-family="Arial, Helvetica, sans-serif" font-size="38" font-weight="700" fill="#1f1a16">Catch the mice · 5 seconds per catch</text>
  <text x="74" y="262" font-family="Arial, Helvetica, sans-serif" font-size="28" fill="#5b514a">Play as Leopardus tilcayo, the first new wild cat in 100+ years</text>
  <text x="74" y="590" font-family="Arial, Helvetica, sans-serif" font-size="30" font-weight="700" fill="#fffaf1" stroke="#3d6b2a" stroke-width="4" paint-order="stroke">tilcayo.cat</text>
  <ellipse cx="330" cy="520" rx="100" ry="36" fill="url(#holeG)"/>
  <ellipse cx="600" cy="560" rx="100" ry="36" fill="url(#holeG)"/>
</svg>`;

const holeLip = `
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <path d="M230 520 a100 36 0 0 0 200 0 a100 26 0 0 1 -200 0z" fill="#8a6136"/>
  <path d="M500 560 a100 36 0 0 0 200 0 a100 26 0 0 1 -200 0z" fill="#8a6136"/>
</svg>`;

// tiled grass band
const tile = await sharp("public/img/grass.jpg").resize(300, 300).toBuffer();
const grassBand = await sharp({ create: { width: W, height: 340, channels: 3, background: "#6fae4c" } })
  .composite([{ input: tile, tile: true, blend: "over" }])
  .png()
  .toBuffer();

const catBuf = await sharp("public/img/cat.png").resize({ height: 430 }).toBuffer();
const catMeta = await sharp(catBuf).metadata();
const mouseBuf = await sharp("public/img/mouse.png").resize({ width: 170 }).toBuffer();
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
    <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8fcc66"/><stop offset="1" stop-color="#4f8a37"/></linearGradient></defs>
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
