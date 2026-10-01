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
 * Close-up grass that tiles across the lawn: tufts of blades in a few greens, clover leaves and
 * small daisies on a pale base. The ground multiplies it by its own colour (dark rim, warm
 * middle), so the tile stays light and only carries the detail. Every stroke is drawn on all
 * sides of the edge it crosses, so the tile repeats without seams.
 */
export function grassTexture(): THREE.Texture {
  const tex = canvasTexture("grass", 512, 512, (ctx) => {
    const S = 512;
    ctx.fillStyle = "#d8ecc4";
    ctx.fillRect(0, 0, S, S);
    const rnd = rand(21);
    // draw something wherever it lands, plus its wrapped copies near the edges
    const wrap = (x: number, y: number, r: number, draw: (x: number, y: number) => void): void => {
      for (const dx of [0, -S, S]) {
        for (const dy of [0, -S, S]) {
          const px = x + dx;
          const py = y + dy;
          if (px > -r && px < S + r && py > -r && py < S + r) draw(px, py);
        }
      }
    };
    // soft patches of lighter and darker turf
    for (let i = 0; i < 70; i++) {
      const x = rnd() * S;
      const y = rnd() * S;
      const r = 20 + rnd() * 60;
      const light = rnd() < 0.5;
      wrap(x, y, r, (px, py) => {
        const g = ctx.createRadialGradient(px, py, 0, px, py, r);
        g.addColorStop(0, light ? "rgba(255,255,230,.35)" : "rgba(60,110,50,.22)");
        g.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = g;
        ctx.fillRect(px - r, py - r, r * 2, r * 2);
      });
    }
    // blades: short tapered strokes leaning a little, dark ones first, light tips on top
    ctx.lineCap = "round";
    const blades = (n: number, colors: string[], len: number, width: number): void => {
      for (let i = 0; i < n; i++) {
        const x = rnd() * S;
        const y = rnd() * S;
        const l = len * (0.6 + rnd() * 0.8);
        const lean = (rnd() - 0.5) * l * 0.7;
        ctx.strokeStyle = colors[Math.floor(rnd() * colors.length)]!;
        ctx.lineWidth = width * (0.7 + rnd() * 0.6);
        wrap(x, y, l + 4, (px, py) => {
          ctx.beginPath();
          ctx.moveTo(px, py);
          ctx.quadraticCurveTo(px + lean * 0.3, py - l * 0.6, px + lean, py - l);
          ctx.stroke();
        });
      }
    };
    blades(2600, ["rgba(70,120,55,.55)", "rgba(90,140,60,.5)", "rgba(55,100,50,.5)"], 14, 2.2);
    blades(2200, ["rgba(150,200,110,.6)", "rgba(175,215,120,.55)", "rgba(120,175,90,.55)"], 11, 1.8);
    blades(900, ["rgba(235,250,200,.55)", "rgba(255,255,225,.45)"], 7, 1.3);
    // clover: three round leaves around a dot
    for (let i = 0; i < 26; i++) {
      const x = rnd() * S;
      const y = rnd() * S;
      const r = 4 + rnd() * 3;
      const rot = rnd() * Math.PI * 2;
      wrap(x, y, r * 3, (px, py) => {
        for (let k = 0; k < 3; k++) {
          const a = rot + (k / 3) * Math.PI * 2;
          ctx.fillStyle = "rgba(85,140,70,.85)";
          ctx.beginPath();
          ctx.arc(px + Math.cos(a) * r, py + Math.sin(a) * r, r, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = "rgba(200,235,160,.35)";
          ctx.beginPath();
          ctx.arc(px + Math.cos(a) * r - 1, py + Math.sin(a) * r - 1, r * 0.45, 0, Math.PI * 2);
          ctx.fill();
        }
      });
    }
    // a few tiny daisies
    for (let i = 0; i < 9; i++) {
      const x = rnd() * S;
      const y = rnd() * S;
      wrap(x, y, 8, (px, py) => {
        ctx.fillStyle = "rgba(255,255,255,.95)";
        for (let k = 0; k < 6; k++) {
          const a = (k / 6) * Math.PI * 2;
          ctx.beginPath();
          ctx.ellipse(px + Math.cos(a) * 3.2, py + Math.sin(a) * 3.2, 2.4, 1.4, a, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = "#ffd23f";
        ctx.beginPath();
        ctx.arc(px, py, 1.8, 0, Math.PI * 2);
        ctx.fill();
      });
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
