// Social images from the painted key art (art-src/keyart.png, art-src/card-bg.png):
//  - public/tilcayo-cat-og-v2.jpg      the site-wide Open Graph / X card
//  - public/og/beat-<rank>.jpg         challenge cards served for ?beat=N links (functions/_middleware.ts)
//  - public/img/card-bg.{webp,jpg}     backdrop for the in-game share card
// Run: npm run social
import sharp from "sharp";
import { mkdirSync } from "node:fs";

const W = 1200;
const H = 630;

// keep in sync with src/rank.ts
const RANKS = [
  { id: "kitten", name: "Sleepy Kitten", tint: ["#e8e2f5", "#8b93b8"] },
  { id: "cub", name: "Curious Cub", tint: ["#c8ffd4", "#2f9e57"] },
  { id: "prowler", name: "Lawn Prowler", tint: ["#bff3ff", "#2f6bb3"] },
  { id: "hunter", name: "Night Hunter", tint: ["#ffe27a", "#e0641f"] },
  { id: "stalker", name: "Shadow Stalker", tint: ["#ffc0e6", "#b02a7a"] },
  { id: "legend", name: "Yungas Legend", tint: ["#cffff3", "#0d7a6b"] },
  { id: "mythic", name: "Mythic Tilcayo", tint: ["#fff6c9", "#c9851a"] }
];

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

function overlay({ kicker, line1, line2, sub, pill, badge, pillColor = "#ff9f2e" }) {
  const badgeSvg = badge
    ? `<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${badge.tint[0]}"/><stop offset="1" stop-color="${badge.tint[1]}"/></linearGradient></defs>
       <rect x="64" y="392" width="${badge.name.length * 18 + 150}" height="62" rx="31" fill="url(#bg)"/>
       <text x="92" y="433" font-family="Arial Black, Arial, sans-serif" font-size="17" font-weight="900" fill="#140a04" fill-opacity=".7" letter-spacing="2">RANK</text>
       <text x="160" y="434" font-family="Arial Black, Arial, sans-serif" font-size="27" font-weight="900" fill="#140a04">${esc(badge.name)}</text>`
    : "";
  return Buffer.from(`
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="fade" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#050718" stop-opacity=".92"/>
      <stop offset=".38" stop-color="#050718" stop-opacity=".7"/>
      <stop offset=".62" stop-color="#050718" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="gold" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fff3c4"/><stop offset=".5" stop-color="#ffd84a"/><stop offset="1" stop-color="#ff9f2e"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#fade)"/>
  <text x="66" y="104" font-family="Arial Black, Arial, sans-serif" font-size="21" font-weight="900" fill="#3ef2d0" letter-spacing="3">${esc(kicker)}</text>
  <g font-family="Arial Black, Arial, sans-serif" font-weight="900" letter-spacing="-2">
    <text x="62" y="208" font-size="98" fill="#1a0d05" fill-opacity=".55" dx="4" dy="6">${esc(line1)}</text>
    <text x="62" y="208" font-size="98" fill="url(#gold)">${esc(line1)}</text>
    <text x="62" y="312" font-size="98" fill="#1a0d05" fill-opacity=".55" dx="4" dy="6">${esc(line2)}</text>
    <text x="62" y="312" font-size="98" fill="url(#gold)">${esc(line2)}</text>
  </g>
  <text x="66" y="366" font-family="Arial, sans-serif" font-size="27" font-weight="700" fill="#fff7ea">${esc(sub)}</text>
  ${badgeSvg}
  <rect x="64" y="${badge ? 486 : 420}" width="${pill.length * 15.5 + 64}" height="64" rx="32" fill="${pillColor}"/>
  <text x="96" y="${badge ? 528 : 462}" font-family="Arial Black, Arial, sans-serif" font-size="26" font-weight="900" fill="#1a0d05">${esc(pill)}</text>
</svg>`);
}

// crop the 16:9 key art to 1.91:1
const art = await sharp("art-src/keyart.png").resize(W, H, { fit: "cover", position: "centre" }).modulate({ saturation: 1.08 }).toBuffer();

async function social(file, spec) {
  await sharp(art)
    .composite([{ input: overlay(spec) }])
    .jpeg({ quality: 86, mozjpeg: true })
    .toFile(file);
}

await social("public/tilcayo-cat-og-v2.jpg", {
  kicker: "A NEW CAT DISCOVERED AFTER 100+ YEARS",
  line1: "TILCAYO",
  line2: "CAT GAME",
  sub: "Catch mice. Chain combos. Beat friends.",
  pill: "▶ PLAY FREE · tilcayo.cat"
});

mkdirSync("public/og", { recursive: true });
for (const rank of RANKS) {
  await social(`public/og/beat-${rank.id}.jpg`, {
    kicker: "YOU'VE BEEN CHALLENGED",
    line1: "CAN YOU",
    line2: "BEAT ME?",
    sub: "Tap the mice before the clock runs out.",
    badge: rank,
    pill: "▶ ACCEPT · tilcayo.cat",
    pillColor: "#3ef2d0"
  });
}

// share-card backdrop: 1080 wide keeps the canvas crisp without shipping the 1.5k original
const card = sharp("art-src/card-bg.png").resize({ width: 1080 });
await card.clone().webp({ quality: 80 }).toFile("public/img/card-bg.webp");
await card.clone().jpeg({ quality: 82, mozjpeg: true }).toFile("public/img/card-bg.jpg");

console.log("generated social images and card backdrop");
