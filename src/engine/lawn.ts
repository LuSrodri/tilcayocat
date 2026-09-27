import * as THREE from "three";
import { loadArt, glowTexture, starTexture, heartTexture, shadowTexture, groundTexture } from "./art";
import {
  toon, buildCat, setCatFace, buildMouse, buildPorcupine, buildPaw, buildCoin, buildSnake, fadeable, disposeClones, fancyThumb,
  wallTexture, PIT_DEPTH, SNAKE_SEGMENTS, type CatModel, type CatFace
} from "./models";

// The 3D lawn shared by the solo game and the 1v1 arena. Game rules live elsewhere: this class
// only shows what it is told (critters rising, paws slapping, snakes gulping) and reports which
// hole a tap landed on. The world is a fixed 5×5 layout of hole spots; the game decides which
// holes are open, so the lawn can grow one hole at a time.

export const LAYOUT = 5;
export const HOLES = LAYOUT * LAYOUT;

export type Critter = "mouse" | "fancy" | "porcupine" | "snake" | "auto" | "fulltime" | "freeze";
export type CatMood = "idle" | "catch" | "angry" | "sad";
export type SlapOutcome = "catch" | "whiff" | "prick" | "bite" | "collect";
export type Mood = "" | "freeze" | "auto";

const SX = 1.25; // spacing between hole columns (world units)
const SZ = 1.12; // spacing between rows
const CAT_H = 2.15;
const CRITTER_H = 0.95;
const FOV = 34;
const UP = new THREE.Vector3(0, 1, 0);

const reduceMotion = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

export function holePos(i: number): THREE.Vector3 {
  const r = Math.floor(i / LAYOUT);
  const c = i % LAYOUT;
  return new THREE.Vector3((c - (LAYOUT - 1) / 2) * SX, 0, (r - (LAYOUT - 1) / 2) * SZ);
}

/** Holes sharing an edge with `i` on the 5×5 layout. */
export function neighbours(i: number): number[] {
  const r = Math.floor(i / LAYOUT);
  const c = i % LAYOUT;
  const out: number[] = [];
  if (r > 0) out.push(i - LAYOUT);
  if (r < LAYOUT - 1) out.push(i + LAYOUT);
  if (c > 0) out.push(i - 1);
  if (c < LAYOUT - 1) out.push(i + 1);
  return out;
}

export interface Insets {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface LawnOptions {
  container: HTMLElement;
  cats: 1 | 2;
  /** Screen space the HUD covers, in CSS pixels; the camera frames the lawn inside the rest. */
  insets: () => Insets;
}

interface Occupant {
  kind: Critter;
  root: THREE.Group;
  body: THREE.Group;
  y: number;
  vy: number;
  up: number;
  down: number;
  target: number;
  phase: number;
  sparkAt: number;
  lunge?: { toward: THREE.Vector3; t: number };
}

interface HoleView {
  group: THREE.Group;
  glow: THREE.Mesh;
  mound: THREE.Mesh;
  pos: THREE.Vector3;
  active: boolean;
  scale: number;
  vscale: number;
  telegraphUntil: number;
  occ: Occupant | null;
}

interface CatView {
  slot: 1 | 2;
  model: CatModel;
  aura: THREE.Sprite;
  setOpacity: (o: number) => void;
  yaw: number;
  mood: CatMood;
  moodTimer: number;
  lickFrom: number;
  lickUntil: number;
  swipeAt: number;
  pounce: number;
  /** where the cat is heading (it walks there when the lawn grows) */
  spot: THREE.Vector3;
  ring: HTMLElement;
  tag: HTMLElement | null;
}

interface Anim {
  update(now: number, dt: number): boolean; // false when finished
}

interface Particle {
  sprite: THREE.Sprite;
  vel: THREE.Vector3;
  life: number;
  max: number;
  size: number;
  gravity: number;
  spin: number;
}

export class Lawn {
  readonly ready: Promise<void>;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 200);
  private readonly layer: HTMLDivElement;
  private readonly holes: HoleView[] = [];
  private readonly cats: CatView[] = [];
  private readonly anims: Anim[] = [];
  private readonly particles: Particle[] = [];
  private readonly spritePool: THREE.Sprite[] = [];
  private readonly fireflies: { s: THREE.Sprite; base: THREE.Vector3; ph: number; sp: number }[] = [];
  private tapHandler: ((hole: number) => void) | null = null;
  private wanted = new Set<number>();
  private hemi = new THREE.HemisphereLight(0xffe6cc, 0x3a4a34, 1.6);
  private sun = new THREE.DirectionalLight(0xffd29a, 2.1);
  private mood: Mood = "";
  private width = 1;
  private height = 1;
  private camTarget = new THREE.Vector3();
  private camDist = 14;
  private wantTarget = new THREE.Vector3();
  private wantDist = 14;
  private elevation = THREE.MathUtils.degToRad(52);
  private fitDirty = true;
  private snapCamera = true;
  private portrait = true;
  private built = false;
  private raf = 0;
  private last = 0;
  private time = 0;
  private shake = 0;
  // adaptive quality: 0 = full, 1 = lighter shadows, 2 = no shadows, 3 = low resolution
  private quality = 0;
  // while a menu covers the lawn it only needs to breathe, not run at full frame rate
  private calm = false;
  private lastDraw = 0;
  private slowFrames = 0;
  private sampledFrames = 0;

  constructor(private readonly opts: LawnOptions) {
    const { container } = opts;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.quality = startQuality();
    this.applyQuality(false);
    this.renderer.localClippingEnabled = true;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    const canvas = this.renderer.domElement;
    canvas.className = "lawn3d";
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", "A cozy lawn at dusk with mouse holes; tap a mouse to catch it");
    container.prepend(canvas);

    this.layer = document.createElement("div");
    this.layer.className = "lawn3d__layer";
    container.append(this.layer);

    canvas.addEventListener("pointerdown", (ev) => {
      ev.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const hole = this.pick(ev.clientX - rect.left, ev.clientY - rect.top);
      if (hole >= 0) this.tapHandler?.(hole);
    });
    canvas.addEventListener("contextmenu", (ev) => ev.preventDefault());

    this.ready = afterFirstPaint()
      .then(loadArt)
      .then(() => this.build());
    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) this.start();
    });
  }

  // ---- public API --------------------------------------------------------------

  /** A portrait of a fancy mouse (data URL), rendered once with the lawn's renderer. */
  thumbnail(variant: number): string {
    return this.built ? fancyThumb(variant, this.renderer) : "";
  }

  /** Menus over the lawn: draw at a gentle ~20 fps to save battery and main-thread time. */
  setCalm(calm: boolean): void {
    this.calm = calm;
  }

  onTap(fn: (hole: number) => void): void {
    this.tapHandler = fn;
  }

  /** Which holes are dug. New ones pop open with a puff of dirt. */
  setActive(active: Iterable<number>, animate = true): void {
    const want = new Set(active);
    this.wanted = want;
    this.holes.forEach((h, i) => {
      const on = want.has(i);
      if (on === h.active) return;
      h.active = on;
      h.telegraphUntil = 0;
      if (on && animate) {
        h.scale = 0.01;
        h.vscale = 0;
        this.dust(h.pos, 16);
      } else {
        h.scale = on ? 1 : 0;
      }
      if (!on && h.occ) this.drop(h);
    });
    if (this.built) this.placeCats(!animate);
    this.fitDirty = true;
  }

  /** Warn that a hole is about to open: a little mound wiggles on the spot. */
  telegraph(hole: number, ms: number): void {
    const h = this.holes[hole];
    if (!h || h.active) return;
    if (h.telegraphUntil <= performance.now()) this.fitDirty = true;
    h.telegraphUntil = performance.now() + ms;
  }

  raise(hole: number, kind: Critter, variant: number | null = null): void {
    const h = this.holes[hole];
    if (!h) return;
    if (h.occ) this.drop(h);
    h.occ = this.makeOccupant(kind, variant, h);
  }

  /** Critter goes back down quietly. */
  lower(hole: number): void {
    const h = this.holes[hole];
    if (h?.occ) this.drop(h);
  }

  /** A mouse got away: it ducks with a little puff. */
  escape(hole: number): void {
    const h = this.holes[hole];
    if (!h) return;
    this.lower(hole);
    this.dust(h.pos, 6);
  }

  /** The fancy mouse leaps from one hole to another. */
  hop(from: number, to: number): void {
    const a = this.holes[from];
    const b = this.holes[to];
    if (!a || !b || !a.occ) return;
    const occ = a.occ;
    a.occ = null;
    if (b.occ) this.drop(b);
    b.occ = occ;
    this.scene.attach(occ.root);
    const start = occ.root.position.clone();
    const t0 = performance.now();
    occ.y = occ.target = occ.up;
    occ.vy = 0;
    this.dust(a.pos, 5);
    this.anims.push({
      update: (now) => {
        const t = Math.min(1, (now - t0) / 320);
        occ.root.position.lerpVectors(start, b.pos, t);
        occ.root.position.y = Math.sin(t * Math.PI) * 1.0;
        occ.body.rotation.x = Math.sin(t * Math.PI * 2) * 0.5;
        if (t < 1) return true;
        occ.body.rotation.x = 0;
        if (b.occ === occ) {
          b.group.attach(occ.root);
          occ.root.position.set(0, 0, 0);
          occ.vy = -2;
        } else {
          this.disposeOcc(occ);
        }
        this.dust(b.pos, 5);
        return false;
      }
    });
  }

  /** The cat swipes its paw down on a hole. */
  slap(hole: number, slot: 1 | 2, outcome: SlapOutcome, label = ""): void {
    const h = this.holes[hole];
    const cat = this.cats[slot - 1] ?? this.cats[0];
    if (!h || !cat) return;
    const victim = outcome === "catch" || outcome === "collect" ? h.occ : null;
    if (victim) h.occ = null; // the hole is free right away; the critter stays until the paw lands
    const stuck = outcome === "prick" || outcome === "bite" ? h.occ : null;

    const paw = new THREE.Group();
    const inner = buildPaw();
    casts(inner);
    paw.add(inner);
    this.scene.add(paw);
    const catPos = cat.model.root.position;
    const toCat = catPos.clone().sub(h.pos).setY(0).normalize();
    paw.quaternion.setFromUnitVectors(UP, toCat.clone().multiplyScalar(0.45).add(UP).normalize());
    const from = catPos.clone().add(new THREE.Vector3(0, CAT_H * 0.5, 0.35));
    const above = h.pos.clone().add(toCat.clone().multiplyScalar(0.35)).add(new THREE.Vector3(0, 1.25, 0.15));
    const ctrl = from.clone().lerp(above, 0.5).add(new THREE.Vector3(0, 0.9, 0));
    const hit = h.pos.clone().add(new THREE.Vector3(0, 0.06, 0.06));
    paw.position.copy(from);
    paw.scale.setScalar(0.35);
    cat.swipeAt = performance.now();
    cat.pounce = Math.max(cat.pounce, 0.7);

    const t0 = performance.now();
    let impacted = false;
    const hurt = outcome === "prick" || outcome === "bite";
    const WIND = 110; // lift and show the toe beans
    const STRIKE = 65; // smash down
    const HOLD = hurt ? 120 : 110;
    const BACK = 230;
    const bez = (a: THREE.Vector3, c: THREE.Vector3, b: THREE.Vector3, t: number): THREE.Vector3 =>
      a.clone().multiplyScalar((1 - t) * (1 - t)).addScaledVector(c, 2 * (1 - t) * t).addScaledVector(b, t * t);
    this.anims.push({
      update: (now) => {
        const t = now - t0;
        if (t < WIND) {
          const k = easeOut(t / WIND);
          paw.position.copy(bez(from, ctrl, above, k));
          paw.scale.setScalar(0.35 + 0.65 * k);
          inner.rotation.x = -1.15 * k;
          inner.scale.set(1 + 0.08 * k, 1 - 0.08 * k, 1);
        } else if (t < WIND + STRIKE) {
          const k = easeIn((t - WIND) / STRIKE);
          paw.position.lerpVectors(above, hit, k);
          inner.rotation.x = -1.15 * (1 - k);
          // smear: stretched along the swing
          inner.scale.set(0.88, 1 + 0.3 * Math.sin(k * Math.PI), 0.88);
        } else if (t < WIND + STRIKE + HOLD) {
          if (!impacted) {
            impacted = true;
            paw.position.copy(hit);
            inner.rotation.x = 0;
            this.shockwave(h.pos, hurt ? 0xff9a6a : 0xfff3d6);
            this.impact(h, hole, cat, outcome, label, victim, stuck);
          }
          const k = (t - WIND - STRIKE) / HOLD;
          const sq = Math.sin(Math.min(1, k * 1.6) * Math.PI) * (1 - k);
          inner.scale.set(1 + 0.3 * sq, 1 - 0.32 * sq, 1 + 0.3 * sq);
          // a hurt paw jerks back up and shakes
          if (hurt) {
            paw.position.y = hit.y + easeOut(k) * 0.35;
            paw.position.x = hit.x + Math.sin(t * 0.35) * 0.06 * (1 - k);
          }
        } else {
          const k = (t - WIND - STRIKE - HOLD) / BACK;
          if (k >= 1) {
            this.scene.remove(paw);
            return false;
          }
          const e = easeInOut(k);
          const start = hurt ? hit.clone().add(new THREE.Vector3(0, 0.35, 0)) : hit;
          paw.position.copy(bez(start, ctrl, from, e));
          paw.scale.setScalar(1 - 0.65 * e);
          inner.rotation.x = -0.5 * Math.sin(e * Math.PI);
          inner.scale.set(1, 1, 1);
        }
        return true;
      }
    });
  }

  // A ring of air puffs out along the grass where the paw lands.
  private shockwave(at: THREE.Vector3, color: number): void {
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, depthWrite: false });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.5, 40).rotateX(-Math.PI / 2), mat);
    ring.position.copy(at).setY(0.03);
    ring.renderOrder = 3;
    this.scene.add(ring);
    const t0 = performance.now();
    this.anims.push({
      update: (now) => {
        const k = (now - t0) / 320;
        if (k >= 1) {
          this.scene.remove(ring);
          ring.geometry.dispose();
          mat.dispose();
          return false;
        }
        ring.scale.setScalar(1 + easeOut(k) * 1.1);
        mat.opacity = 0.8 * (1 - k);
        return true;
      }
    });
  }

  /** The snake in `snakeHole` gulps down whatever stands in `victimHole`. */
  eat(snakeHole: number, victimHole: number): void {
    const s = this.holes[snakeHole];
    const v = this.holes[victimHole];
    if (!s || !v || !v.occ) return;
    const victim = v.occ;
    v.occ = null;
    if (s.occ?.kind === "snake") s.occ.lunge = { toward: v.pos.clone(), t: performance.now() };
    this.scene.attach(victim.root);
    const start = victim.root.position.clone();
    const mouth = s.pos.clone().add(new THREE.Vector3(0, 0.75, 0.1));
    const t0 = performance.now();
    this.anims.push({
      update: (now) => {
        const t = Math.min(1, (now - t0 - 120) / 260);
        if (t < 0) return true;
        victim.root.position.lerpVectors(start, mouth, easeIn(t));
        victim.root.scale.setScalar(Math.max(0.001, 1 - t));
        if (t < 1) return true;
        this.disposeOcc(victim);
        this.burst(mouth, 8, 0x9be27a, 0.9);
        return false;
      }
    });
    this.pop(snakeHole, "Gulp!", "gulp");
  }

  cat(slot: 1 | 2, mood: CatMood, ms = 0): void {
    const c = this.cats[slot - 1];
    if (!c) return;
    window.clearTimeout(c.moodTimer);
    this.setCatMood(c, mood);
    if (mood === "catch") c.pounce = 1;
    if (ms) c.moodTimer = window.setTimeout(() => this.setCatMood(c, "idle"), ms);
  }

  /** The cat licks its sore paw for `ms`: no hunting until it's done. */
  lick(slot: 1 | 2, ms: number): void {
    const c = this.cats[slot - 1];
    if (!c) return;
    const now = performance.now();
    c.lickFrom = now;
    c.lickUntil = now + ms;
    window.clearTimeout(c.moodTimer);
    c.moodTimer = window.setTimeout(() => this.setCatMood(c, "idle"), ms);
  }

  isLicking(slot: 1 | 2): boolean {
    const c = this.cats[slot - 1];
    return !!c && c.lickUntil > performance.now();
  }

  /** Put a DOM element (a name tag) above a cat's head. */
  setTag(slot: 1 | 2, el: HTMLElement): void {
    const c = this.cats[slot - 1];
    if (!c) return;
    c.tag = el;
    el.classList.add("lawn3d__tag");
    this.layer.append(el);
  }

  setCatPresent(slot: 1 | 2, present: boolean): void {
    this.cats[slot - 1]?.setOpacity(present ? 1 : 0.35);
  }

  /** Floating label over a hole. */
  pop(hole: number, text: string, kind = ""): void {
    const h = this.holes[hole];
    if (!h || !text) return;
    const p = this.toScreen(h.pos.clone().add(new THREE.Vector3(0, 1.0, 0)));
    const el = document.createElement("span");
    el.className = "pop";
    if (kind) el.dataset.kind = kind;
    el.textContent = text;
    el.style.left = `${p.x}px`;
    el.style.top = `${p.y}px`;
    this.layer.append(el);
    setTimeout(() => el.remove(), 900);
  }

  setMood(mood: Mood): void {
    this.mood = mood;
    this.hemi.color.set(mood === "freeze" ? 0xc8ecff : 0xffe6cc);
    this.sun.color.set(mood === "freeze" ? 0xbfe4ff : 0xffd29a);
    for (const c of this.cats) {
      c.aura.visible = mood === "auto";
    }
  }

  /** Screen position (CSS px, relative to the container) of a hole's opening and its size. */
  holeScreen(hole: number): { x: number; y: number; size: number } {
    const pos = this.holes[hole]?.pos ?? holePos(hole);
    const a = this.toScreen(pos.clone().add(new THREE.Vector3(0, 0.4, 0)));
    const b = this.toScreen(pos.clone().add(new THREE.Vector3(SX, 0.4, 0)));
    return { x: a.x, y: a.y, size: Math.abs(b.x - a.x) };
  }

  shakeIt(amount = 0.08): void {
    if (!reduceMotion) this.shake = amount;
  }

  /** Everything back underground (between rounds). */
  clear(): void {
    for (const h of this.holes) if (h.occ) this.drop(h);
  }

  /** Re-frame the camera, e.g. after the HUD changed size. */
  refit(): void {
    this.fitDirty = true;
  }

  // ---- building ----------------------------------------------------------------

  // Built in small steps that hand the main thread back in between, so the page stays
  // responsive while the lawn is being set up on slow phones.
  private async build(): Promise<void> {
    const scene = this.scene;
    const dusk = new THREE.Color(0x4a3a5c);
    scene.background = dusk;
    scene.fog = new THREE.Fog(dusk, 18, 40);
    scene.add(this.hemi);
    this.sun.position.set(-4, 9, 6);
    this.sun.castShadow = true;
    const sc = this.sun.shadow.camera;
    sc.left = -8;
    sc.right = 8;
    sc.top = 8;
    sc.bottom = -8;
    sc.near = 1;
    sc.far = 30;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.02;
    this.sun.shadow.radius = 4;
    scene.add(this.sun);
    const rim = new THREE.DirectionalLight(0xb0c4ff, 0.6);
    rim.position.set(5, 4, -6);
    scene.add(rim);
    await yieldToMain();

    const ground = new THREE.Mesh(new THREE.CircleGeometry(15, 72), new THREE.MeshLambertMaterial({ map: groundTexture() }));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);
    const beyond = new THREE.Mesh(new THREE.RingGeometry(14.9, 60, 72), new THREE.MeshLambertMaterial({ color: 0x3b6b3f }));
    beyond.rotation.x = -Math.PI / 2;
    beyond.position.y = -0.005;
    scene.add(beyond);
    await yieldToMain();

    this.buildHoles();
    this.setActive(this.wanted, false);
    await yieldToMain();
    this.buildCats();
    await yieldToMain();
    this.buildDecor();
    this.setMood(this.mood);
    await yieldToMain();

    // Compile every shader up front (in parallel where the GPU driver allows), including the
    // critters that aren't on the lawn yet, so the first mouse doesn't cause a hitch.
    const warm = new THREE.Group();
    warm.add(buildMouse(0), buildPorcupine(), buildSnake(), buildPaw(), buildCoin("auto"));
    scene.add(warm);
    try {
      await this.renderer.compileAsync(scene, this.camera);
    } catch {
      /* older drivers: shaders compile on first draw instead */
    }
    scene.remove(warm);
    this.built = true;
    this.fitDirty = true;
    this.snapCamera = true;
    this.start();
  }

  // Each hole is a real pit: an inside wall that darkens towards the floor, and an invisible
  // "mask" disc drawn after the critters and before the lawn. The mask only writes depth, so
  // the grass can't cover the opening, while critters climbing out stay visible inside it.
  private buildHoles(): void {
    const R = 0.42;
    const rimGeo = new THREE.TorusGeometry(R, 0.085, 12, 36);
    rimGeo.rotateX(Math.PI / 2);
    rimGeo.scale(1, 0.5, 1);
    const rimMat = toon(0x8a5a3a);
    const wallGeo = new THREE.CylinderGeometry(R, R * 0.86, PIT_DEPTH + 0.05, 36, 1, true);
    wallGeo.translate(0, -(PIT_DEPTH + 0.05) / 2, 0);
    const wallMat = new THREE.MeshBasicMaterial({ map: wallTexture(), side: THREE.BackSide });
    const floorGeo = new THREE.CircleGeometry(R * 0.86, 32);
    floorGeo.rotateX(-Math.PI / 2);
    floorGeo.translate(0, -PIT_DEPTH - 0.05, 0);
    const floorMat = new THREE.MeshBasicMaterial({ color: 0x07040a });
    const maskGeo = new THREE.CircleGeometry(R, 36);
    maskGeo.rotateX(-Math.PI / 2);
    maskGeo.translate(0, 0.004, 0);
    const maskMat = new THREE.MeshBasicMaterial({ colorWrite: false });
    // soft contact shadow around the lip
    const aoGeo = new THREE.RingGeometry(R * 0.95, R * 1.9, 40);
    aoGeo.rotateX(-Math.PI / 2);
    const aoMat = new THREE.MeshBasicMaterial({ map: aoTexture(), transparent: true, depthWrite: false });
    const glowGeo = new THREE.RingGeometry(0.52, 0.62, 40);
    glowGeo.rotateX(-Math.PI / 2);
    const moundGeo = new THREE.SphereGeometry(0.3, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2);
    moundGeo.scale(1, 0.45, 1);
    const clod = new THREE.SphereGeometry(0.045, 8, 6);

    for (let i = 0; i < HOLES; i++) {
      const pos = holePos(i);
      const group = new THREE.Group();
      group.position.copy(pos);
      const wall = new THREE.Mesh(wallGeo, wallMat);
      const floor = new THREE.Mesh(floorGeo, floorMat);
      wall.renderOrder = floor.renderOrder = -3;
      const mask = new THREE.Mesh(maskGeo, maskMat);
      mask.renderOrder = -1;
      const ao = new THREE.Mesh(aoGeo, aoMat);
      ao.position.y = 0.008;
      ao.renderOrder = 1;
      const rim = new THREE.Mesh(rimGeo, rimMat);
      rim.position.y = 0.012;
      rim.castShadow = true;
      rim.receiveShadow = true;
      const glow = new THREE.Mesh(
        glowGeo,
        new THREE.MeshBasicMaterial({ color: 0xffd66b, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending })
      );
      glow.position.y = 0.02;
      glow.renderOrder = 2;
      for (let k = 0; k < 3; k++) {
        const c = new THREE.Mesh(clod, rimMat);
        const a = k * 2.1 + i;
        c.position.set(Math.cos(a) * 0.58, 0.015, Math.sin(a) * 0.52);
        c.scale.set(1, 0.6, 1);
        c.castShadow = true;
        rim.add(c);
      }
      group.add(wall, floor, mask, ao, rim, glow);
      group.scale.setScalar(0);
      this.scene.add(group);
      const mound = new THREE.Mesh(moundGeo, rimMat);
      mound.position.copy(pos);
      mound.visible = false;
      mound.castShadow = true;
      this.scene.add(mound);
      this.holes.push({ group, glow, mound, pos, active: false, scale: 0, vscale: 0, telegraphUntil: 0, occ: null });
    }
  }

  // The cat sits just behind (portrait) or beside (landscape) the dug part of the lawn, and
  // shuffles back as new holes open.
  private catSpot(slot: 1 | 2): THREE.Vector3 {
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    const now = performance.now();
    this.holes.forEach((h, i) => {
      if (!this.wanted.has(i) && h.telegraphUntil <= now) return;
      minX = Math.min(minX, h.pos.x);
      maxX = Math.max(maxX, h.pos.x);
      minZ = Math.min(minZ, h.pos.z);
      maxZ = Math.max(maxZ, h.pos.z);
    });
    if (minX === Infinity) {
      minX = minZ = -((LAYOUT - 1) / 2) * SX;
      maxX = maxZ = -minX;
    }
    const back = minZ - 1.75;
    const midZ = (minZ + maxZ) / 2 - 0.4;
    if (this.opts.cats === 1) return this.portrait ? new THREE.Vector3(0, 0, back) : new THREE.Vector3(minX - 2.0, 0, midZ);
    const s = slot === 1 ? -1 : 1;
    return this.portrait ? new THREE.Vector3(s * 1.7, 0, back) : new THREE.Vector3(s < 0 ? minX - 2.0 : maxX + 2.0, 0, midZ);
  }

  private buildCats(): void {
    for (let s = 1; s <= this.opts.cats; s++) {
      const slot = s as 1 | 2;
      const model = buildCat();
      const setOpacity = fadeable(model.root);
      casts(model.root);
      const shadow = new THREE.Mesh(
        new THREE.PlaneGeometry(2, 1.6),
        new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false, opacity: 0.6 })
      );
      shadow.rotation.x = -Math.PI / 2;
      shadow.position.set(0, 0.012, 0.05);
      model.root.add(shadow);
      const aura = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: glowTexture(), color: 0xffcf4a, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending })
      );
      aura.scale.set(3.4, 3.4, 1);
      aura.position.set(0, CAT_H * 0.5, -0.3);
      aura.visible = false;
      model.root.add(aura);
      setCatFace(model, "idle");
      this.scene.add(model.root);
      const ring = document.createElement("div");
      ring.className = "lick-ring";
      ring.hidden = true;
      ring.innerHTML = `<span class="lick-ring__dial"></span>`;
      this.layer.append(ring);
      this.cats.push({
        slot, model, aura, setOpacity, yaw: 0, mood: "idle", moodTimer: 0, lickFrom: 0, lickUntil: 0, swipeAt: 0, pounce: 0, spot: new THREE.Vector3(), ring, tag: null
      });
    }
    this.placeCats();
  }

  // Cats face the lawn, turned partly towards the camera so their faces stay visible.
  private placeCats(snap = true): void {
    for (const c of this.cats) {
      const p = this.catSpot(c.slot);
      c.spot.copy(p);
      if (snap) c.model.root.position.copy(p);
      // mostly facing the camera, with a slight turn towards the holes
      c.yaw = this.portrait ? -p.x * 0.1 : Math.sign(-p.x) * 0.3;
      c.model.root.rotation.y = c.yaw;
    }
  }

  private buildDecor(): void {
    const rnd = mulberry(7);
    const keepOut = (x: number, z: number): boolean =>
      (Math.abs(x) < 3.7 && z > -4.6 && z < 3.1) || (Math.abs(x) < 6 && Math.abs(z + 0.4) < 1.9);
    const spot = (minR: number, maxR: number): THREE.Vector3 => {
      for (let n = 0; n < 60; n++) {
        const a = rnd() * Math.PI * 2;
        const r = minR + rnd() * (maxR - minR);
        const p = new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r * 0.9);
        if (!keepOut(p.x, p.z)) return p;
      }
      return new THREE.Vector3(10, 0, 10);
    };

    // round shrubs framing the lawn
    const leaf = [0x4f8f4a, 0x5f9f4f, 0x467f44].map((c) => toon(c));
    const blob = new THREE.IcosahedronGeometry(0.5, 2);
    for (let k = 0; k < 22; k++) {
      const g = new THREE.Group();
      const n = 2 + Math.floor(rnd() * 3);
      for (let b = 0; b < n; b++) {
        const m = new THREE.Mesh(blob, leaf[b % leaf.length]!);
        m.position.set((rnd() - 0.5) * 0.9, 0.3 + rnd() * 0.25, (rnd() - 0.5) * 0.6);
        m.scale.setScalar(0.6 + rnd() * 0.6);
        g.add(m);
      }
      if (rnd() < 0.5) {
        for (let f = 0; f < 4; f++) {
          const berry = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), toon([0xffa3c7, 0xfff1a8, 0xffffff][f % 3]!));
          berry.position.set((rnd() - 0.5) * 0.9, 0.55 + rnd() * 0.3, 0.3 + rnd() * 0.2);
          g.add(berry);
        }
      }
      g.position.copy(spot(5.2, 12));
      g.scale.setScalar(0.9 + rnd() * 0.9);
      casts(g);
      this.scene.add(g);
    }

    // mushrooms and flower clumps
    const capGeo = new THREE.SphereGeometry(0.16, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    const stemGeo = new THREE.CylinderGeometry(0.05, 0.065, 0.18, 10);
    const dotGeo = new THREE.SphereGeometry(0.025, 6, 4);
    const white = toon(0xfff3e0);
    const caps = [0xe2574c, 0xf08a4b, 0xc76bd1].map((c) => toon(c));
    for (let k = 0; k < 9; k++) {
      const g = new THREE.Group();
      const stem = new THREE.Mesh(stemGeo, white);
      stem.position.y = 0.09;
      const cap = new THREE.Mesh(capGeo, caps[k % caps.length]!);
      cap.position.y = 0.16;
      cap.scale.set(1, 0.8, 1);
      for (let d = 0; d < 4; d++) {
        const dot = new THREE.Mesh(dotGeo, white);
        const a = (d / 4) * Math.PI * 2 + k;
        dot.position.set(Math.cos(a) * 0.09, 0.1, Math.sin(a) * 0.09);
        cap.add(dot);
      }
      g.add(stem, cap);
      g.position.copy(spot(3.9, 8));
      g.scale.setScalar(0.9 + rnd() * 0.8);
      casts(g);
      this.scene.add(g);
    }
    const petal = new THREE.SphereGeometry(0.06, 8, 6);
    const petals = [0xffa3c7, 0xfff1a8, 0xc9b6ff, 0xffffff].map((c) => toon(c));
    const yolk = toon(0xffc83a);
    for (let k = 0; k < 18; k++) {
      const clump = new THREE.Group();
      const base = spot(3.8, 10);
      for (let f = 0; f < 3; f++) {
        const g = new THREE.Group();
        for (let p = 0; p < 5; p++) {
          const m = new THREE.Mesh(petal, petals[k % petals.length]!);
          const a = (p / 5) * Math.PI * 2;
          m.position.set(Math.cos(a) * 0.065, 0.12, Math.sin(a) * 0.065);
          m.scale.set(1, 0.5, 1);
          g.add(m);
        }
        const c = new THREE.Mesh(dotGeo, yolk);
        c.position.y = 0.13;
        g.add(c);
        g.position.set((rnd() - 0.5) * 0.4, 0, (rnd() - 0.5) * 0.4);
        clump.add(g);
      }
      clump.position.copy(base);
      this.scene.add(clump);
    }

    // fireflies
    const fly = new THREE.SpriteMaterial({ map: glowTexture(), color: 0xf0ff9a, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    for (let k = 0; k < (reduceMotion ? 6 : 18); k++) {
      const s = new THREE.Sprite(fly.clone());
      s.scale.setScalar(0.14);
      const base = spot(3.5, 9);
      base.y = 0.5 + rnd() * 1.4;
      this.scene.add(s);
      this.fireflies.push({ s, base, ph: rnd() * 10, sp: 0.4 + rnd() * 0.5 });
    }
  }

  // ---- occupants -------------------------------------------------------------------

  private makeOccupant(kind: Critter, variant: number | null, h: HoleView): Occupant {
    const root = new THREE.Group();
    let body: THREE.Group;
    let up = -0.08;
    let down = -1.0;
    if (kind === "snake") {
      body = buildSnake();
      up = 0;
      down = -1.9;
    } else if (kind === "porcupine") {
      body = buildPorcupine();
      up = -0.06;
      down = -0.85;
    } else if (kind === "mouse" || kind === "fancy") {
      body = buildMouse(kind === "fancy" ? variant ?? 0 : null);
    } else {
      body = buildCoin(kind);
      up = 0.05;
      down = -0.9;
    }
    root.add(body);
    drawOrder(body, -2);
    casts(body);
    h.group.add(root);
    body.position.y = down;
    const occ: Occupant = { kind, root, body, y: down, vy: 0, up, down, target: up, phase: Math.random() * 6, sparkAt: 0 };
    if (kind === "fancy") this.burst(h.pos.clone().add(new THREE.Vector3(0, 0.5, 0)), 12, 0xffd66b, 1.2);
    return occ;
  }

  // Take a critter out of its hole: it sinks, then goes away.
  private drop(h: HoleView): void {
    const occ = h.occ;
    if (!occ) return;
    h.occ = null;
    occ.target = occ.down;
    const t0 = performance.now();
    this.anims.push({
      update: (now, dt) => {
        this.stepSpring(occ, dt);
        occ.body.position.y = occ.y;
        if (now - t0 < 400) return true;
        this.disposeOcc(occ);
        return false;
      }
    });
  }

  private disposeOcc(occ: Occupant): void {
    occ.root.removeFromParent();
    disposeClones(occ.root);
  }

  private impact(
    h: HoleView, hole: number, cat: CatView, outcome: SlapOutcome, label: string,
    victim: Occupant | null, stuck: Occupant | null
  ): void {
    const top = h.pos.clone().add(new THREE.Vector3(0, 0.4, 0.1));
    if (label) this.pop(hole, label, outcome);
    switch (outcome) {
      case "whiff":
        this.dust(h.pos, 8);
        break;
      case "prick":
        this.burst(top, 12, 0xff8a3d, 1.4);
        this.shakeIt(0.1);
        if (stuck) stuck.vy += 3;
        break;
      case "bite":
        this.burst(top, 10, 0x7fe07a, 1.3);
        this.shakeIt(0.1);
        if (stuck?.kind === "snake") stuck.lunge = { toward: h.pos.clone().add(new THREE.Vector3(0, 0, 0.6)), t: performance.now() };
        break;
      case "collect":
        this.burst(top, 18, 0x7fffe0, 1.5);
        if (victim) this.flyToCat(victim, cat);
        break;
      case "catch":
        this.shakeIt(victim?.kind === "fancy" ? 0.08 : 0.04);
        if (victim) this.poof(victim, h, victim.kind === "fancy");
        break;
    }
  }

  // Squish, then a puff of sparkles and hearts: the mouse is caught.
  private poof(victim: Occupant, h: HoleView, fancy: boolean): void {
    const t0 = performance.now();
    this.anims.push({
      update: (now) => {
        const t = (now - t0) / 130;
        if (t < 1) {
          victim.body.scale.set(1 + 0.4 * t, 1 - 0.65 * t, 1 + 0.4 * t);
          return true;
        }
        const at = h.pos.clone().add(new THREE.Vector3(0, 0.35, 0.1));
        this.burst(at, fancy ? 22 : 10, fancy ? 0xffd66b : 0xfff3c4, 1.3);
        this.emit(at, fancy ? 8 : 4, 0xff8fb1, 1.2, heartTexture(), false, -0.6, 0.22);
        this.dust(h.pos, 5);
        this.disposeOcc(victim);
        return false;
      }
    });
  }

  private flyToCat(victim: Occupant, cat: CatView): void {
    this.scene.attach(victim.root);
    const start = victim.root.position.clone();
    const end = cat.model.root.position.clone().add(new THREE.Vector3(0, CAT_H * 0.6, 0.2));
    const t0 = performance.now();
    this.anims.push({
      update: (now) => {
        const t = Math.min(1, (now - t0) / 450);
        victim.root.position.lerpVectors(start, end, easeIn(t));
        victim.root.position.y += Math.sin(t * Math.PI) * 0.8;
        victim.root.scale.setScalar(1 - t * 0.8);
        if (t < 1) return true;
        this.burst(end, 14, 0x7fffe0, 1.2);
        this.disposeOcc(victim);
        return false;
      }
    });
  }

  private setCatMood(c: CatView, mood: CatMood): void {
    c.mood = mood;
    if (c.lickUntil <= performance.now()) setCatFace(c.model, mood as CatFace);
  }

  // ---- particles -----------------------------------------------------------------

  private emit(pos: THREE.Vector3, count: number, color: number, speed: number, map: THREE.Texture, additive: boolean, gravity: number, size: number): void {
    const n = reduceMotion ? Math.ceil(count / 3) : count;
    for (let i = 0; i < n; i++) {
      const s = this.spritePool.pop() ?? new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false }));
      this.scene.add(s);
      const mat = s.material;
      mat.map = map;
      mat.color.set(color);
      mat.blending = additive ? THREE.AdditiveBlending : THREE.NormalBlending;
      mat.opacity = 1;
      mat.rotation = 0;
      mat.needsUpdate = true;
      s.position.copy(pos);
      const a = Math.random() * Math.PI * 2;
      const v = new THREE.Vector3(Math.cos(a), 0.6 + Math.random() * 1.2, Math.sin(a) * 0.6).multiplyScalar(speed * (0.5 + Math.random() * 0.8));
      const life = 0.45 + Math.random() * 0.45;
      this.particles.push({ sprite: s, vel: v, life, max: life, size: size * (0.6 + Math.random() * 0.8), gravity, spin: (Math.random() - 0.5) * 6 });
    }
  }

  private burst(pos: THREE.Vector3, count: number, color: number, speed: number): void {
    this.emit(pos, count, color, speed * 1.6, starTexture(), true, 5, 0.16);
  }

  private dust(pos: THREE.Vector3, count: number): void {
    this.emit(pos.clone().add(new THREE.Vector3(0, 0.08, 0.1)), count, 0xb08a68, 1.1, glowTexture(), false, 2.5, 0.24);
  }

  // ---- loop --------------------------------------------------------------------------

  private start(): void {
    if (this.raf) return;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  private frame = (now: number): void => {
    this.raf = 0;
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.time += dt;
    if (this.built && (!this.calm || now - this.lastDraw > 45)) {
      const step = this.calm ? Math.min(0.05, (now - this.lastDraw) / 1000) : dt;
      this.lastDraw = now;
      this.update(now, step);
      this.renderer.render(this.scene, this.camera);
      if (!this.calm) this.watchFrameRate(dt * 1000);
    }
    this.raf = requestAnimationFrame(this.frame);
  };

  // Phones that can't keep up get a lighter lawn, one step at a time: sharper shadows are
  // dropped first, then shadows altogether, then resolution. The level sticks for next visit.
  private watchFrameRate(frameMs: number): void {
    if (this.quality >= 3 || document.hidden) return;
    this.sampledFrames += 1;
    if (this.sampledFrames < 60) return; // ignore the first second (shader compiles, loading)
    if (frameMs > 26) this.slowFrames += 1;
    if (this.sampledFrames < 240) return;
    if (this.slowFrames > 90) {
      this.quality += 1;
      this.applyQuality(true);
      try {
        localStorage.setItem(QUALITY_KEY, String(this.quality));
      } catch {
        /* storage unavailable */
      }
    }
    this.sampledFrames = 0;
    this.slowFrames = 0;
  }

  private applyQuality(live: boolean): void {
    const q = this.quality;
    const dpr = devicePixelRatio || 1;
    this.renderer.setPixelRatio(q >= 3 ? Math.min(dpr, 0.85) : q >= 2 ? Math.min(dpr, 1.25) : Math.min(dpr, q >= 1 ? 1.6 : 2));
    const shadows = q < 2;
    const size = q === 0 && Math.min(screen.width, screen.height) > 700 ? 2048 : 1024;
    this.renderer.shadowMap.enabled = shadows;
    this.renderer.shadowMap.type = q === 0 ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    this.sun.shadow.mapSize.set(size, size);
    if (live) {
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
      this.scene.traverse((o) => {
        const m = (o as THREE.Mesh).material;
        if (m) for (const mat of Array.isArray(m) ? m : [m]) mat.needsUpdate = true;
      });
      if (this.width > 1) this.renderer.setSize(this.width, this.height, false);
    }
  }

  private update(now: number, dt: number): void {
    if (this.fitDirty) this.fit();
    const k = this.snapCamera ? 1 : 1 - Math.exp(-dt * 2.4);
    this.snapCamera = false;
    this.camTarget.lerp(this.wantTarget, k);
    this.camDist += (this.wantDist - this.camDist) * k;
    this.placeCamera(this.camTarget, this.camDist);
    if (this.shake > 0.001) {
      this.camera.position.x += (Math.random() - 0.5) * this.shake;
      this.camera.position.y += (Math.random() - 0.5) * this.shake;
      this.shake *= Math.exp(-dt * 14);
    }

    for (const h of this.holes) {
      const want = h.active ? 1 : 0;
      h.vscale += ((want - h.scale) * 220 - h.vscale * 16) * dt;
      h.scale += h.vscale * dt;
      if (!h.active && h.scale < 0.02) h.scale = 0;
      h.group.scale.setScalar(Math.max(0, h.scale));
      h.group.visible = h.scale > 0.001;
      const tele = h.telegraphUntil > now && !h.active;
      h.mound.visible = tele;
      if (tele) {
        const wob = Math.sin(this.time * 16) * 0.12;
        h.mound.scale.set(1 + wob, 1 + Math.abs(wob) * 2, 1 - wob);
      }
      const occ = h.occ;
      const glowMat = h.glow.material as THREE.MeshBasicMaterial;
      glowMat.opacity += ((occ?.kind === "fancy" ? 0.3 + Math.sin(this.time * 8) * 0.12 : 0) - glowMat.opacity) * Math.min(1, dt * 10);
      if (occ) this.updateOccupant(occ, h, now, dt);
    }

    for (const c of this.cats) this.updateCat(c, now, dt);

    for (let i = this.anims.length - 1; i >= 0; i--) if (!this.anims[i]!.update(now, dt)) this.anims.splice(i, 1);

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i]!;
      p.life -= dt;
      if (p.life <= 0) {
        p.sprite.removeFromParent();
        this.spritePool.push(p.sprite);
        this.particles.splice(i, 1);
        continue;
      }
      p.vel.y -= p.gravity * dt;
      p.sprite.position.addScaledVector(p.vel, dt);
      const t = p.life / p.max;
      p.sprite.material.opacity = Math.min(1, t * 1.6);
      p.sprite.material.rotation += p.spin * dt;
      p.sprite.scale.setScalar(p.size * (0.6 + t * 0.6));
    }

    for (const f of this.fireflies) {
      const t = this.time * f.sp + f.ph;
      f.s.position.set(f.base.x + Math.sin(t) * 0.6, f.base.y + Math.sin(t * 1.7) * 0.25, f.base.z + Math.cos(t * 0.8) * 0.5);
      f.s.material.opacity = 0.3 + 0.7 * Math.max(0, Math.sin(t * 2.3));
    }
  }

  private updateCat(c: CatView, now: number, dt: number): void {
    const m = c.model;
    const away = c.spot.clone().sub(m.root.position);
    if (away.lengthSq() > 0.0004) {
      // little hops towards the new spot
      const step = Math.min(away.length(), dt * 1.6);
      m.root.position.addScaledVector(away.normalize(), step);
      m.body.position.y = Math.abs(Math.sin(this.time * 12)) * 0.08;
    } else {
      m.body.position.y = 0;
    }
    c.pounce = Math.max(0, c.pounce - dt * 3.2);
    const squash = Math.sin(c.pounce * Math.PI) * 0.07;
    const breathe = Math.sin(this.time * 1.9 + c.slot) * 0.012;
    m.body.scale.set(1 + squash, 1 - squash + breathe, 1 + squash);
    const licking = c.lickUntil > now;
    // the right arm: a quick swipe when slapping, up at the mouth when licking
    const swipe = (now - c.swipeAt) / 380;
    let armX = 0;
    let armZ = 0;
    if (licking) {
      setCatFace(m, "lick");
      const bob = Math.sin(this.time * 14);
      armX = -2.1 + bob * 0.12;
      armZ = 0.55;
      m.head.rotation.set(0.18 + bob * 0.04, 0, -0.12);
    } else {
      if (c.mood === "idle" && m.tongue.position.z > 0.42) setCatFace(m, c.mood);
      m.head.rotation.set(-0.22 + Math.sin(this.time * 0.9 + c.slot) * 0.03, Math.sin(this.time * 0.6 + c.slot) * 0.08, 0);
      if (swipe >= 0 && swipe < 1) armX = -Math.sin(swipe * Math.PI) * 1.9;
    }
    m.arm.rotation.x += (armX - m.arm.rotation.x) * Math.min(1, dt * 20);
    m.arm.rotation.z += (armZ - m.arm.rotation.z) * Math.min(1, dt * 20);
    // the tail sways as a wave that runs down to the curled tip
    m.tail.forEach((seg, i) => {
      const bend = seg.userData.bend as { x: number; y: number };
      const flick = c.mood === "angry" ? 2.2 : 1;
      seg.rotation.y = bend.y + Math.sin(this.time * 1.8 * flick - i * 0.45 + c.slot) * (0.05 + i * 0.006) * flick;
      seg.rotation.x = bend.x + Math.sin(this.time * 1.2 - i * 0.3) * 0.02;
    });
    c.aura.material.opacity = 0.4 + Math.sin(this.time * 6) * 0.12;

    const head = this.toScreen(m.root.position.clone().add(new THREE.Vector3(0, CAT_H + 0.2, 0)));
    c.ring.hidden = !licking;
    if (licking) {
      c.ring.style.left = `${head.x}px`;
      c.ring.style.top = `${head.y}px`;
      c.ring.style.setProperty("--p", String((c.lickUntil - now) / (c.lickUntil - c.lickFrom)));
      if (Math.random() < dt * 3) this.emit(m.root.position.clone().add(new THREE.Vector3(0.25, CAT_H * 0.7, 0.4)), 1, 0x9fe3ff, 0.4, glowTexture(), false, 0.5, 0.09);
    }
    if (c.tag) {
      c.tag.style.left = `${head.x}px`;
      c.tag.style.top = `${head.y}px`;
    }
  }

  private updateOccupant(occ: Occupant, h: HoleView, now: number, dt: number): void {
    this.stepSpring(occ, dt);
    occ.body.position.y = occ.y;
    const t = this.time + occ.phase;
    switch (occ.kind) {
      case "snake": {
        const { segs, head, eyes, tongue } = occ.body.userData as {
          segs: THREE.Object3D[];
          head: THREE.Object3D;
          eyes: THREE.Object3D[];
          tongue: THREE.Object3D;
        };
        // the body rises out of the pit as an S that keeps travelling upward
        const lunge = occ.lunge ? Math.min(1, (now - occ.lunge.t) / 420) : 1;
        if (occ.lunge && lunge >= 1) occ.lunge = undefined;
        const reach = occ.lunge ? Math.sin(lunge * Math.PI) : 0;
        let lx = 0;
        let lz = 0;
        if (occ.lunge) {
          const d = occ.lunge.toward.clone().sub(h.pos).setY(0).normalize();
          lx = d.x;
          lz = d.z;
        }
        const n = SNAKE_SEGMENTS;
        let prev = new THREE.Vector3();
        for (let i = 0; i < n; i++) {
          const k = i / (n - 1);
          const wave = this.time * 3.2 - i * 0.55;
          const amp = 0.04 + 0.07 * k;
          const lean = reach * k * k * 0.55;
          const p = new THREE.Vector3(Math.sin(wave) * amp + lx * lean, i * 0.075 - 0.45, Math.cos(wave * 0.8) * amp * 0.5 + lz * lean);
          segs[i]!.position.copy(p);
          prev = p;
        }
        const top = prev;
        const breath = Math.sin(this.time * 2.1) * 0.03;
        head.position.set(top.x, top.y + 0.13 + breath + reach * 0.1, top.z + 0.03);
        const look = occ.lunge ? Math.atan2(lx, lz) : Math.sin(this.time * 1.1) * 0.35;
        head.rotation.y += (look - head.rotation.y) * Math.min(1, dt * 10);
        head.rotation.z = Math.sin(this.time * 3.2 - n * 0.55) * 0.18;
        head.rotation.x = -reach * 0.3;
        // blink every few seconds
        const blink = (this.time + occ.phase) % 3.4 < 0.12 ? 0.1 : 1;
        for (const e of eyes) e.scale.y += (blink - e.scale.y) * Math.min(1, dt * 30);
        // tongue: quick eased flicks with a wiggle
        const f = ((this.time + occ.phase) % 1.3) / 1.3;
        const out = f < 0.28 ? Math.sin((f / 0.28) * Math.PI) : 0;
        tongue.scale.z = Math.max(0.01, out * (1 + reach));
        tongue.rotation.y = Math.sin(this.time * 40) * 0.25 * out;
        break;
      }
      case "auto":
      case "fulltime":
      case "freeze": {
        const coin = occ.body.getObjectByName("coin");
        if (coin) {
          coin.rotation.y = Math.sin(t * 2) * 0.6;
          coin.position.y = 0.42 + Math.sin(t * 4) * 0.05;
        }
        break;
      }
      case "porcupine":
        occ.body.scale.set(1 + Math.sin(t * 3) * 0.02, 1 - Math.sin(t * 3) * 0.02, 1);
        break;
      default: {
        const head = occ.body.getObjectByName("head");
        if (head) head.rotation.set(Math.sin(t * 5) * 0.06, Math.sin(t * 2.3) * 0.25, Math.sin(t * 3.1) * 0.08);
        const prop = occ.body.getObjectByName("propeller");
        if (prop) prop.rotation.y += dt * 18;
        if (occ.kind === "fancy" && now > occ.sparkAt && occ.target === occ.up) {
          occ.sparkAt = now + 150;
          const p = h.pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.6, 0.5 + Math.random() * 0.6, 0.2));
          this.emit(p, 1, Math.random() < 0.5 ? 0xffd66b : 0xffffff, 0.3, starTexture(), true, -0.4, 0.12);
        }
      }
    }
  }

  private stepSpring(o: Occupant, dt: number): void {
    // a slightly bouncy spring: critters pop up with a little overshoot
    const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      o.vy += ((o.target - o.y) * 320 - o.vy * 24) * h;
      o.y += o.vy * h;
    }
  }

  // ---- camera ------------------------------------------------------------------------

  private resize(): void {
    const el = this.opts.container;
    const w = Math.max(1, el.clientWidth);
    const hgt = Math.max(1, el.clientHeight);
    this.width = w;
    this.height = hgt;
    this.renderer.setSize(w, hgt, false);
    this.camera.aspect = w / hgt;
    this.camera.updateProjectionMatrix();
    const portrait = w / hgt < 1.1;
    if (portrait !== this.portrait) {
      this.portrait = portrait;
      this.placeCats();
    }
    this.elevation = THREE.MathUtils.degToRad(portrait ? 54 : 46);
    this.fitDirty = true;
    this.snapCamera = true;
  }

  private placeCamera(target: THREE.Vector3, dist: number): void {
    const e = this.elevation;
    this.camera.position.set(target.x, target.y + Math.sin(e) * dist, target.z + Math.cos(e) * dist);
    this.camera.lookAt(target);
    this.camera.updateMatrixWorld();
  }

  // Frame the open holes and the cats inside the part of the screen the HUD leaves free.
  private fit(): void {
    this.fitDirty = false;
    const pts: THREE.Vector3[] = [];
    const now = performance.now();
    this.holes.forEach((h, i) => {
      if (!h.active && h.telegraphUntil <= now && !this.wanted.has(i)) return;
      for (const [dx, dz] of [[-0.62, -0.5], [0.62, -0.5], [-0.62, 0.55], [0.62, 0.55]] as const) pts.push(h.pos.clone().add(new THREE.Vector3(dx, 0, dz)));
      pts.push(h.pos.clone().add(new THREE.Vector3(0, CRITTER_H, 0)));
    });
    if (!pts.length) for (let i = 0; i < HOLES; i++) pts.push(holePos(i));
    for (const c of this.cats) {
      const p = c.spot;
      pts.push(p.clone().add(new THREE.Vector3(-0.9, 0, 0.7)), p.clone().add(new THREE.Vector3(0.9, 0, 0.7)));
      pts.push(p.clone().add(new THREE.Vector3(0, CAT_H + 0.1, 0)));
    }

    const ins = this.opts.insets();
    const W = this.width;
    const H = this.height;
    const box = { l: -1 + (2 * ins.left) / W, r: 1 - (2 * ins.right) / W, b: -1 + (2 * ins.bottom) / H, t: 1 - (2 * ins.top) / H };
    const boxW = Math.max(0.3, box.r - box.l) * 0.96;
    const boxH = Math.max(0.3, box.t - box.b) * 0.96;
    const min = new THREE.Vector3(Infinity, Infinity, Infinity);
    const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
    for (const p of pts) {
      min.min(p);
      max.max(p);
    }
    const target = new THREE.Vector3().addVectors(min, max).multiplyScalar(0.5).setY(0);

    const v = new THREE.Vector3();
    const measure = (t: THREE.Vector3, d: number): { w: number; h: number; cx: number; cy: number } => {
      this.placeCamera(t, d);
      let x0 = Infinity;
      let x1 = -Infinity;
      let y0 = Infinity;
      let y1 = -Infinity;
      for (const p of pts) {
        v.copy(p).project(this.camera);
        x0 = Math.min(x0, v.x);
        x1 = Math.max(x1, v.x);
        y0 = Math.min(y0, v.y);
        y1 = Math.max(y1, v.y);
      }
      return { w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
    };

    let dist = 14;
    for (let pass = 0; pass < 3; pass++) {
      let lo = 2;
      let hi = 90;
      for (let i = 0; i < 24; i++) {
        const mid = (lo + hi) / 2;
        const m = measure(target, mid);
        if (m.w <= boxW && m.h <= boxH) hi = mid;
        else lo = mid;
      }
      dist = Math.max(hi, 7);
      const m = measure(target, dist);
      const halfH = dist * Math.tan(THREE.MathUtils.degToRad(FOV / 2));
      const halfW = halfH * this.camera.aspect;
      const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0);
      const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 1);
      target.addScaledVector(right, (m.cx - (box.l + box.r) / 2) * halfW);
      target.addScaledVector(up, (m.cy - (box.b + box.t) / 2) * halfH);
    }
    this.wantTarget.copy(target);
    this.wantDist = dist;
    this.placeCamera(this.camTarget, this.camDist);
  }

  private toScreen(p: THREE.Vector3): { x: number; y: number } {
    const v = p.clone().project(this.camera);
    return { x: ((v.x + 1) / 2) * this.width, y: ((1 - v.y) / 2) * this.height };
  }

  // Taps snap to the nearest open hole, measured to the whole standing critter so tall
  // targets are easy to hit, not just to the hole's opening.
  private pick(x: number, y: number): number {
    let best = -1;
    let bestD = Infinity;
    let reach = 0;
    this.holes.forEach((h, i) => {
      if (!h.active) return;
      const a = this.toScreen(h.pos);
      const b = this.toScreen(h.pos.clone().add(new THREE.Vector3(0, h.occ ? 0.85 : 0.3, 0)));
      const s = this.toScreen(h.pos.clone().add(new THREE.Vector3(SX, 0, 0)));
      reach = Math.max(reach, Math.abs(s.x - a.x) * 0.62);
      const d = segDist(x, y, a.x, a.y, b.x, b.y) - (h.occ ? 6 : 0);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    return bestD <= reach ? best : -1;
  }
}

// ---- helpers ------------------------------------------------------------------------

function easeOut(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function easeIn(t: number): number {
  return t * t;
}

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

let ao: THREE.Texture | null = null;
/** Soft dark falloff for the ring of grass around each hole. */
function aoTexture(): THREE.Texture {
  if (ao) return ao;
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(64, 64, 30, 64, 64, 64);
  g.addColorStop(0, "rgba(25,12,20,.5)");
  g.addColorStop(1, "rgba(25,12,20,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  ao = new THREE.CanvasTexture(c);
  return ao;
}

function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function mulberry(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const QUALITY_KEY = "tilcayo.quality";

function yieldToMain(): Promise<void> {
  const sched = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  return sched?.yield ? sched.yield() : new Promise((r) => setTimeout(r, 0));
}

/** Resolves once the first frame is on screen and the browser has a quiet moment. */
function afterFirstPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() =>
      setTimeout(() => {
        if ("requestIdleCallback" in window) requestIdleCallback(() => resolve(), { timeout: 400 });
        else resolve();
      }, 0)
    );
  });
}

/** Where to start: the level a previous visit settled on, or a lighter one for small devices. */
function startQuality(): number {
  try {
    const saved = Number(localStorage.getItem(QUALITY_KEY));
    if (saved >= 1 && saved <= 3) return saved;
  } catch {
    /* storage unavailable */
  }
  const nav = navigator as Navigator & { deviceMemory?: number };
  const weak = (nav.hardwareConcurrency ?? 8) <= 4 || (nav.deviceMemory ?? 8) <= 3;
  return weak ? 1 : 0;
}

/** The lawn needs WebGL 2 (every browser from the last few years has it). */
export function webgl2Available(): boolean {
  try {
    return !!document.createElement("canvas").getContext("webgl2");
  } catch {
    return false;
  }
}

/** Mark a model's meshes as shadow casters (the ink hulls don't need to). */
function casts(obj: THREE.Object3D): void {
  obj.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && o.name !== "ink") o.castShadow = true;
  });
}

function drawOrder(obj: THREE.Object3D, order: number): void {
  obj.traverse((o) => (o.renderOrder = order));
}
