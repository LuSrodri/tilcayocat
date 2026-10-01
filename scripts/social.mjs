// Social images: the 3D cats (art-src/renders/*.png, rendered from src/engine/models.ts) lined up
// on a moonlit lawn under the painted sky (art-src/sky.png):
//  - public/catthemouse-og.jpg         the site-wide Open Graph / X card
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
  { id: "legend", name: "Lawn Legend", tint: ["#cffff3", "#0d7a6b"] },
  { id: "mythic", name: "Mythic Mouser", tint: ["#fff6c9", "#c9851a"] }
];

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

function overlay({ kicker, line1, line2, sub, pill, badge, pillColor = "#ff9f2e" }) {
  // Arial Black is ~0.72em per capital: keep the longest line inside the left 600 px
  const fs = Math.min(98, Math.floor(600 / (Math.max(line1.length, line2.length) * 0.72)));
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
    <text x="62" y="208" font-size="${fs}" fill="#1a0d05" fill-opacity=".55" dx="4" dy="6">${esc(line1)}</text>
    <text x="62" y="208" font-size="${fs}" fill="url(#gold)">${esc(line1)}</text>
    <text x="62" y="312" font-size="${fs}" fill="#1a0d05" fill-opacity=".55" dx="4" dy="6">${esc(line2)}</text>
    <text x="62" y="312" font-size="${fs}" fill="url(#gold)">${esc(line2)}</text>
  </g>
  <text x="66" y="366" font-family="Arial, sans-serif" font-size="27" font-weight="700" fill="#fff7ea">${esc(sub)}</text>
  ${badgeSvg}
  <rect x="64" y="${badge ? 486 : 420}" width="${pill.length * 15.5 + 64}" height="64" rx="32" fill="${pillColor}"/>
  <text x="96" y="${badge ? 528 : 462}" font-family="Arial Black, Arial, sans-serif" font-size="26" font-weight="900" fill="#1a0d05">${esc(pill)}</text>
</svg>`);
}

// the backdrop: sky, a soft lawn, and the company of cats with the grey tabby up front
const sky = await sharp("art-src/sky.png").resize(W, H, { fit: "cover", position: "top" }).modulate({ saturation: 1.05 }).toBuffer();
const lawn = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs>
    <linearGradient id="grass" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5f9f4c"/><stop offset="1" stop-color="#2f5a2a"/></linearGradient>
    <radialGradient id="hole" cx="50%" cy="40%" r="60%"><stop offset="0" stop-color="#0a0608"/><stop offset=".7" stop-color="#2a1a12"/><stop offset="1" stop-color="#6b4630"/></radialGradient>
  </defs>
  <ellipse cx="760" cy="760" rx="820" ry="330" fill="url(#grass)"/>
  <ellipse cx="1080" cy="560" rx="62" ry="20" fill="#8a5a3a"/><ellipse cx="1080" cy="560" rx="50" ry="14" fill="url(#hole)"/>
  <ellipse cx="610" cy="590" rx="62" ry="20" fill="#8a5a3a"/><ellipse cx="610" cy="590" rx="50" ry="14" fill="url(#hole)"/>
</svg>`);
const trimmed = async (file, height) => sharp(await sharp(file).trim({ threshold: 1 }).toBuffer()).resize({ height }).toBuffer();
const placed = async (file, height, cx, bottom) => {
  const buf = await trimmed(file, height);
  const m = await sharp(buf).metadata();
  return { input: buf, left: Math.round(cx - m.width / 2), top: Math.round(bottom - m.height) };
};
const crew = [
  await placed("art-src/renders/cat-black.png", 165, 585, 455),
  await placed("art-src/renders/cat-calico.png", 175, 1125, 450),
  await placed("art-src/renders/cat-badger.png", 225, 725, 470),
  await placed("art-src/renders/cat-tilcayo.png", 225, 1015, 470),
  await placed("art-src/renders/cat-orange.png", 195, 625, 535),
  await placed("art-src/renders/cat-white.png", 195, 1140, 545),
  await placed("art-src/renders/cat-grey-pounce.png", 400, 880, 630),
  await placed("art-src/renders/mouse.png", 70, 1080, 562)
];
const art = await sharp(sky).composite([{ input: lawn }, ...crew]).toBuffer();

async function social(file, spec) {
  await sharp(art)
    .composite([{ input: overlay(spec) }])
    .jpeg({ quality: 86, mozjpeg: true })
    .toFile(file);
}

await social("public/catthemouse-og.jpg", {
  kicker: "CATCH THE MICE · COLLECT THE CATS",
  line1: "CAT THE MOUSE",
  line2: "COMPANY",
  sub: "7 cats to unlock. 1v1 online. Free.",
  pill: "▶ PLAY FREE · catthemouse.co"
});

mkdirSync("public/og", { recursive: true });
for (const rank of RANKS) {
  await social(`public/og/beat-${rank.id}.jpg`, {
    kicker: "YOU'VE BEEN CHALLENGED",
    line1: "CAN YOU",
    line2: "BEAT ME?",
    sub: "Tap the mice before the clock runs out.",
    badge: rank,
    pill: "▶ ACCEPT · catthemouse.co",
    pillColor: "#3ef2d0"
  });
}

// share-card backdrop: 1080 wide keeps the canvas crisp without shipping the 1.5k original
const card = sharp("art-src/card-bg.png").resize({ width: 1080 });
await card.clone().webp({ quality: 80 }).toFile("public/img/card-bg.webp");
await card.clone().jpeg({ quality: 82, mozjpeg: true }).toFile("public/img/card-bg.jpg");

console.log("generated social images and card backdrop");
