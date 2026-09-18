// One-off: trims, resizes and optimizes the raster art into public/img.
// Usage: node scripts/assets.mjs <cat.png> <mouse.png> <grass.png>
import sharp from "sharp";
import { mkdirSync } from "node:fs";

const [catSrc, mouseSrc, grassSrc] = process.argv.slice(2);
mkdirSync("public/img", { recursive: true });

async function sprite(src, name, width) {
  const base = sharp(src).trim({ threshold: 8 }).resize({ width, withoutEnlargement: true });
  await base.clone().webp({ quality: 88, alphaQuality: 90, effort: 6 }).toFile(`public/img/${name}.webp`);
  await base.clone().png({ compressionLevel: 9, palette: true, quality: 90 }).toFile(`public/img/${name}.png`);
  const m = await sharp(`public/img/${name}.png`).metadata();
  console.log(name, m.width, m.height);
}

await sprite(catSrc, "cat", 720);
await sprite(mouseSrc, "mouse", 420);

const grass = sharp(grassSrc).resize(512, 512, { fit: "cover" });
await grass.clone().webp({ quality: 82, effort: 6 }).toFile("public/img/grass.webp");
await grass.clone().jpeg({ quality: 84, mozjpeg: true }).toFile("public/img/grass.jpg");
console.log("grass 512x512");
