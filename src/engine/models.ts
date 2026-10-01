import * as THREE from "three";
import { fancyKind } from "../fancy";
import { iconImage } from "./art";
import type { SkinId } from "../shop";

// Procedural 3D models, built from primitives in a soft toon style with ink outlines: seven cats
// (one sculpt, seven painted coats), the round grey mouse with big pink ears and its 100 fancy
// outfits, the grumpy porcupine, the green snake and the yellow lizard.

/** Everything below the floor of the holes is clipped, so critters can climb out of them. */
export const GROUND_CLIP = [new THREE.Plane(new THREE.Vector3(0, 1, 0), 0.5)];
export const PIT_DEPTH = 0.5;

// ---- materials -------------------------------------------------------------------

let gradient: THREE.DataTexture | null = null;
function toonRamp(): THREE.DataTexture {
  if (!gradient) {
    gradient = new THREE.DataTexture(new Uint8Array([110, 110, 110, 255, 185, 185, 185, 255, 255, 255, 255, 255]), 3, 1);
    gradient.minFilter = gradient.magFilter = THREE.NearestFilter;
    gradient.needsUpdate = true;
  }
  return gradient;
}

const matCache = new Map<string, THREE.Material>();

export function toon(color: number, map: THREE.Texture | null = null, key = ""): THREE.MeshToonMaterial {
  const k = `t${color}:${key}`;
  let m = matCache.get(k) as THREE.MeshToonMaterial | undefined;
  if (!m) {
    m = new THREE.MeshToonMaterial({ color, map, gradientMap: toonRamp(), clippingPlanes: GROUND_CLIP });
    matCache.set(k, m);
  }
  return m;
}

function flat(color: number): THREE.MeshBasicMaterial {
  const k = `b${color}`;
  let m = matCache.get(k) as THREE.MeshBasicMaterial | undefined;
  if (!m) {
    m = new THREE.MeshBasicMaterial({ color, clippingPlanes: GROUND_CLIP });
    matCache.set(k, m);
  }
  return m;
}

// Ink outline: the back faces pushed out along their normals.
let inkMat: THREE.ShaderMaterial | null = null;
function ink(): THREE.ShaderMaterial {
  inkMat ??= new THREE.ShaderMaterial({
    side: THREE.BackSide,
    clipping: true,
    clippingPlanes: GROUND_CLIP,
    uniforms: { thickness: { value: 0.014 }, color: { value: new THREE.Color(0x3a2230) }, opacity: { value: 1 } },
    vertexShader: `
      uniform float thickness;
      #include <clipping_planes_pars_vertex>
      void main() {
        vec4 mvPosition = modelViewMatrix * vec4(position + normalize(normal) * thickness, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <clipping_planes_vertex>
      }`,
    fragmentShader: `
      uniform vec3 color;
      uniform float opacity;
      #include <clipping_planes_pars_fragment>
      void main() {
        #include <clipping_planes_fragment>
        gl_FragColor = vec4(color, opacity);
      }`
  });
  return inkMat;
}

// ---- textures ----------------------------------------------------------------------

const texCache = new Map<string, THREE.Texture>();
function canvasTex(key: string, w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void): THREE.Texture {
  let t = texCache.get(key);
  if (t) return t;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d")!);
  t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  t.wrapS = THREE.RepeatWrapping;
  texCache.set(key, t);
  return t;
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

// ---- cat coats -------------------------------------------------------------------------
// Every cat in the shop is the same sculpt wearing its own coat: painted canvas textures for the
// body and the head, plus a handful of per-cat colours (muzzle, ears, nose, eyes, tail bands).

type Pattern = "tabby" | "solid" | "smoke" | "calico" | "rosettes";

interface CatLook {
  pattern: Pattern;
  /** body gradient, top → bottom */
  coat: [string, string, string];
  /** stripes, rosettes, frosting */
  marks: string;
  /** muzzle, chest, paws */
  cream: number;
  nose: number;
  bean: number;
  /** outer ear colour, left / right (the calico has odd ears) */
  ear: [number, number];
  earTip: number | null;
  earIn: number;
  /** left / right iris (the white cat is odd-eyed) */
  iris: [string, string];
  /** band colour of a tail segment, or null for the coat */
  tail: (i: number, n: number) => number | null;
}

const ringed = (c: number) => (i: number, n: number): number | null => (i >= n - 2 || (i > 2 && i % 2 === 0) ? c : null);

const LOOKS: Record<SkinId, CatLook> = {
  grey: {
    pattern: "tabby", coat: ["#aeb0b7", "#9a9da5", "#878a93"], marks: "#3f424a", cream: 0xeceae6, nose: 0xd08e98, bean: 0xe5939f,
    ear: [0x93969e, 0x93969e], earTip: 0x3f424a, earIn: 0xf2c4c4, iris: ["#b9d36a", "#b9d36a"], tail: ringed(0x4a4d55)
  },
  orange: {
    pattern: "tabby", coat: ["#f8b465", "#ef9f4a", "#e08c39"], marks: "#bf5f27", cream: 0xfde9cf, nose: 0xee9a86, bean: 0xf09a90,
    ear: [0xed9c49, 0xed9c49], earTip: 0xbf5f27, earIn: 0xf8c9b8, iris: ["#f0b447", "#f0b447"], tail: ringed(0xc6662c)
  },
  badger: {
    pattern: "smoke", coat: ["#5d5965", "#4e4a56", "#403c48"], marks: "#cfcad6", cream: 0xf6f2ea, nose: 0x3d3238, bean: 0x4a3a44,
    ear: [0x48444f, 0x48444f], earTip: 0x26232b, earIn: 0xd9a5ad, iris: ["#a7e06a", "#a7e06a"], tail: (i, n) => (i >= n - 3 ? 0xf6f2ea : null)
  },
  black: {
    pattern: "solid", coat: ["#45414d", "#37333e", "#2c2932"], marks: "#6a6575", cream: 0x4a4552, nose: 0x2a2228, bean: 0x3a2e36,
    ear: [0x38343f, 0x38343f], earTip: null, earIn: 0x8a5f6e, iris: ["#ffd24a", "#ffd24a"], tail: () => null
  },
  white: {
    pattern: "solid", coat: ["#ffffff", "#f7f3ed", "#ece6de"], marks: "#ffffff", cream: 0xffffff, nose: 0xf4a3b0, bean: 0xf7a8b6,
    ear: [0xf8f4ee, 0xf8f4ee], earTip: null, earIn: 0xffb8c4, iris: ["#7fc4ff", "#f0b447"], tail: () => null
  },
  calico: {
    pattern: "calico", coat: ["#fdfaf4", "#f6efe4", "#ece3d6"], marks: "#2f2b31", cream: 0xffffff, nose: 0xf2a2a8, bean: 0xf3a1ac,
    ear: [0xe8893a, 0x37323a], earTip: null, earIn: 0xf8c9c4, iris: ["#c9d65a", "#c9d65a"],
    tail: (i, n) => (i >= n - 2 ? 0x2f2b31 : i % 4 < 2 ? 0xe8893a : 0x37323a)
  },
  tilcayo: {
    pattern: "rosettes", coat: ["#e39a4c", "#d8883a", "#c9772f"], marks: "#3b2216", cream: 0xf6e6d0, nose: 0xe99a9a, bean: 0xe98a9a,
    ear: [0xd98a3c, 0xd98a3c], earTip: 0x3b2216, earIn: 0xf6c9b8, iris: ["#f0b447", "#f0b447"], tail: ringed(0x3b2216)
  }
};

const hexNum = (h: string): number => parseInt(h.slice(1), 16);

/** Mix a #rrggbb colour towards white (f > 0) or black (f < 0). */
function shade(hex: string, f: number): string {
  const n = hexNum(hex);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => Math.round(f >= 0 ? c + (255 - c) * f : c * (1 + f)));
  return `rgb(${ch.join(",")})`;
}

// Rosettes: broken dark rings around a slightly deeper centre, the tilcayo's big leopard-like spots.
function rosette(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, rnd: () => number): void {
  ctx.fillStyle = "#b8662a";
  ctx.beginPath();
  ctx.ellipse(x, y, r * 0.7, r * 0.55, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#3b2216";
  const n = 4 + Math.floor(rnd() * 2);
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2 + rnd() * 0.4;
    const a1 = a0 + (Math.PI * 2) / n - 0.5;
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * 0.8, 0, a0, a1);
    ctx.ellipse(x, y, r * 0.62, r * 0.46, 0, a1, a0, true);
    ctx.closePath();
    ctx.fill();
  }
}

function coatBase(ctx: CanvasRenderingContext2D, w: number, h: number, look: CatLook): void {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, look.coat[0]);
  g.addColorStop(0.6, look.coat[1]);
  g.addColorStop(1, look.coat[2]);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  // soft fur mottling
  const rnd = rand(3);
  for (let i = 0; i < 260; i++) {
    ctx.fillStyle = rnd() < 0.5 ? "rgba(255,240,220,.08)" : "rgba(40,20,10,.06)";
    ctx.beginPath();
    ctx.ellipse(rnd() * w, rnd() * h, 6 + rnd() * 14, 3 + rnd() * 6, rnd() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  // fine fur strokes
  ctx.lineWidth = 1.2;
  for (let i = 0; i < 500; i++) {
    const x = rnd() * w;
    const y = rnd() * h;
    ctx.strokeStyle = rnd() < 0.5 ? "rgba(255,255,255,.07)" : "rgba(0,0,0,.07)";
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (rnd() - 0.5) * 3, y + 5 + rnd() * 5);
    ctx.stroke();
  }
}

// Mackerel tabby: wavy dark stripes running down the flanks.
function tabbyStripes(ctx: CanvasRenderingContext2D, w: number, h: number, color: string, seed: number, from = 0, to = h): void {
  const rnd = rand(seed);
  ctx.strokeStyle = color;
  ctx.lineCap = "round";
  const n = 16;
  for (let s = 0; s < n; s++) {
    const x0 = (s + 0.5) * (w / n) + (rnd() - 0.5) * 8;
    ctx.lineWidth = 7 + rnd() * 5;
    ctx.globalAlpha = 0.75 + rnd() * 0.25;
    ctx.beginPath();
    for (let y = from; y <= to; y += 8) {
      const x = x0 + Math.sin(y * 0.05 + s) * 5;
      if (y === from) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    // broken side branches
    if (rnd() < 0.6) {
      const y = from + rnd() * (to - from);
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(x0, y);
      ctx.lineTo(x0 + 10 + rnd() * 6, y + 10);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
}

function blob(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, rnd: () => number): void {
  ctx.fillStyle = color;
  for (let k = 0; k < 6; k++) {
    ctx.beginPath();
    ctx.ellipse(x + (rnd() - 0.5) * r, y + (rnd() - 0.5) * r * 0.7, r * (0.45 + rnd() * 0.4), r * (0.35 + rnd() * 0.3), rnd() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
}

function coatTexture(skin: SkinId): THREE.Texture {
  const look = LOOKS[skin];
  return canvasTex(`coat:${skin}`, 512, 256, (ctx) => {
    coatBase(ctx, 512, 256, look);
    const rnd = rand(11);
    switch (look.pattern) {
      case "tabby":
        tabbyStripes(ctx, 512, 256, look.marks, 21, 0, 236);
        break;
      case "smoke":
        // a silvery frosting near the roots shows through the dark tips
        for (let i = 0; i < 380; i++) {
          ctx.strokeStyle = `rgba(207,202,214,${0.08 + rnd() * 0.12})`;
          ctx.lineWidth = 1.5;
          const x = rnd() * 512;
          const y = 120 + rnd() * 136;
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x + (rnd() - 0.5) * 4, y + 6 + rnd() * 6);
          ctx.stroke();
        }
        break;
      case "solid":
        // a sheen along the back
        ctx.fillStyle = "rgba(255,255,255,.07)";
        ctx.fillRect(0, 10, 512, 40);
        break;
      case "calico":
        for (let i = 0; i < 9; i++) blob(ctx, rnd() * 512, 20 + rnd() * 160, 36 + rnd() * 30, i % 2 ? "#e8893a" : "#37323a", rnd);
        // orange patches carry faint tabby ghosting
        ctx.globalCompositeOperation = "source-atop";
        tabbyStripes(ctx, 512, 256, "rgba(200,100,30,.18)", 7, 0, 200);
        ctx.globalCompositeOperation = "source-over";
        break;
      case "rosettes":
        for (let row = 0; row < 7; row++) {
          for (let col = 0; col < 12; col++) {
            const x = (col + (row % 2) * 0.5) * (512 / 12) + (rnd() - 0.5) * 10;
            const y = 22 + row * 34 + (rnd() - 0.5) * 8;
            if (rnd() < 0.8) rosette(ctx, x, y, 11 + rnd() * 5, rnd);
            else {
              ctx.fillStyle = "#3b2216";
              ctx.beginPath();
              ctx.arc(x, y, 4 + rnd() * 3, 0, Math.PI * 2);
              ctx.fill();
            }
          }
        }
        break;
    }
  });
}

// Head: the face looks out at u = 0.25, so forehead marks sit around x = 128 near the top.
function headTexture(skin: SkinId): THREE.Texture {
  const look = LOOKS[skin];
  return canvasTex(`head:${skin}`, 512, 256, (ctx) => {
    coatBase(ctx, 512, 256, look);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = look.marks;
    ctx.fillStyle = look.marks;
    const rnd = rand(5);
    switch (look.pattern) {
      case "tabby": {
        // stripes over the crown and down the back of the head, then a clear forehead for the "M"
        tabbyStripes(ctx, 512, 256, look.marks, 9, 0, 80);
        const clear = ctx.createRadialGradient(128, 80, 10, 128, 80, 48);
        clear.addColorStop(0, look.coat[0]);
        clear.addColorStop(0.7, look.coat[0]);
        clear.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = clear;
        ctx.fillRect(70, 20, 116, 130);
        ctx.fillStyle = look.marks;
        ctx.lineWidth = 7;
        ctx.beginPath();
        ctx.moveTo(98, 98);
        ctx.lineTo(108, 62);
        ctx.lineTo(128, 84);
        ctx.lineTo(148, 62);
        ctx.lineTo(158, 98);
        ctx.stroke();
        ctx.lineWidth = 6;
        for (const dx of [-14, 0, 14]) {
          ctx.beginPath();
          ctx.moveTo(128 + dx, 58);
          ctx.quadraticCurveTo(128 + dx * 1.2, 30, 128 + dx * 1.4, 0);
          ctx.stroke();
        }
        // "mascara" lines from the outer eye corners and cheek bars
        ctx.lineWidth = 5;
        for (const s of [-1, 1]) {
          ctx.beginPath();
          ctx.moveTo(128 + s * 52, 118);
          ctx.quadraticCurveTo(128 + s * 66, 112, 128 + s * 84, 116);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(128 + s * 66, 136);
          ctx.quadraticCurveTo(128 + s * 82, 140, 128 + s * 98, 134);
          ctx.stroke();
        }
        break;
      }
      case "smoke": {
        // the badger blaze: a white stripe from the crown down between the eyes to the muzzle
        const g = ctx.createLinearGradient(0, 0, 0, 180);
        g.addColorStop(0, "#f6f2ea");
        g.addColorStop(1, "#ffffff");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(116, 0);
        ctx.quadraticCurveTo(118, 70, 108, 150);
        ctx.lineTo(148, 150);
        ctx.quadraticCurveTo(138, 70, 140, 0);
        ctx.closePath();
        ctx.fill();
        // darker bands framing it, like a badger's mask
        ctx.fillStyle = "rgba(20,18,26,.45)";
        for (const s of [-1, 1]) {
          ctx.beginPath();
          ctx.ellipse(128 + s * 34, 70, 12, 60, s * 0.08, 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      }
      case "calico":
        blob(ctx, 82, 60, 60, "#e8893a", rnd);
        blob(ctx, 182, 48, 54, "#37323a", rnd);
        blob(ctx, 330, 80, 50, "#e8893a", rnd);
        blob(ctx, 440, 60, 46, "#37323a", rnd);
        break;
      case "rosettes": {
        ctx.lineWidth = 9;
        for (const dx of [-13, 13]) {
          ctx.beginPath();
          ctx.moveTo(128 + dx * 1.6, 8);
          ctx.quadraticCurveTo(128 + dx * 1.2, 50, 128 + dx * 0.7, 88);
          ctx.stroke();
        }
        for (let i = 0; i < 30; i++) {
          const x = rnd() * 512;
          if (Math.abs(x - 128) < 60) continue;
          ctx.beginPath();
          ctx.ellipse(x, 20 + rnd() * 120, 3 + rnd() * 4, 8 + rnd() * 10, rnd() - 0.5, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.lineWidth = 5;
        for (const dx of [-70, 70]) {
          ctx.beginPath();
          ctx.moveTo(128 + dx, 118);
          ctx.quadraticCurveTo(128 + dx * 1.3, 128, 128 + dx * 1.6, 124);
          ctx.stroke();
        }
        break;
      }
      case "solid":
        break;
    }
  });
}

// Iris with a slit pupil and two catchlights, painted at the front of the eyeball (u = 0.25).
function eyeTexture(iris: string): THREE.Texture {
  return canvasTex(`eye:${iris}`, 256, 128, (ctx) => {
    ctx.fillStyle = "#fbf1de";
    ctx.fillRect(0, 0, 256, 128);
    const g = ctx.createRadialGradient(64, 60, 4, 64, 64, 40);
    g.addColorStop(0, shade(iris, 0.6));
    g.addColorStop(0.45, iris);
    g.addColorStop(0.85, shade(iris, -0.3));
    g.addColorStop(1, shade(iris, -0.55));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(64, 64, 40, 0, Math.PI * 2);
    ctx.fill();
    // fine radial streaks in the iris
    ctx.strokeStyle = "rgba(60,30,10,.18)";
    ctx.lineWidth = 1.5;
    for (let a = 0; a < Math.PI * 2; a += 0.22) {
      ctx.beginPath();
      ctx.moveTo(64 + Math.cos(a) * 14, 64 + Math.sin(a) * 14);
      ctx.lineTo(64 + Math.cos(a) * 36, 64 + Math.sin(a) * 36);
      ctx.stroke();
    }
    ctx.lineWidth = 5;
    ctx.strokeStyle = "#3b2216";
    ctx.beginPath();
    ctx.arc(64, 64, 40, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "#1a1015";
    ctx.beginPath();
    ctx.ellipse(64, 64, 10, 30, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(78, 48, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(52, 80, 4, 0, Math.PI * 2);
    ctx.fill();
  });
}


function flatTex(key: string, map: THREE.Texture): THREE.MeshBasicMaterial {
  let m = matCache.get(`f:${key}`) as THREE.MeshBasicMaterial | undefined;
  if (!m) {
    m = new THREE.MeshBasicMaterial({ map, clippingPlanes: GROUND_CLIP });
    matCache.set(`f:${key}`, m);
  }
  return m;
}

/** Inside wall of a hole: earthy at the lip, black at the bottom. */
export function wallTexture(): THREE.Texture {
  return canvasTex("wall", 64, 128, (ctx) => {
    const g = ctx.createLinearGradient(0, 0, 0, 128);
    g.addColorStop(0, "#6b4630");
    g.addColorStop(0.35, "#3a241a");
    g.addColorStop(1, "#0a0608");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 128);
    ctx.fillStyle = "rgba(0,0,0,.18)";
    for (let i = 0; i < 40; i++) ctx.fillRect((i * 37) % 64, (i * 53) % 60, 3, 2);
  });
}

function quillTexture(): THREE.Texture {
  return canvasTex("quill", 64, 16, (ctx) => {
    const g = ctx.createLinearGradient(0, 0, 64, 0);
    g.addColorStop(0, "#3a2418");
    g.addColorStop(0.6, "#6b4a36");
    g.addColorStop(1, "#fff1dc");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 16);
  });
}

// ---- geometry helpers ----------------------------------------------------------------

const geoCache = new Map<string, THREE.BufferGeometry>();
function geo<T extends THREE.BufferGeometry>(key: string, make: () => T): T {
  let g = geoCache.get(key) as T | undefined;
  if (!g) {
    g = make();
    geoCache.set(key, g);
  }
  return g;
}
const sphere = (r: number, w = 20, h = 14): THREE.SphereGeometry => geo(`s${r}:${w}`, () => new THREE.SphereGeometry(r, w, h));

interface PartOpts {
  pos?: [number, number, number];
  scale?: [number, number, number];
  rot?: [number, number, number];
  outline?: boolean;
}

function part(g: THREE.BufferGeometry, m: THREE.Material, o: PartOpts = {}): THREE.Mesh {
  const mesh = new THREE.Mesh(g, m);
  if (o.pos) mesh.position.set(...o.pos);
  if (o.scale) mesh.scale.set(...o.scale);
  if (o.rot) mesh.rotation.set(...o.rot);
  if (o.outline !== false) {
    const hull = new THREE.Mesh(g, ink());
    hull.name = "ink";
    mesh.add(hull);
  }
  return mesh;
}

// ---- cat ------------------------------------------------------------------------------

export interface CatModel {
  skin: SkinId;
  root: THREE.Group;
  body: THREE.Group;
  head: THREE.Group;
  lids: THREE.Object3D[];
  ears: THREE.Object3D[];
  arm: THREE.Group;
  tongue: THREE.Object3D;
  /** the open, happy mouth (catch) */
  mouth: THREE.Object3D;
  /** the little "ω" cat mouth at rest, and a crooked frown for bad moods */
  smile: THREE.Object3D;
  frown: THREE.Object3D;
  /** eyeballs with their lids; hidden while the cat squints happily */
  eyes: THREE.Object3D[];
  /** closed, happy "^ ^" eyes */
  joy: THREE.Object3D;
  /** tufts of darker fur above the eyes that frown or droop with the mood */
  brows: THREE.Object3D[];
  blush: THREE.Object3D;
  /** tail joints, root first; `userData.bend` holds each joint's resting curl */
  tail: THREE.Object3D[];
}

// A thin ink stroke along a curve, for drawn-on facial features.
function stroke(points: [number, number, number][], radius: number, key: string): THREE.Mesh {
  const g = geo(`stroke:${key}`, () => new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p))), 24, radius, 6, false));
  return new THREE.Mesh(g, flat(0x2e1a26));
}

export function buildCat(skin: SkinId = "grey"): CatModel {
  const look = LOOKS[skin];
  const coat = toon(0xffffff, coatTexture(skin), `coat:${skin}`);
  const headMat = toon(0xffffff, headTexture(skin), `head:${skin}`);
  const cream = toon(look.cream);
  const nose = toon(look.nose);
  const mid = toon(hexNum(look.coat[1]));
  const white = flat(0xffffff);

  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  body.add(part(sphere(0.5), coat, { pos: [0, 0.66, 0], scale: [1, 1.22, 0.92] }));
  body.add(part(sphere(0.34), cream, { pos: [0, 0.78, 0.26], scale: [0.95, 1.25, 0.7] }));
  // a ruff of chest fluff where the bib meets the neck
  for (const [x, y] of [[-0.1, 1.08], [0.1, 1.08], [0, 1.02]] as const) {
    body.add(part(sphere(0.11, 12, 8), cream, { pos: [x, y, 0.33], scale: [1, 0.8, 0.6], outline: false }));
  }
  for (const s of [-1, 1]) {
    body.add(part(sphere(0.3), coat, { pos: [s * 0.34, 0.3, -0.02], scale: [0.9, 0.95, 1.2] }));
    // hind paws peeking out
    body.add(part(sphere(0.12), cream, { pos: [s * 0.4, 0.07, 0.3], scale: [1, 0.6, 1.4] }));
    toes(body, s * 0.4, 0.07, 0.44, cream);
  }
  // left front leg (the right one is the slapping arm below)
  const legGeo = geo("leg", () => new THREE.CapsuleGeometry(0.1, 0.42, 6, 12));
  body.add(part(legGeo, coat, { pos: [-0.17, 0.33, 0.34] }));
  body.add(part(sphere(0.125), cream, { pos: [-0.17, 0.08, 0.4], scale: [1, 0.7, 1.25] }));
  toes(body, -0.17, 0.08, 0.54, cream);

  const arm = new THREE.Group();
  arm.position.set(0.17, 0.62, 0.32);
  arm.add(part(legGeo, coat, { pos: [0, -0.29, 0.02] }));
  arm.add(part(sphere(0.125), cream, { pos: [0, -0.54, 0.08], scale: [1, 0.7, 1.25] }));
  toes(arm, 0, -0.54, 0.22, cream);
  body.add(arm);

  // tail: a tapering chain of segments, banded per coat, curling up at the tip
  const tail: THREE.Object3D[] = [];
  const tailBase = new THREE.Group();
  tailBase.position.set(0.3, 0.14, -0.28);
  tailBase.rotation.y = Math.PI / 2 + 0.55;
  body.add(tailBase);
  let joint: THREE.Object3D = tailBase;
  const TAIL_N = 16;
  for (let i = 0; i < TAIL_N; i++) {
    const seg = new THREE.Group();
    seg.position.set(0, 0, i === 0 ? 0 : 0.088);
    // flat along the ground first, then sweeping round and up into a curl
    const bend = { x: i < 6 ? 0.04 : -0.12 - (i - 6) * 0.05, y: i < 2 ? 0 : -0.2 };
    seg.userData.bend = bend;
    seg.rotation.set(bend.x, bend.y, 0);
    const band = look.tail(i, TAIL_N);
    const r = 0.1 - i * 0.003;
    seg.add(part(sphere(0.1), band === null ? coat : toon(band), { scale: [r / 0.1, r / 0.1, (r / 0.1) * 1.25] }));
    joint.add(seg);
    tail.push(seg);
    joint = seg;
  }

  const head = new THREE.Group();
  head.position.set(0, 1.45, 0.05);
  body.add(head);
  head.add(part(sphere(0.46, 28, 20), headMat, { scale: [1.12, 0.94, 0.95] }));
  // cheek ruffs: soft tufts of fur at the sides of the face
  const tuft = geo("tuft", () => new THREE.ConeGeometry(0.09, 0.2, 10));
  for (const s of [-1, 1]) {
    for (const [dy, a] of [[-0.12, 1.9], [-0.2, 2.2]] as const) {
      head.add(part(tuft, mid, { pos: [s * 0.47, dy, 0.05], rot: [0, 0, -s * a], scale: [1, 1, 0.6] }));
    }
  }
  // muzzle, chin, nose
  head.add(part(sphere(0.14), cream, { pos: [-0.085, -0.12, 0.36], scale: [1.1, 0.85, 0.8] }));
  head.add(part(sphere(0.14), cream, { pos: [0.085, -0.12, 0.36], scale: [1.1, 0.85, 0.8] }));
  head.add(part(sphere(0.1), cream, { pos: [0, -0.24, 0.3], scale: [1.2, 0.7, 0.8] }));
  head.add(part(geo("nose", () => new THREE.SphereGeometry(0.05, 14, 10).scale(1.3, 0.75, 0.8)), nose, { pos: [0, -0.04, 0.44] }));
  // whisker pads: tiny dark dots
  for (const s of [-1, 1]) {
    for (let k = 0; k < 3; k++) {
      head.add(part(sphere(0.008, 6, 4), flat(0x6a5560), { pos: [s * (0.07 + k * 0.025), -0.1 - (k % 2) * 0.03, 0.47 - k * 0.012], outline: false }));
    }
  }
  const mouth = new THREE.Group();
  mouth.add(part(sphere(0.06), flat(0x3a1420), { pos: [0, -0.175, 0.43], scale: [1.35, 0.95, 0.55] }));
  mouth.add(part(sphere(0.04), toon(0xff7d9c), { pos: [0, -0.2, 0.455], scale: [1.2, 0.7, 0.5], outline: false }));
  mouth.visible = false;
  head.add(mouth);
  const philtrum: [number, number, number][] = [[0, -0.078, 0.47], [0, -0.1, 0.476], [0, -0.122, 0.478]];
  const smile = new THREE.Group();
  smile.add(stroke(philtrum, 0.008, "philtrum"));
  smile.add(stroke([[-0.105, -0.122, 0.455], [-0.052, -0.162, 0.472], [0, -0.122, 0.478], [0.052, -0.162, 0.472], [0.105, -0.122, 0.455]], 0.009, "omega"));
  head.add(smile);
  const frown = new THREE.Group();
  frown.add(stroke(philtrum, 0.008, "philtrum"));
  frown.add(stroke([[-0.075, -0.185, 0.458], [-0.03, -0.158, 0.472], [0.02, -0.16, 0.473], [0.07, -0.18, 0.46]], 0.009, "frown"));
  frown.visible = false;
  head.add(frown);
  const blush = new THREE.Group();
  for (const s of [-1, 1]) blush.add(part(sphere(0.06, 14, 10), toon(0xff8fa8), { pos: [s * 0.285, -0.07, 0.35], rot: [0, s * 0.62, 0], scale: [1, 0.55, 0.28], outline: false }));
  blush.visible = false;
  head.add(blush);
  const browColor = look.pattern === "tabby" || look.pattern === "rosettes" ? look.marks
    : look.pattern === "smoke" ? "#26232b" : look.pattern === "calico" ? "#37323a" : skin === "white" ? "#c9bfb6" : "#1f1c24";
  const browMat = toon(hexNum(browColor));
  const browGeo = geo("brow", () => new THREE.CapsuleGeometry(0.016, 0.085, 4, 8).rotateZ(Math.PI / 2));
  const brows: THREE.Object3D[] = [];
  for (const s of [-1, 1]) {
    const b = part(browGeo, browMat, { pos: [s * 0.19, 0.2, 0.37], rot: [-0.35, s * 0.3, 0] });
    b.userData.side = s;
    b.visible = false;
    brows.push(b);
    head.add(b);
  }
  const joy = new THREE.Group();
  for (const s of [-1, 1]) {
    const cx = s * 0.19;
    // drawn on the closed lid (lid radius 0.124 around the eye at z 0.34)
    joy.add(stroke([[cx - 0.085, 0.02, 0.44], [cx - 0.04, 0.07, 0.462], [cx + 0.04, 0.07, 0.462], [cx + 0.085, 0.02, 0.44]], 0.013, `joy${s}`));
  }
  joy.visible = false;
  head.add(joy);
  const tongue = part(sphere(0.045), toon(0xff7d9c), { pos: [0, -0.24, 0.4], scale: [0.9, 1.1, 0.6] });
  head.add(tongue);
  // whiskers, plus brow whiskers above the eyes
  const whisker = geo("whisker", () => new THREE.CylinderGeometry(0.004, 0.004, 0.42, 4).rotateZ(Math.PI / 2));
  const brow = geo("brow-whisker", () => new THREE.CylinderGeometry(0.003, 0.003, 0.14, 4).rotateZ(Math.PI / 2));
  const wMat = flat(skin === "white" ? 0xd8d0c8 : 0xfff6ea);
  for (const s of [-1, 1]) {
    for (const k of [0, 1, 2]) {
      const w = new THREE.Mesh(whisker, wMat);
      w.position.set(s * 0.3, -0.12 - k * 0.03, 0.34);
      w.rotation.set(0, s * 0.25, s * (0.12 - k * 0.1));
      head.add(w);
    }
    for (const k of [0, 1]) {
      const w = new THREE.Mesh(brow, wMat);
      w.position.set(s * (0.25 + k * 0.04), 0.2 + k * 0.02, 0.3);
      w.rotation.set(0, s * 0.4, s * (0.5 + k * 0.2));
      head.add(w);
    }
  }
  // eyes with toon lids (the lids carry the mood: half-closed = grumpy)
  const lids: THREE.Object3D[] = [];
  const eyes: THREE.Object3D[] = [];
  const lidGeo = geo("lid", () => new THREE.SphereGeometry(0.118, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2));
  for (const s of [-1, 1]) {
    const eye = new THREE.Group();
    eye.position.set(s * 0.19, 0.05, 0.34);
    eye.rotation.y = s * 0.25;
    const iris = look.iris[s < 0 ? 0 : 1];
    eye.add(part(sphere(0.11, 28, 18), flatTex(`eye:${iris}`, eyeTexture(iris)), { scale: [1, 1, 0.8] }));
    eye.add(part(sphere(0.018, 8, 6), white, { pos: [0.03, 0.035, 0.09], outline: false }));
    const lid = new THREE.Group();
    lid.add(part(lidGeo, headMat, { scale: [1.05, 1.05, 1.05] }));
    lid.userData.side = s;
    eye.add(lid);
    lids.push(lid);
    eye.userData.side = s;
    eyes.push(eye);
    head.add(eye);
  }
  // ears: coat-coloured cone, pink inside with a tuft of fur, darker tip where the coat has one
  const ears: THREE.Object3D[] = [];
  const earGeo = geo("ear", () => new THREE.ConeGeometry(0.2, 0.38, 20, 1));
  const tipGeo = geo("earTip", () => new THREE.ConeGeometry(0.09, 0.14, 16, 1));
  const innerGeo = geo("earIn", () => new THREE.ConeGeometry(0.13, 0.26, 16, 1));
  const furGeo = geo("earFur", () => new THREE.ConeGeometry(0.035, 0.16, 6, 1));
  look.ear.forEach((earColor, idx) => {
    const s = idx === 0 ? -1 : 1;
    const ear = new THREE.Group();
    ear.position.set(s * 0.3, 0.33, -0.04);
    ear.rotation.set(-0.1, 0, -s * 0.35);
    ear.add(part(earGeo, toon(earColor), { scale: [1, 1, 0.5] }));
    if (look.earTip !== null) ear.add(part(tipGeo, toon(look.earTip), { pos: [0, 0.13, 0], scale: [1, 1, 0.55], outline: false }));
    ear.add(part(innerGeo, toon(look.earIn), { pos: [0, -0.04, 0.06], scale: [1, 1, 0.35], outline: false }));
    for (const dx of [-0.03, 0.03]) ear.add(part(furGeo, cream, { pos: [dx, -0.08, 0.09], rot: [0.2, 0, dx * 6], outline: false }));
    ears.push(ear);
    head.add(ear);
  });
  return { skin, root, body, head, lids, ears, arm, tongue, mouth, smile, frown, eyes, joy, brows, blush, tail };
}

// Three little toe bumps along the front of a paw.
function toes(parent: THREE.Object3D, x: number, y: number, z: number, mat: THREE.Material): void {
  for (const dx of [-0.055, 0, 0.055]) {
    parent.add(part(sphere(0.042, 10, 8), mat, { pos: [x + dx, y - 0.01, z - Math.abs(dx) * 0.6], scale: [1, 0.8, 1], outline: false }));
  }
}


export type CatFace = "idle" | "catch" | "angry" | "sad" | "lick";

/** Pose the face for a mood. */
export function setCatFace(cat: CatModel, face: CatFace): void {
  const happy = face === "catch";
  const lid = happy ? 1.34 : face === "angry" ? 0.78 : face === "sad" ? 0.9 : face === "lick" ? 1.25 : 0.42;
  const tilt = face === "angry" ? 0.4 : face === "sad" ? -0.3 : 0.1;
  setLids(cat, lid, tilt);
  cat.joy.visible = happy;
  cat.blush.visible = happy;
  cat.mouth.visible = happy;
  cat.smile.visible = face === "idle";
  cat.frown.visible = face === "angry" || face === "sad";
  cat.tongue.visible = face === "lick";
  cat.tongue.position.set(0, -0.24, 0.44);
  cat.tongue.scale.set(0.9, 1.1, 0.6);
  for (const b of cat.brows) {
    const s = b.userData.side as number;
    b.visible = face === "angry" || face === "sad";
    b.rotation.z = face === "angry" ? s * 0.5 : -s * 0.38;
    b.position.y = face === "angry" ? 0.185 : 0.215;
  }
  const earTilt = face === "angry" ? 0.9 : face === "sad" ? 0.7 : 0.35;
  cat.ears.forEach((e, i) => {
    e.rotation.z = (i === 0 ? 1 : -1) * earTilt;
    e.userData.tilt = earTilt;
  });
}

/** Lid position (0.4 wide open … 1.3 shut) and tilt; used by moods and blinks. */
export function setLids(cat: CatModel, lid: number, tilt: number): void {
  for (const l of cat.lids) {
    const s = l.userData.side as number;
    l.rotation.set(-Math.PI / 2 + (Math.PI / 2) * (1 - lid), 0, s * tilt);
  }
}

// ---- mouse ----------------------------------------------------------------------------

export function buildMouse(variant: number | null): THREE.Group {
  const fur = toon(0xa39ca6);
  const belly = toon(0xefe3d6);
  const pink = toon(0xf4a3b0);
  const black = flat(0x1a1015);
  const white = flat(0xffffff);
  const g = new THREE.Group();
  g.add(part(sphere(0.25), fur, { pos: [0, 0.3, 0], scale: [1, 1.15, 0.92] }));
  g.add(part(sphere(0.19), belly, { pos: [0, 0.3, 0.1], scale: [0.95, 1.2, 0.75] }));
  const head = new THREE.Group();
  head.name = "head";
  head.position.set(0, 0.64, 0.02);
  g.add(head);
  head.add(part(sphere(0.23), fur, { scale: [1.05, 0.95, 1] }));
  head.add(part(sphere(0.1), belly, { pos: [0, -0.07, 0.17], scale: [1.2, 0.8, 0.9] }));
  head.add(part(sphere(0.035), toon(0xff8fa3), { pos: [0, -0.03, 0.27] }));
  for (const s of [-1, 1]) {
    const ear = new THREE.Group();
    ear.name = "ear";
    ear.position.set(s * 0.19, 0.19, -0.02);
    ear.rotation.set(0.1, 0, -s * 0.35);
    ear.add(part(geo("mouseEar", () => new THREE.CylinderGeometry(0.15, 0.15, 0.04, 22).rotateX(Math.PI / 2)), fur));
    ear.add(part(geo("mouseEarIn", () => new THREE.CylinderGeometry(0.105, 0.105, 0.02, 22).rotateX(Math.PI / 2)), pink, { pos: [0, 0, 0.022], outline: false }));
    head.add(ear);
    head.add(part(sphere(0.042), black, { pos: [s * 0.085, 0.04, 0.19], outline: false }));
    head.add(part(sphere(0.014), white, { pos: [s * 0.085 + 0.015, 0.058, 0.225], outline: false }));
    head.add(part(sphere(0.03), toon(0xffb3c1), { pos: [s * 0.14, -0.05, 0.16], scale: [1, 0.6, 0.4], outline: false }));
    // little hands held up
    g.add(part(sphere(0.05), pink, { pos: [s * 0.08, 0.42, 0.2], scale: [1, 0.8, 0.8] }));
  }
  const tail = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0.12, -0.2),
    new THREE.Vector3(0.12, 0.08, -0.36),
    new THREE.Vector3(0.28, 0.2, -0.3),
    new THREE.Vector3(0.3, 0.36, -0.16)
  ]);
  g.add(part(geo("mouseTail", () => new THREE.TubeGeometry(tail, 20, 0.018, 6, false)), pink, { outline: false }));
  if (variant !== null) dressUp(head, g, variant);
  return g;
}

// ---- fancy outfits ------------------------------------------------------------------------

function heartShape(): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(0, -0.05);
  s.bezierCurveTo(-0.09, 0.0, -0.06, 0.07, 0, 0.035);
  s.bezierCurveTo(0.06, 0.07, 0.09, 0.0, 0, -0.05);
  return s;
}

function dressUp(head: THREE.Group, bodyGroup: THREE.Group, variant: number): void {
  const k = fancyKind(variant);
  const main = toon(parseInt(k.palette[0].slice(1), 16));
  const accent = toon(parseInt(k.palette[1].slice(1), 16));
  const gold = toon(0xf7c948);
  const white = toon(0xfff8ee);
  const darkM = toon(0x2b2330);
  const hat = new THREE.Group();
  hat.position.set(0, 0.2, -0.01);
  hat.rotation.z = 0.08;
  head.add(hat);
  const cyl = (rt: number, rb: number, h: number): THREE.CylinderGeometry => geo(`c${rt}:${rb}:${h}`, () => new THREE.CylinderGeometry(rt, rb, h, 22));
  const cone = (r: number, h: number): THREE.ConeGeometry => geo(`k${r}:${h}`, () => new THREE.ConeGeometry(r, h, 22));
  const torus = (r: number, t: number): THREE.TorusGeometry => geo(`o${r}:${t}`, () => new THREE.TorusGeometry(r, t, 10, 28));
  switch (k.hat) {
    case 0: // top hat
      hat.add(part(cyl(0.2, 0.2, 0.02), main, { pos: [0, 0, 0] }));
      hat.add(part(cyl(0.12, 0.12, 0.24), main, { pos: [0, 0.13, 0] }));
      hat.add(part(cyl(0.125, 0.125, 0.05), accent, { pos: [0, 0.04, 0], outline: false }));
      break;
    case 1: // crown
      hat.add(part(cyl(0.13, 0.13, 0.08, ), gold, { pos: [0, 0.03, 0] }));
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        hat.add(part(cone(0.035, 0.1), gold, { pos: [Math.sin(a) * 0.11, 0.11, Math.cos(a) * 0.11] }));
        hat.add(part(sphere(0.018, 8, 6), accent, { pos: [Math.sin(a) * 0.132, 0.035, Math.cos(a) * 0.132], outline: false }));
      }
      break;
    case 2: // party hat
      hat.add(part(cone(0.11, 0.3), main, { pos: [0, 0.15, 0] }));
      hat.add(part(torus(0.06, 0.012), accent, { pos: [0, 0.14, 0], rot: [Math.PI / 2, 0, 0], outline: false }));
      hat.add(part(sphere(0.04), accent, { pos: [0, 0.31, 0] }));
      break;
    case 3: // beanie
      hat.add(part(geo("beanie", () => new THREE.SphereGeometry(0.17, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2)), main, { pos: [0, -0.02, 0] }));
      hat.add(part(torus(0.16, 0.035), accent, { pos: [0, -0.02, 0], rot: [Math.PI / 2, 0, 0] }));
      hat.add(part(sphere(0.05), white, { pos: [0, 0.17, 0] }));
      break;
    case 4: // cowboy
      hat.add(part(cyl(0.26, 0.26, 0.02), main, { pos: [0, 0, 0], scale: [1, 1, 0.8] }));
      hat.add(part(cyl(0.11, 0.13, 0.14), main, { pos: [0, 0.08, 0] }));
      hat.add(part(cyl(0.131, 0.131, 0.03), accent, { pos: [0, 0.03, 0], outline: false }));
      break;
    case 5: // wizard
      hat.add(part(cyl(0.21, 0.21, 0.02), main, { pos: [0, 0, 0] }));
      hat.add(part(cone(0.12, 0.38), main, { pos: [0, 0.2, 0], rot: [0, 0, -0.18] }));
      hat.add(part(sphere(0.025, 8, 6), accent, { pos: [0.02, 0.15, 0.09], outline: false }));
      hat.add(part(sphere(0.02, 8, 6), accent, { pos: [-0.05, 0.08, 0.1], outline: false }));
      break;
    case 6: // flower crown
      hat.add(part(torus(0.16, 0.015), toon(0x4f9a4a), { pos: [0, -0.02, 0], rot: [Math.PI / 2, 0, 0], outline: false }));
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        hat.add(part(sphere(0.04, 10, 8), i % 2 ? accent : main, { pos: [Math.sin(a) * 0.16, 0, Math.cos(a) * 0.16], scale: [1, 0.7, 1] }));
        hat.add(part(sphere(0.016, 8, 6), gold, { pos: [Math.sin(a) * 0.17, 0.02, Math.cos(a) * 0.17], outline: false }));
      }
      break;
    case 7: // chef
      hat.add(part(cyl(0.12, 0.12, 0.1), white, { pos: [0, 0.03, 0] }));
      for (const [x, y, r] of [[-0.07, 0.12, 0.08], [0.07, 0.12, 0.08], [0, 0.16, 0.1]] as const) hat.add(part(sphere(r), white, { pos: [x, y, 0] }));
      hat.add(part(cyl(0.122, 0.122, 0.025), accent, { pos: [0, 0, 0], outline: false }));
      break;
    case 8: // pirate tricorn
      hat.add(part(cone(0.24, 0.16, ), darkM, { pos: [0, 0.07, 0], scale: [1, 1, 0.7] }));
      hat.add(part(torus(0.2, 0.02), accent, { pos: [0, 0, 0], rot: [Math.PI / 2, 0, 0], scale: [1, 0.7, 1], outline: false }));
      hat.add(part(sphere(0.03, 10, 8), white, { pos: [0, 0.07, 0.13], outline: false }));
      break;
    default: {
      // propeller cap
      hat.add(part(geo("cap", () => new THREE.SphereGeometry(0.16, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2)), main, { pos: [0, -0.02, 0] }));
      hat.add(part(cyl(0.12, 0.12, 0.015), accent, { pos: [0, -0.02, 0.12], scale: [1, 1, 0.8] }));
      hat.add(part(cyl(0.01, 0.01, 0.08), darkM, { pos: [0, 0.17, 0], outline: false }));
      const prop = new THREE.Group();
      prop.name = "propeller";
      prop.position.set(0, 0.21, 0);
      prop.add(part(geo("blade", () => new THREE.BoxGeometry(0.22, 0.008, 0.04)), toon(0xff6b6b)));
      prop.add(part(geo("blade", () => new THREE.BoxGeometry(0.22, 0.008, 0.04)), toon(0x4dabf7), { rot: [0, Math.PI / 2, 0] }));
      hat.add(prop);
    }
  }

  // accessory
  const face = new THREE.Group();
  face.position.set(0, 0.04, 0.2);
  head.add(face);
  const neck = new THREE.Group();
  neck.position.set(0, 0.46, 0.04);
  bodyGroup.add(neck);
  switch (k.acc) {
    case 0: // bow tie
      for (const s of [-1, 1]) neck.add(part(cone(0.05, 0.1), accent, { pos: [s * 0.05, 0, 0.14], rot: [0, 0, s * Math.PI / 2] }));
      neck.add(part(sphere(0.025), main, { pos: [0, 0, 0.15] }));
      break;
    case 1: // monocle
      face.add(part(torus(0.05, 0.008), gold, { pos: [0.085, 0, 0.01], outline: false }));
      break;
    case 2: // sunglasses
      for (const s of [-1, 1]) face.add(part(geo("lens", () => new THREE.BoxGeometry(0.09, 0.06, 0.02)), toon(0x1d1b26), { pos: [s * 0.075, 0, 0.01] }));
      face.add(part(geo("bridge", () => new THREE.BoxGeometry(0.06, 0.012, 0.012)), toon(0x1d1b26), { pos: [0, 0.015, 0.01], outline: false }));
      break;
    case 3: // scarf
      neck.add(part(torus(0.16, 0.05), main, { rot: [Math.PI / 2, 0, 0], scale: [1, 0.9, 1] }));
      neck.add(part(geo("scarfTail", () => new THREE.BoxGeometry(0.07, 0.18, 0.04)), main, { pos: [0.1, -0.1, 0.13], rot: [0, 0, 0.2] }));
      neck.add(part(geo("scarfBand", () => new THREE.BoxGeometry(0.072, 0.03, 0.042)), accent, { pos: [0.11, -0.15, 0.13], rot: [0, 0, 0.2], outline: false }));
      break;
    case 4: // mustache
      for (const s of [-1, 1]) face.add(part(geo("stache", () => new THREE.CapsuleGeometry(0.018, 0.07, 4, 8).rotateZ(Math.PI / 2)), toon(0x4a2f22), { pos: [s * 0.045, -0.1, 0.06], rot: [0, 0, s * -0.3] }));
      break;
    case 5: // pearls
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        neck.add(part(sphere(0.022, 8, 6), white, { pos: [Math.sin(a) * 0.16, -0.02, Math.cos(a) * 0.14], outline: false }));
      }
      break;
    case 6: // heart glasses
      for (const s of [-1, 1]) {
        const h = part(geo("heart", () => new THREE.ExtrudeGeometry(heartShape(), { depth: 0.015, bevelEnabled: false })), toon(0xff5a8c), { pos: [s * 0.075, 0, 0.01], outline: false });
        face.add(h);
      }
      break;
    case 7: // bandana
      neck.add(part(cone(0.1, 0.14), toon(0xd63b3b), { pos: [0, -0.06, 0.15], rot: [Math.PI, 0, 0], scale: [1, 1, 0.35] }));
      neck.add(part(torus(0.15, 0.02), toon(0xd63b3b), { rot: [Math.PI / 2, 0, 0], outline: false }));
      break;
    case 8: // round glasses
      for (const s of [-1, 1]) face.add(part(torus(0.045, 0.008), main, { pos: [s * 0.08, 0, 0.01], outline: false }));
      break;
    default: // bell collar
      neck.add(part(torus(0.15, 0.022), main, { rot: [Math.PI / 2, 0, 0], outline: false }));
      neck.add(part(sphere(0.04), gold, { pos: [0, -0.04, 0.16] }));
  }
}

// ---- porcupine ----------------------------------------------------------------------------

export function buildPorcupine(): THREE.Group {
  const g = new THREE.Group();
  const fur = toon(0x6b4a36);
  const face = toon(0xd9b08c);
  const black = flat(0x1a1015);
  g.add(part(sphere(0.3), fur, { pos: [0, 0.32, -0.04], scale: [1.05, 1.1, 1] }));
  g.add(part(sphere(0.19), face, { pos: [0, 0.34, 0.2], scale: [1, 0.95, 0.75] }));
  g.add(part(sphere(0.06), face, { pos: [0, 0.3, 0.33], scale: [1.2, 0.9, 1] }));
  g.add(part(sphere(0.03), toon(0x3a2418), { pos: [0, 0.32, 0.38] }));
  for (const s of [-1, 1]) {
    g.add(part(sphere(0.035), black, { pos: [s * 0.08, 0.4, 0.31], outline: false }));
    // grumpy brows
    g.add(part(geo("brow", () => new THREE.BoxGeometry(0.08, 0.016, 0.02)), toon(0x3a2418), { pos: [s * 0.08, 0.45, 0.32], rot: [0, 0, s * -0.4], outline: false }));
    g.add(part(sphere(0.05), fur, { pos: [s * 0.17, 0.5, 0.12] }));
  }
  // quills over the back half
  const quill = geo("quill", () => new THREE.ConeGeometry(0.025, 0.3, 5).translate(0, 0.15, 0));
  const qm = toon(0xffffff, quillTexture(), "quill");
  const rnd = rand(9);
  for (let i = 0; i < 70; i++) {
    const u = rnd();
    const v = rnd();
    const theta = Math.acos(1 - v * 1.1);
    const phi = Math.PI * (0.15 + u * 1.7) + Math.PI / 2;
    const dir = new THREE.Vector3(Math.sin(theta) * Math.cos(phi), Math.cos(theta), Math.sin(theta) * Math.sin(phi) - 0.3).normalize();
    const q = new THREE.Mesh(quill, qm);
    q.position.set(dir.x * 0.26, 0.32 + dir.y * 0.28, -0.04 + dir.z * 0.26);
    q.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    q.scale.setScalar(0.8 + rnd() * 0.5);
    g.add(q);
  }
  return g;
}

// ---- the slapping paw ----------------------------------------------------------------------

export function buildPaw(skin: SkinId = "grey"): THREE.Group {
  const look = LOOKS[skin];
  const g = new THREE.Group();
  const coat = toon(0xffffff, coatTexture(skin), `coat:${skin}`);
  const cream = toon(look.cream);
  const bean = toon(look.bean);
  g.add(part(geo("pawArm", () => new THREE.CapsuleGeometry(0.15, 0.24, 6, 14)), coat, { pos: [0, 0.36, 0] }));
  g.add(part(sphere(0.21), cream, { pos: [0, 0.14, 0.02], scale: [1.15, 0.78, 1.2] }));
  g.add(part(sphere(0.075), bean, { pos: [0, 0.02, -0.02], scale: [1.4, 0.45, 1.1], outline: false }));
  for (let i = 0; i < 4; i++) {
    const x = (i - 1.5) * 0.09;
    const z = 0.17 - Math.abs(i - 1.5) * 0.035;
    g.add(part(sphere(0.062), cream, { pos: [x, 0.1, z], scale: [1, 0.85, 1] }));
    g.add(part(sphere(0.028), bean, { pos: [x, 0.045, z + 0.01], scale: [1, 0.5, 1], outline: false }));
  }
  return g;
}

// ---- yellow lizard ---------------------------------------------------------------------------

function lizardTexture(): THREE.Texture {
  return canvasTex("lizard", 256, 128, (ctx) => {
    const g = ctx.createLinearGradient(0, 0, 0, 128);
    g.addColorStop(0, "#f7d64a");
    g.addColorStop(0.7, "#f1c22c");
    g.addColorStop(1, "#e2a91c");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 128);
    const rnd = rand(17);
    // fine scales
    ctx.strokeStyle = "rgba(150,90,10,.18)";
    ctx.lineWidth = 1;
    for (let y = 4; y < 128; y += 7) {
      for (let x = (y % 14) / 2; x < 256; x += 7) {
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, Math.PI);
        ctx.stroke();
      }
    }
    // orange freckles and a darker dorsal line at the back (u = 0.75)
    for (let i = 0; i < 70; i++) {
      ctx.fillStyle = rnd() < 0.6 ? "rgba(224,120,30,.85)" : "rgba(150,80,20,.7)";
      ctx.beginPath();
      ctx.ellipse(rnd() * 256, rnd() * 110, 2 + rnd() * 4, 2 + rnd() * 3, rnd() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = "rgba(190,110,20,.55)";
    ctx.fillRect(184, 0, 16, 128);
  });
}

/**
 * The yellow lizard (calango): built like the mouse so they belong together — a chubby round body
 * popping out of the hole, a big round head with a wide snout and bulging eyes on top, little
 * hands resting on the rim, a rounded crest, and a thick tail curling up out of the burrow.
 */
export function buildLizard(): THREE.Group {
  const skin = toon(0xffffff, lizardTexture(), "lizard");
  const belly = toon(0xfff3b8);
  const crest = toon(0xf28a2a);
  const black = flat(0x1a1015);
  const white = flat(0xffffff);
  const g = new THREE.Group();
  // body, belly
  g.add(part(sphere(0.25), skin, { pos: [0, 0.3, 0], scale: [0.95, 1.12, 0.9] }));
  g.add(part(sphere(0.19), belly, { pos: [0, 0.29, 0.1], scale: [0.9, 1.15, 0.72], outline: false }));
  // little three-fingered hands held up, like the mouse's
  const finger = geo("liz-finger", () => new THREE.CapsuleGeometry(0.014, 0.035, 3, 6));
  for (const s of [-1, 1]) {
    const hand = new THREE.Group();
    hand.position.set(s * 0.1, 0.42, 0.19);
    hand.add(part(sphere(0.045), skin, { scale: [1, 0.85, 0.85] }));
    for (const a of [-0.5, 0, 0.5]) hand.add(part(finger, skin, { pos: [Math.sin(a) * 0.04, 0.035, 0.015], rot: [0.3, 0, -a] }));
    g.add(hand);
  }
  // head: round, with a wide snout
  const head = new THREE.Group();
  head.name = "head";
  head.position.set(0, 0.63, 0.02);
  g.add(head);
  head.add(part(sphere(0.21, 24, 18), skin, { scale: [1.12, 0.9, 1.0] }));
  head.add(part(sphere(0.15, 20, 14), skin, { pos: [0, -0.05, 0.13], scale: [1.18, 0.72, 0.95] }));
  head.add(part(sphere(0.12, 16, 10), belly, { pos: [0, -0.1, 0.13], scale: [1.15, 0.45, 0.95], outline: false }));
  // bulging eyes on top
  for (const s of [-1, 1]) {
    const eye = new THREE.Group();
    eye.position.set(s * 0.12, 0.12, 0.06);
    eye.add(part(sphere(0.085, 16, 12), skin));
    eye.add(part(sphere(0.066, 16, 12), white, { pos: [0, 0.008, 0.035], outline: false }));
    eye.add(part(sphere(0.04, 12, 8), black, { pos: [s * 0.004, 0.006, 0.08], outline: false }));
    eye.add(part(sphere(0.014, 8, 6), white, { pos: [s * 0.012 + 0.012, 0.025, 0.112], outline: false }));
    head.add(eye);
    head.add(part(sphere(0.011, 6, 4), black, { pos: [s * 0.04, -0.02, 0.27], outline: false }));
    head.add(part(sphere(0.035, 10, 8), toon(0xffa070), { pos: [s * 0.16, -0.06, 0.15], rot: [0, s * 0.6, 0], scale: [1, 0.6, 0.3], outline: false }));
  }
  // a wide, cheerful smile across the snout
  const smile = new THREE.Mesh(
    geo("liz-smile", () => new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.14, -0.05, 0.18), new THREE.Vector3(-0.07, -0.085, 0.255), new THREE.Vector3(0, -0.09, 0.27),
      new THREE.Vector3(0.07, -0.085, 0.255), new THREE.Vector3(0.14, -0.05, 0.18)
    ]), 20, 0.009, 6, false)),
    black
  );
  head.add(smile);
  const tongue = part(geo("liz-tongue", () => new THREE.BoxGeometry(0.02, 0.008, 0.1).translate(0, 0, 0.05)), toon(0xff5d8f), { pos: [0, -0.085, 0.25], outline: false });
  tongue.name = "tongue";
  tongue.scale.z = 0.01;
  head.add(tongue);
  // rounded crest down the back of the head and spine
  for (let i = 0; i < 5; i++) {
    const a = 0.5 + i * 0.32;
    head.add(part(sphere(0.035 - i * 0.003, 10, 8), crest, { pos: [0, Math.cos(a) * 0.19, -Math.sin(a) * 0.2], scale: [0.6, 1, 1] }));
  }
  // a thick tail curling up out of the burrow behind it
  const tail = new THREE.Group();
  tail.name = "lizTail";
  tail.position.set(0.05, 0.08, -0.18);
  g.add(tail);
  let joint: THREE.Object3D = tail;
  for (let i = 0; i < 10; i++) {
    const seg = new THREE.Group();
    seg.position.set(0, 0, i === 0 ? 0 : 0.06);
    seg.rotation.set(-0.16 - i * 0.03, 0.22, 0);
    const r = 0.075 - i * 0.0055;
    seg.add(part(sphere(0.075, 12, 10), skin, { scale: [r / 0.075, r / 0.075, (r / 0.075) * 1.3] }));
    joint.add(seg);
    joint = seg;
  }
  tail.rotation.y = Math.PI * 0.85;
  return g;
}

// ---- power-up coins --------------------------------------------------------------------------

const COIN_COLORS: Record<string, [string, number]> = {
  auto: ["#ffd66b", 0xe0a526],
  fulltime: ["#9be7a6", 0x3f9a55],
  freeze: ["#bfe9ff", 0x4a9ad6]
};

export function buildCoin(kind: "auto" | "fulltime" | "freeze"): THREE.Group {
  const [face, rim] = COIN_COLORS[kind]!;
  const tex = canvasTex(`coin:${kind}`, 256, 256, (ctx) => {
    const g = ctx.createRadialGradient(110, 100, 10, 128, 128, 128);
    g.addColorStop(0, "#ffffff");
    g.addColorStop(0.5, face);
    g.addColorStop(1, face);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 256);
    const img = iconImage(kind);
    if (img) ctx.drawImage(img, 36, 36, 184, 184);
  });
  tex.wrapS = THREE.ClampToEdgeWrapping;
  const faceMat = toon(0xffffff, tex, `coin:${kind}`);
  const g = new THREE.Group();
  const coin = new THREE.Mesh(geo("coin", () => new THREE.CylinderGeometry(0.27, 0.27, 0.07, 36).rotateX(Math.PI / 2)), [toon(rim), faceMat, faceMat]);
  const hull = new THREE.Mesh(coin.geometry, ink());
  coin.add(hull);
  coin.position.y = 0.42;
  coin.name = "coin";
  g.add(coin);
  return g;
}

// ---- snake ------------------------------------------------------------------------------------

export const SNAKE_SEGMENTS = 16;

export function buildSnake(): THREE.Group {
  const green = toon(0x6cc24a);
  const band = toon(0x4fa33c);
  const belly = toon(0xe3f59a);
  const white = flat(0xffffff);
  const black = flat(0x1a1020);
  const g = new THREE.Group();
  const segs: THREE.Object3D[] = [];
  for (let i = 0; i < SNAKE_SEGMENTS; i++) {
    const r = 0.13 - (i / SNAKE_SEGMENTS) * 0.035;
    const seg = part(sphere(0.13, 16, 12), i % 3 === 1 ? band : green, { scale: [r / 0.13, r / 0.13, r / 0.13] });
    seg.add(part(sphere(0.085, 12, 8), belly, { pos: [0, 0, 0.065], scale: [1, 1.1, 0.7], outline: false }));
    g.add(seg);
    segs.push(seg);
  }
  const head = new THREE.Group();
  head.add(part(sphere(0.2, 22, 16), green, { scale: [1.15, 0.85, 1.12] }));
  head.add(part(sphere(0.12, 14, 10), belly, { pos: [0, -0.07, 0.1], scale: [1.2, 0.5, 1], outline: false }));
  const eyes: THREE.Object3D[] = [];
  for (const s of [-1, 1]) {
    const eye = new THREE.Group();
    eye.position.set(s * 0.1, 0.09, 0.14);
    eye.add(part(sphere(0.078, 14, 10), white));
    eye.add(part(sphere(0.045, 10, 8), black, { pos: [0, 0, 0.05], outline: false }));
    eye.add(part(sphere(0.014, 6, 4), white, { pos: [0.015, 0.02, 0.09], outline: false }));
    head.add(eye);
    eyes.push(eye);
    head.add(part(sphere(0.035, 10, 8), toon(0xff9eb5), { pos: [s * 0.15, -0.02, 0.17], scale: [1, 0.6, 0.3], outline: false }));
  }
  const tongue = new THREE.Group();
  const pink = toon(0xff5d8f);
  tongue.add(part(geo("tongue", () => new THREE.BoxGeometry(0.022, 0.012, 0.14)), pink, { pos: [0, 0, 0.07], outline: false }));
  for (const s of [-1, 1]) tongue.add(part(geo("fork", () => new THREE.BoxGeometry(0.014, 0.01, 0.06)), pink, { pos: [s * 0.016, 0, 0.16], rot: [0, s * 0.5, 0], outline: false }));
  tongue.position.set(0, -0.07, 0.19);
  tongue.scale.z = 0.01;
  head.add(tongue);
  g.add(head);
  g.userData = { segs, head, eyes, tongue };
  return g;
}

// ---- helpers --------------------------------------------------------------------------------

/** Give a model its own materials so it can fade without touching the shared ones. */
export function fadeable(obj: THREE.Object3D): (opacity: number) => void {
  const mats: THREE.Material[] = [];
  obj.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const cloned = list.map((m) => {
      const c = m.clone();
      c.transparent = true;
      if ((c as THREE.ShaderMaterial).uniforms) (c as THREE.ShaderMaterial).uniforms = THREE.UniformsUtils.clone((m as THREE.ShaderMaterial).uniforms);
      mats.push(c);
      return c;
    });
    mesh.material = Array.isArray(mesh.material) ? cloned : cloned[0]!;
  });
  return (opacity) => {
    for (const m of mats) {
      const u = (m as THREE.ShaderMaterial).uniforms;
      if (u?.opacity) u.opacity.value = opacity;
      else m.opacity = opacity;
    }
  };
}

export function disposeClones(obj: THREE.Object3D): void {
  obj.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of list) if (![...matCache.values()].includes(m) && m !== inkMat) m.dispose();
  });
}

// ---- portraits: album mice, shop cats and the lizard, drawn once each through the lawn's renderer ----

let thumbScene: THREE.Scene | null = null;
let thumbCam: THREE.PerspectiveCamera | null = null;
let thumbTarget: THREE.WebGLRenderTarget | null = null;
const thumbs = new Map<string, string>();
const THUMB = 256;

export function fancyThumb(variant: number, renderer: THREE.WebGLRenderer): string {
  return portrait(`m${variant}`, renderer, () => {
    const m = buildMouse(variant);
    m.rotation.y = -0.35;
    return m;
  }, [0, 0.95, 1.9], [0, 0.6, 0]);
}

export function catThumb(skin: SkinId, renderer: THREE.WebGLRenderer): string {
  return portrait(`c${skin}`, renderer, () => {
    const c = buildCat(skin);
    setCatFace(c, "idle");
    c.root.rotation.y = -0.3;
    c.head.rotation.set(-0.15, 0.15, 0);
    return c.root;
  }, [0, 1.7, 4.3], [0, 1.05, 0]);
}

export function lizardThumb(renderer: THREE.WebGLRenderer): string {
  return portrait("lizard", renderer, () => {
    const l = buildLizard();
    l.rotation.y = -0.3;
    return l;
  }, [0, 0.8, 2.0], [0, 0.45, 0]);
}

function portrait(key: string, renderer: THREE.WebGLRenderer, build: () => THREE.Object3D, eye: [number, number, number], at: [number, number, number]): string {
  const hit = thumbs.get(key);
  if (hit) return hit;
  if (!thumbScene) {
    thumbScene = new THREE.Scene();
    thumbScene.add(new THREE.HemisphereLight(0xfff0e0, 0x6a5a70, 2));
    const sun = new THREE.DirectionalLight(0xffe0c0, 1.6);
    sun.position.set(-2, 3, 4);
    thumbScene.add(sun);
    thumbCam = new THREE.PerspectiveCamera(30, 1, 0.1, 20);
    thumbTarget = new THREE.WebGLRenderTarget(THUMB, THUMB);
    thumbTarget.texture.colorSpace = THREE.SRGBColorSpace;
  }
  thumbCam!.position.set(...eye);
  thumbCam!.lookAt(...at);
  const m = build();
  thumbScene.add(m);
  const prevTarget = renderer.getRenderTarget();
  const prevColor = renderer.getClearColor(new THREE.Color());
  const prevAlpha = renderer.getClearAlpha();
  renderer.setRenderTarget(thumbTarget);
  renderer.setClearColor(0x000000, 0);
  renderer.clear();
  renderer.render(thumbScene, thumbCam!);
  const px = new Uint8Array(THUMB * THUMB * 4);
  renderer.readRenderTargetPixels(thumbTarget!, 0, 0, THUMB, THUMB, px);
  renderer.setRenderTarget(prevTarget);
  renderer.setClearColor(prevColor, prevAlpha);
  thumbScene.remove(m);

  // WebGL rows run bottom-up; flip, then downsample by half for smooth edges
  const big = document.createElement("canvas");
  big.width = big.height = THUMB;
  const img = new ImageData(THUMB, THUMB);
  for (let y = 0; y < THUMB; y++) img.data.set(px.subarray((THUMB - 1 - y) * THUMB * 4, (THUMB - y) * THUMB * 4), y * THUMB * 4);
  big.getContext("2d")!.putImageData(img, 0, 0);
  const small = document.createElement("canvas");
  small.width = small.height = THUMB / 2;
  small.getContext("2d")!.drawImage(big, 0, 0, THUMB / 2, THUMB / 2);
  const url = small.toDataURL("image/png");
  thumbs.set(key, url);
  return url;
}
