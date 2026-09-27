import * as THREE from "three";

// Textures for the 3D lawn: the painted power-up icons (stamped onto the coins) and a few
// generated ones (ground, sparkles, the inside of a hole).

const ICONS = { auto: "/img/power-auto", fulltime: "/img/power-fulltime", freeze: "/img/power-freeze" } as const;
export type IconName = keyof typeof ICONS;

const images = new Map<IconName, HTMLImageElement>();
const textures = new Map<string, THREE.Texture>();

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

export async function loadArt(): Promise<void> {
  await Promise.all(
    (Object.keys(ICONS) as IconName[]).map(async (name) => {
      const img = (await loadImage(`${ICONS[name]}.webp`)) ?? (await loadImage(`${ICONS[name]}.png`));
      if (img) images.set(name, img);
    })
  );
}

export function iconImage(name: IconName): HTMLImageElement | null {
  return images.get(name) ?? null;
}

function canvasTexture(key: string, w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void): THREE.Texture {
  let tex = textures.get(key);
  if (tex) return tex;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d")!);
  tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  textures.set(key, tex);
  return tex;
}

function rand(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A soft, painterly lawn: large gentle patches of green with a warm mowed circle in the middle
 * and a darker, bluer rim at dusk. Drawn once, stretched over the whole ground disc.
 */
export function groundTexture(): THREE.Texture {
  return canvasTexture("ground", 768, 768, (ctx) => {
    const S = 768;
    const base = ctx.createRadialGradient(S / 2, S / 2, 40, S / 2, S / 2, S / 2);
    base.addColorStop(0, "#8fcf6a");
    base.addColorStop(0.25, "#7cc05c");
    base.addColorStop(0.55, "#5f9f4c");
    base.addColorStop(1, "#3b6b3f");
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, S, S);
    const rnd = rand(21);
    // soft blotches
    for (let i = 0; i < 150; i++) {
      const x = rnd() * S;
      const y = rnd() * S;
      const r = 16 + rnd() * 55;
      const light = rnd() < 0.5;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, light ? "rgba(190,230,130,.16)" : "rgba(40,90,50,.14)");
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    // tiny painted grass strokes
    ctx.lineCap = "round";
    for (let i = 0; i < 2600; i++) {
      const x = rnd() * S;
      const y = rnd() * S;
      ctx.strokeStyle = rnd() < 0.5 ? "rgba(210,240,150,.18)" : "rgba(40,90,40,.16)";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + (rnd() - 0.5) * 3, y - 3 - rnd() * 4);
      ctx.stroke();
    }
    // the warm, lantern-lit patch where the holes are
    const warm = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S * 0.2);
    warm.addColorStop(0, "rgba(255,220,150,.22)");
    warm.addColorStop(1, "rgba(255,220,150,0)");
    ctx.fillStyle = warm;
    ctx.fillRect(0, 0, S, S);
  });
}

/** Soft round glow for fireflies, sparkles and auras. */
export function glowTexture(): THREE.Texture {
  return canvasTexture("glow", 64, 64, (ctx) => {
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.35, "rgba(255,255,255,.55)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
  });
}

export function starTexture(): THREE.Texture {
  return canvasTexture("star", 64, 64, (ctx) => {
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
      const r = i % 2 ? 12 : 29;
      ctx.lineTo(32 + Math.cos(a) * r, 32 + Math.sin(a) * r);
    }
    ctx.closePath();
    ctx.fill();
  });
}

export function heartTexture(): THREE.Texture {
  return canvasTexture("heart", 64, 64, (ctx) => {
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.moveTo(32, 54);
    ctx.bezierCurveTo(-4, 30, 14, 2, 32, 20);
    ctx.bezierCurveTo(50, 2, 68, 30, 32, 54);
    ctx.fill();
  });
}

/** The inside of a hole: dark in the middle, earthy at the lip. */
export function pitTexture(): THREE.Texture {
  return canvasTexture("pit", 128, 128, (ctx) => {
    const g = ctx.createRadialGradient(64, 72, 2, 64, 64, 64);
    g.addColorStop(0, "#120a10");
    g.addColorStop(0.55, "#2a1a18");
    g.addColorStop(0.85, "#5a3a26");
    g.addColorStop(1, "#7a5236");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(64, 64, 64, 0, Math.PI * 2);
    ctx.fill();
  });
}

/** Soft contact shadow for things standing on the grass. */
export function shadowTexture(): THREE.Texture {
  return canvasTexture("shadow", 64, 64, (ctx) => {
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, "rgba(30,20,30,.5)");
    g.addColorStop(0.6, "rgba(30,20,30,.22)");
    g.addColorStop(1, "rgba(30,20,30,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
  });
}
