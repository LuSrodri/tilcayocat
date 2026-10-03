// Text-free ad images (Google Search and Demand Gen reject text or logos laid over the picture):
//   node scripts/ads-clean.mjs <16x9 clean frame> <9x16 clean frame>
// Frames come from tools/trailer.html?clean&at=<s>. Writes marketing/ads/clean-*.jpg.
import sharp from "sharp";

const [wide, tall] = process.argv.slice(2);
const out = "marketing/ads";
const crop = async (src, name, w, h, zoom, cx, cy) => {
  const m = await sharp(src).metadata();
  const cw = Math.round(Math.min(m.width, (m.height * w) / h) * zoom);
  const ch = Math.round((cw * h) / w);
  const left = Math.max(0, Math.min(m.width - cw, Math.round(m.width * cx - cw / 2)));
  const top = Math.max(0, Math.min(m.height - ch, Math.round(m.height * cy - ch / 2)));
  await sharp(src).extract({ left, top, width: cw, height: ch }).resize(w, h).modulate({ saturation: 1.08 }).jpeg({ quality: 90, mozjpeg: true }).toFile(`${out}/${name}`);
  console.log("wrote", name);
};
await crop(wide, "clean-landscape-1200x628.jpg", 1200, 628, 0.9, 0.5, 0.45);
await crop(wide, "clean-square-1200x1200.jpg", 1200, 1200, 0.85, 0.6, 0.45);
await crop(tall, "clean-portrait-960x1200.jpg", 960, 1200, 1, 0.5, 0.4);
