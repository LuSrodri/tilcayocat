// Renders an SVG to PNG for quick visual checks: node scripts/preview.mjs in.svg out.png [width]
import sharp from "sharp";
import { readFileSync } from "node:fs";

const [input, output, width = "600"] = process.argv.slice(2);
const svg = readFileSync(input);
await sharp(svg, { density: 200 })
  .flatten({ background: "#7db35a" })
  .resize(Number(width))
  .png()
  .toFile(output);
console.log("wrote", output);
