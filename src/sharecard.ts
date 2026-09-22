import type { RoundStats } from "./game";
import { rankFor, formatTime } from "./rank";
import { SEALS, isEarned } from "./seals";

// The brag card: a 1080×1350 PNG (4:5, fits an Instagram post, a story with margins, and an
// X timeline without cropping) drawn on a canvas from the round's numbers.
export const CARD_W = 1080;
export const CARD_H = 1350;

const HEAT_COLORS = ["#2a2f5c", "#6b4a2b", "#ffd84a", "#ff9f2e", "#ff5a5a"];

export interface CardInput extends RoundStats {
  best: number;
  isNewBest: boolean;
  beat: number | null;
}

let bgPromise: Promise<HTMLImageElement | null> | null = null;

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/** Start fetching the card art early (the results screen calls this when a round starts). */
export function preloadCard(): void {
  bgPromise ??= loadImage("/img/card-bg.webp").then((img) => img ?? loadImage("/img/card-bg.jpg"));
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function medal(icon: string, color: string): Promise<HTMLImageElement | null> {
  const svg = icon.replace("<svg ", `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" color="${color}" `);
  return loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
}

export async function drawCard(input: CardInput): Promise<HTMLCanvasElement> {
  preloadCard();
  const canvas = document.createElement("canvas");
  canvas.width = CARD_W;
  canvas.height = CARD_H;
  const ctx = canvas.getContext("2d")!;
  const rank = rankFor(input.score);

  await Promise.all([
    document.fonts.load('800 200px "Unbounded"'),
    document.fonts.load('600 40px "Unbounded"'),
    document.fonts.load('700 40px "Bricolage Grotesque"')
  ]).catch(() => undefined);

  // ---- art
  const bg = await bgPromise;
  if (bg) {
    // full width, nudged up so the cat's face sits just under the rank pill
    const w = CARD_W;
    const h = (bg.naturalHeight / bg.naturalWidth) * CARD_W;
    ctx.drawImage(bg, 0, -110, w, h);
  } else {
    const g = ctx.createLinearGradient(0, 0, 0, CARD_H);
    g.addColorStop(0, "#0b0f2e");
    g.addColorStop(0.6, "#1a1f5a");
    g.addColorStop(1, "#1f4f22");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, CARD_W, CARD_H);
  }
  // darken the sky behind the numbers and the footer so the text always reads
  const top = ctx.createLinearGradient(0, 0, 0, 640);
  top.addColorStop(0, "rgba(5,7,24,.7)");
  top.addColorStop(0.7, "rgba(5,7,24,.3)");
  top.addColorStop(1, "rgba(5,7,24,0)");
  ctx.fillStyle = top;
  ctx.fillRect(0, 0, CARD_W, 640);
  const foot = ctx.createLinearGradient(0, 900, 0, CARD_H);
  foot.addColorStop(0, "rgba(5,7,24,0)");
  foot.addColorStop(0.35, "rgba(5,7,24,.6)");
  foot.addColorStop(1, "rgba(5,7,24,.92)");
  ctx.fillStyle = foot;
  ctx.fillRect(0, 900, CARD_W, CARD_H - 900);

  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";

  // ---- header
  ctx.font = '600 30px "Unbounded", sans-serif';
  ctx.fillStyle = "rgba(255,247,234,.85)";
  ctx.fillText("TILCAYO CAT GAME", CARD_W / 2, 78);

  const headline = input.isNewBest && input.score > 0 ? "NEW RECORD!" : input.beat && input.score > input.beat ? "CHALLENGE WON!" : "I CAUGHT";
  ctx.font = '800 46px "Unbounded", sans-serif';
  ctx.fillStyle = input.isNewBest || (input.beat && input.score > input.beat) ? "#3ef2d0" : "#fff7ea";
  ctx.fillText(headline, CARD_W / 2, 150);

  // ---- the number
  const digits = String(input.score);
  const size = digits.length >= 3 ? 230 : 280;
  ctx.font = `800 ${size}px "Unbounded", sans-serif`;
  const numY = 150 + size * 0.98;
  const gold = ctx.createLinearGradient(0, numY - size, 0, numY);
  gold.addColorStop(0, "#fff3c4");
  gold.addColorStop(0.45, "#ffd84a");
  gold.addColorStop(1, "#ff9f2e");
  ctx.save();
  ctx.shadowColor = "rgba(255,159,46,.75)";
  ctx.shadowBlur = 60;
  ctx.fillStyle = gold;
  ctx.fillText(digits, CARD_W / 2, numY);
  ctx.restore();
  ctx.lineWidth = 6;
  ctx.strokeStyle = "rgba(90,40,5,.55)";
  ctx.strokeText(digits, CARD_W / 2, numY);
  ctx.fillStyle = gold;
  ctx.fillText(digits, CARD_W / 2, numY);

  ctx.font = '800 44px "Unbounded", sans-serif';
  ctx.fillStyle = "#fff7ea";
  ctx.fillText(input.score === 1 ? "MOUSE" : "MICE", CARD_W / 2, numY + 62);

  // ---- rank pill
  let y = numY + 92;
  ctx.font = '800 38px "Unbounded", sans-serif';
  const label = `${rank.emoji}  ${rank.name.toUpperCase()}`;
  const pw = ctx.measureText(label).width + 80;
  const pill = ctx.createLinearGradient(0, y, 0, y + 76);
  pill.addColorStop(0, rank.tint[0]);
  pill.addColorStop(1, rank.tint[1]);
  ctx.save();
  ctx.shadowColor = rank.tint[1];
  ctx.shadowBlur = 36;
  roundRect(ctx, (CARD_W - pw) / 2, y, pw, 76, 38);
  ctx.fillStyle = pill;
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = "#140a04";
  ctx.fillText(label, CARD_W / 2, y + 52);

  // ---- stat chips, down in the footer so the cat stays in view
  y = 1030;
  const chips = [`⏱ ${formatTime(input.elapsedMs)}`, `🔥 ×${input.bestCombo} combo`, `🏆 best ${input.best}`];
  ctx.font = '700 32px "Bricolage Grotesque", sans-serif';
  const gap = 18;
  const widths = chips.map((c) => ctx.measureText(c).width + 44);
  let x = (CARD_W - widths.reduce((a, b) => a + b, 0) - gap * (chips.length - 1)) / 2;
  chips.forEach((c, i) => {
    roundRect(ctx, x, y, widths[i]!, 60, 30);
    ctx.fillStyle = "rgba(10,12,40,.62)";
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,.18)";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = "#fff7ea";
    ctx.fillText(c, x + widths[i]! / 2, y + 41);
    x += widths[i]! + gap;
  });

  // ---- heat strip: one tile per 10 s
  y += 78;
  const slices = input.slices.slice(0, 18);
  const tile = 26;
  const tgap = 8;
  x = (CARD_W - slices.length * tile - (slices.length - 1) * tgap) / 2;
  for (const n of slices) {
    const idx = n <= 0 ? 0 : n <= 2 ? 1 : n <= 4 ? 2 : n <= 7 ? 3 : 4;
    roundRect(ctx, x, y, tile, tile, 7);
    ctx.fillStyle = HEAT_COLORS[idx]!;
    ctx.fill();
    x += tile + tgap;
  }

  // ---- seals
  const medals = await Promise.all(SEALS.map((s) => medal(s.icon, isEarned(s.id) ? "#fff7ea" : "rgba(255,255,255,.35)")));
  const mr = 27;
  const mgap = 16;
  x = (CARD_W - SEALS.length * mr * 2 - (SEALS.length - 1) * mgap) / 2 + mr;
  const my = 1188;
  SEALS.forEach((s, i) => {
    ctx.beginPath();
    ctx.arc(x, my, mr, 0, Math.PI * 2);
    if (isEarned(s.id)) {
      const g = ctx.createRadialGradient(x - 10, my - 12, 4, x, my, mr);
      g.addColorStop(0, s.tint[0]);
      g.addColorStop(1, s.tint[1]);
      ctx.fillStyle = g;
    } else {
      ctx.fillStyle = "rgba(10,12,40,.7)";
    }
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = isEarned(s.id) ? "rgba(255,255,255,.7)" : "rgba(255,255,255,.2)";
    ctx.stroke();
    const m = medals[i];
    if (m) ctx.drawImage(m, x - 17, my - 17, 34, 34);
    x += mr * 2 + mgap;
  });

  // ---- call to action
  ctx.font = '800 46px "Unbounded", sans-serif';
  ctx.fillStyle = "#fff7ea";
  ctx.fillText("Can you beat me?", CARD_W / 2, 1282);
  ctx.font = '800 34px "Unbounded", sans-serif';
  ctx.fillStyle = "#3ef2d0";
  ctx.fillText("tilcayo.cat", CARD_W / 2, 1328);

  return canvas;
}

export function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/png")
  );
}
