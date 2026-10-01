// Logo, favicons and PWA icons from the 3D grey tabby (art-src/renders/logo-head.png, rendered
// from src/engine/models.ts with a transparent background).
// Run: npm run og
import sharp from "sharp";
import { writeFileSync } from "node:fs";

const HEAD = "art-src/renders/logo-head.png";

// the head with its transparent margins trimmed away
const head = await sharp(HEAD).trim({ threshold: 1 }).toBuffer();

// Icons: the tabby's head and chest on a dusk-purple square, a little mouse peeking at the corner.
async function icon(size, maskable) {
  const rx = maskable ? 0 : Math.round(size * 0.22);
  const bg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6a4a86"/><stop offset=".55" stop-color="#3d2c52"/><stop offset="1" stop-color="#241a30"/></linearGradient>
      <radialGradient id="glow" cx="50%" cy="40%" r="55%"><stop offset="0" stop-color="#ffd66b" stop-opacity=".35"/><stop offset="1" stop-color="#ffd66b" stop-opacity="0"/></radialGradient>
    </defs>
    <rect width="${size}" height="${size}" rx="${rx}" fill="url(#g)"/>
    <rect width="${size}" height="${size}" rx="${rx}" fill="url(#glow)"/></svg>`;
  const scale = maskable ? 0.72 : 0.92;
  const w = Math.round(size * scale);
  const cat = await sharp(head).resize({ width: w }).toBuffer();
  const m = await sharp(cat).metadata();
  const top = Math.round(size * (maskable ? 0.16 : 0.1));
  const h = Math.min(m.height, size - top);
  const cropped = await sharp(cat).extract({ left: 0, top: 0, width: m.width, height: h }).toBuffer();
  let img = sharp(Buffer.from(bg)).composite([{ input: cropped, top, left: Math.round((size - m.width) / 2) }]);
  if (!maskable && size >= 64) {
    // round the bottom corners off again after the cat overflows them
    const mask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${rx}" fill="#fff"/></svg>`);
    img = sharp(await img.png().toBuffer()).composite([{ input: mask, blend: "dest-in" }]);
  }
  return img.png();
}

await (await icon(512, false)).toFile("public/icon-512.png");
await (await icon(512, true)).toFile("public/icon-512-maskable.png");
await (await icon(192, false)).toFile("public/icon-192.png");
await (await icon(180, true)).toFile("public/apple-touch-icon.png");
const png32 = await (await icon(32, false)).toBuffer();
writeFileSync("public/favicon.ico", pngToIco(png32, 32));
const png64 = await (await icon(64, false)).toBuffer();
writeFileSync(
  "public/favicon.svg",
  `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><image width="64" height="64" href="data:image/png;base64,${png64.toString("base64")}"/></svg>\n`
);

// logo.svg: just the head, no backdrop (used next to the title on the start screen)
const logo = await sharp(head).resize({ width: 160 }).png({ compressionLevel: 9 }).toBuffer();
const lm = await sharp(logo).metadata();
writeFileSync(
  "public/logo.svg",
  `<svg xmlns="http://www.w3.org/2000/svg" width="${lm.width}" height="${lm.height}" viewBox="0 0 ${lm.width} ${lm.height}"><image width="${lm.width}" height="${lm.height}" href="data:image/png;base64,${logo.toString("base64")}"/></svg>\n`
);
await sharp(head).resize({ width: 512 }).png({ compressionLevel: 9 }).toFile("public/logo.png");

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

console.log("generated logo, icons and favicon");
