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
 * A calm, cartoon lawn surface: large soft patches of lighter and darker green on a pale base,
 * nothing small or busy. The ground multiplies it by its own colour (warm middle, dark rim) and
 * the 3D grass tufts on top carry all the fine detail. Tiles seamlessly.
 */
export function grassTexture(): THREE.Texture {
  const tex = canvasTexture("lawn", 512, 512, (ctx) => {
    const S = 512;
    ctx.fillStyle = "#e4f0d8";
    ctx.fillRect(0, 0, S, S);
    const rnd = rand(21);
    for (let i = 0; i < 46; i++) {
      const x = rnd() * S;
      const y = rnd() * S;
      const r = 60 + rnd() * 120;
      const light = rnd() < 0.5;
      for (const dx of [0, -S, S]) {
        for (const dy of [0, -S, S]) {
          const px = x + dx;
          const py = y + dy;
          if (px < -r || px > S + r || py < -r || py > S + r) continue;
          const g = ctx.createRadialGradient(px, py, 0, px, py, r);
          g.addColorStop(0, light ? "rgba(255,255,236,.16)" : "rgba(70,120,60,.13)");
          g.addColorStop(1, "rgba(0,0,0,0)");
          ctx.fillStyle = g;
          ctx.fillRect(px - r, py - r, r * 2, r * 2);
        }
      }
    }
  });
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/** The lawn's colour from the middle (0) to the rim (1): warm and lantern-lit, then dusk-blue green. */
export function groundColor(t: number, out: THREE.Color): THREE.Color {
  const stops: [number, number][] = [[0, 0xa8d878], [0.12, 0x93cc6a], [0.3, 0x7cc05c], [0.55, 0x5f9f4c], [1, 0x3b6b3f]];
  for (let i = 1; i < stops.length; i++) {
    const [t1, c1] = stops[i]!;
    const [t0, c0] = stops[i - 1]!;
    if (t <= t1) return out.set(c0).lerp(new THREE.Color(c1), (t - t0) / (t1 - t0));
  }
  return out.set(stops[stops.length - 1]![1]);
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
