import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { loadArt, glowTexture, starTexture, heartTexture, shadowTexture, grassTexture, groundColor } from "./art";
import {
  toon, buildCat, setCatFace, setLids, setEar, faceLids, faceEars, buildMouse, buildPorcupine, buildPaw, buildCoin, buildSnake, buildLizard, fadeable, disposeClones,
  fancyThumb, catThumb, lizardThumb, wallTexture, PIT_DEPTH, SNAKE_SEGMENTS, type CatModel, type CatFace
} from "./models";
import type { SkinId } from "../shop";

// The 3D lawn shared by the solo game and the 1v1 arena. Game rules live elsewhere: this class
// only shows what it is told (critters rising, paws slapping, snakes gulping) and reports which
// hole a tap landed on. The world is a fixed 5×5 layout of hole spots; the game decides which
// holes are open, so the lawn can grow one hole at a time.

export const LAYOUT = 5;
export const HOLES = LAYOUT * LAYOUT;

export type Critter = "mouse" | "fancy" | "lizard" | "porcupine" | "snake" | "auto" | "fulltime" | "freeze";
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
  /** a block of ice around whatever stands in the hole while Freeze is on */
  ice: THREE.Mesh | null;
}

interface CatView {
  slot: 1 | 2;
  model: CatModel;
  present: boolean;
  aura: THREE.Sprite;
  setOpacity: (o: number) => void;
  yaw: number;
  mood: CatMood;
  moodTimer: number;
  lickFrom: number;
  lickUntil: number;
  swipeAt: number;
  /** slapping paws currently out on the lawn (the arm hides while any is) */
  pawsOut: number;
  pounce: number;
  /** where the cat is heading (it walks there when the lawn grows) */
  spot: THREE.Vector3;
  ring: HTMLElement;
  tag: HTMLElement | null;
  /** the face currently shown (mood, or "lick" while licking) */
  face: CatFace;
  /** eyes: lids eased towards the mood, blinks layered on top, quick saccades for the gaze */
  lid: number;
  lidTilt: number;
  blinkAt: number;
  blinkSlow: boolean;
  nextBlink: number;
  eyeYaw: number;
  eyePitch: number;
  gazeYaw: number;
  gazePitch: number;
  nextSaccade: number;
  /** ears: a damped spring per ear and axis (x, y, z rotation), flicked by impulses */
  ears: EarSpring[];
  nextTwitch: number;
  twitchAgain: number;
  twitchEar: number;
  lastHeadYaw: number;
  lastHeadPitch: number;
  lastPounce: number;
  /** 0..1, how much the cat is in hunting mode (prey on the lawn) */
  hunt: number;
  headYaw: number;
  headPitch: number;
}

interface EarSpring {
  p: THREE.Vector3;
  v: THREE.Vector3;
}

/** How shut a blink is (0..1) `t` ms after it started: a snappy close, a slower open. */
function blinkAmount(t: number, slow: boolean): number {
  const [close, hold, open] = slow ? [260, 360, 460] : [60, 40, 130];
  if (t < 0) return 0;
  if (t < close) return easeIn(t / close);
  if (t < close + hold) return 1;
  t -= close + hold;
  return t < open ? 1 - easeOut(t / open) : 0;
}

const EAR_K = 170;
const EAR_D = 10.5;

/** A happy squint or a lick doesn't blink. */
function blinks(face: CatFace): boolean {
  return face === "idle" || face === "angry" || face === "sad";
}

/** A quick flick: the ear snaps back and out, and its spring brings it home. */
function flickEar(c: CatView, i: number): void {
  const e = c.ears[i]!;
  e.v.x -= 13;
  e.v.y -= (i === 0 ? 1 : -1) * 5;
}

type RestingFace = Pick<CatView, "lid" | "lidTilt" | "blinkAt" | "blinkSlow" | "nextBlink" | "eyeYaw" | "eyePitch" | "gazeYaw" | "gazePitch" | "nextSaccade" |
  "ears" | "nextTwitch" | "twitchAgain" | "twitchEar" | "lastHeadYaw" | "lastHeadPitch" | "lastPounce">;

/** Eyes open and ears at rest, for a cat that just sat down. */
function restingFace(now: number): RestingFace {
  const { lid, tilt } = faceLids("idle");
  const ear = faceEars("idle");
  return {
    lid, lidTilt: tilt, blinkAt: -1e9, blinkSlow: false, nextBlink: now + 1500,
    eyeYaw: 0, eyePitch: 0, gazeYaw: 0, gazePitch: 0, nextSaccade: now + 800,
    ears: [1, -1].map((s) => ({ p: new THREE.Vector3(ear.x, -s * ear.y, s * ear.z), v: new THREE.Vector3() })),
    nextTwitch: now + 2500, twitchAgain: 0, twitchEar: 0, lastHeadYaw: 0, lastHeadPitch: -0.22, lastPounce: 0
  };
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
  // the cats glance at whatever just popped out of a hole
  private readonly lookTarget = new THREE.Vector3();
  private lookUntil = 0;
  private readonly skins: [SkinId, SkinId] = ["grey", "grey"];
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
  // the world's own clock: it stops while Freeze is on, so every critter, the fireflies and
  // the cats' idle motion hold still (paws, pops and particles keep running on real time)
  private wtime = 0;
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

  /** A portrait of one of the shop's cats (data URL). */
  catThumbnail(skin: SkinId): string {
    return this.built ? catThumb(skin, this.renderer) : "";
  }

  /** A portrait of the yellow lizard (data URL). */
  lizardThumbnail(): string {
    return this.built ? lizardThumb(this.renderer) : "";
  }

  /** Dress a cat in another coat. Works before the lawn is built too (it is applied on build). */
  setCatSkin(slot: 1 | 2, skin: SkinId): void {
    this.skins[slot - 1] = skin;
    const c = this.cats[slot - 1];
    if (!c || c.model.skin === skin) return;
    const old = c.model;
    const made = this.makeCat(skin);
    made.model.root.position.copy(old.root.position);
    made.model.root.rotation.y = old.root.rotation.y;
    this.scene.remove(old.root);
    disposeClones(old.root);
    this.scene.add(made.model.root);
    c.model = made.model;
    c.aura = made.aura;
    c.setOpacity = made.setOpacity;
    c.setOpacity(c.present ? 1 : 0.35);
    c.aura.visible = this.mood === "auto";
    setCatFace(c.model, c.face);
    if (this.built) this.dust(c.model.root.position, 12);
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
    this.lookTarget.copy(h.pos);
    this.lookUntil = performance.now() + 1400;
    if (h.occ) this.drop(h);
    h.occ = this.makeOccupant(kind, variant, h);
    this.rustle(h.pos, kind === "snake" || kind === "porcupine" ? 0.8 : 0.45);
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
    const inner = buildPaw(cat.model.skin);
    casts(inner);
    paw.add(inner);
    this.scene.add(paw);
    const catPos = cat.model.root.position;
    const toCat = catPos.clone().sub(h.pos).setY(0).normalize();
    paw.quaternion.setFromUnitVectors(UP, toCat.clone().multiplyScalar(0.45).add(UP).normalize());
    // the paw leaves from the cat's own shoulder; the arm is hidden while it is out
    cat.model.arm.updateWorldMatrix(true, false);
    const from = cat.model.arm.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, -0.15, 0.1));
    cat.pawsOut += 1;
    cat.model.arm.visible = false;
    const above = h.pos.clone().add(toCat.clone().multiplyScalar(0.35)).add(new THREE.Vector3(0, 1.25, 0.15));
    const ctrl = from.clone().lerp(above, 0.5).add(new THREE.Vector3(0, 0.9, 0));
    const hit = h.pos.clone().add(new THREE.Vector3(0, 0.06, 0.06));
    paw.position.copy(from);
    paw.scale.setScalar(0.35);
    cat.swipeAt = performance.now();
    cat.pounce = Math.max(cat.pounce, 0.7);
    this.lookTarget.copy(h.pos);
    this.lookUntil = Math.max(this.lookUntil, performance.now() + 700);

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
            cat.pawsOut = Math.max(0, cat.pawsOut - 1);
            if (!cat.pawsOut) cat.model.arm.visible = true;
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
    const c = this.cats[slot - 1];
    if (!c) return;
    c.present = present;
    c.setOpacity(present ? 1 : 0.35);
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
    if (mood === "freeze" && this.mood !== "freeze") {
      for (const h of this.holes) if (h.occ) this.emit(h.pos.clone().add(new THREE.Vector3(0, 0.6, 0.1)), 8, 0xdff6ff, 0.9, starTexture(), true, 1.5, 0.14);
    }
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

  // ---- grass --------------------------------------------------------------------

  // grass sways on the world clock (so Freeze stills it too)
  private readonly grassTime = { value: 0 };
  private readonly grassHits = { value: [0, 1, 2, 3].map(() => new THREE.Vector4(0, 0, -99, 0)) };
  private nextHit = 0;

  /** Push the grass around a spot outwards (a paw landing, a critter popping out). */
  private rustle(at: THREE.Vector3, strength = 1): void {
    this.grassHits.value[this.nextHit]!.set(at.x, at.z, this.wtime, strength);
    this.nextHit = (this.nextHit + 1) % 4;
  }
  private grassMat: THREE.MeshLambertMaterial | null = null;

  private grassMaterial(): THREE.MeshLambertMaterial {
    if (this.grassMat) return this.grassMat;
    const m = new THREE.MeshLambertMaterial({ vertexColors: true });
    const time = this.grassTime;
    const hits = this.grassHits;
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = time;
      sh.uniforms.uHits = hits;
      sh.vertexShader = `uniform float uTime;
uniform vec4 uHits[4];
` + sh.vertexShader.replace(
        "#include <project_vertex>",
        `// grass moves in world space: a wind wave rolling across the lawn, a flutter, and blades
        // pushed away from wherever a paw lands or a critter pops out (uHits: x, z, time, strength)
        mat4 inst = mat4(1.0);
        #ifdef USE_INSTANCING
          inst = instanceMatrix;
        #endif
        vec4 wpos = modelMatrix * inst * vec4(transformed, 1.0);
        vec3 root = (modelMatrix * inst * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        float tip = clamp(position.y / 0.2, 0.0, 1.0);
        float bendK = tip * tip;
        float ph = root.x * 2.1 + root.z * 1.3;
        float gust = sin(uTime * 1.3 - root.x * 0.7) * 0.5 + 0.5;
        wpos.x += (sin(uTime * 2.2 + ph) * 0.35 + gust * 0.9) * bendK * 0.045;
        wpos.z += sin(uTime * 3.1 + ph * 1.7) * 0.01 * tip;
        for (int i = 0; i < 4; i++) {
          vec4 hit = uHits[i];
          float age = uTime - hit.z;
          if (age >= 0.0 && age < 1.6) {
            vec2 d = root.xz - hit.xy;
            float f = exp(-age * 3.2) * (1.0 - smoothstep(0.35, 1.4, length(d))) * hit.w;
            wpos.xz += normalize(d + vec2(0.0001)) * f * 0.17 * bendK;
            wpos.y -= f * 0.06 * bendK;
          }
        }
        vec4 mvPosition = viewMatrix * wpos;
        gl_Position = projectionMatrix * mvPosition;`
      );
    };
    this.grassMat = m;
    return m;
  }

  /**
   * Tufts of 3-5 blades at the given spots. `lean(x, z)` can tip blades towards a point (the
   * blades at a hole's lip hang over the opening).
   */
  private shadowMat: THREE.MeshBasicMaterial | null = null;

  /**
   * Soft contact shadows under grass and clovers, nudged and stretched away from the sun so they
   * read as the same light that shadows the cat and the holes.
   */
  private blobShadows(spots: { x: number; z: number; r: number }[]): THREE.InstancedMesh {
    this.shadowMat ??= new THREE.MeshBasicMaterial({ map: blobTexture(), color: 0x173016, transparent: true, opacity: 0.62, depthWrite: false });
    const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const mesh = new THREE.InstancedMesh(geo, this.shadowMat, spots.length);
    const yaw = Math.atan2(SHADOW_DIR.x, SHADOW_DIR.y);
    const q = new THREE.Quaternion().setFromAxisAngle(UP, yaw);
    spots.forEach((s, i) => {
      const pos = new THREE.Vector3(s.x + SHADOW_DIR.x * s.r * 0.45, 0.004, s.z + SHADOW_DIR.y * s.r * 0.45);
      mesh.setMatrixAt(i, new THREE.Matrix4().compose(pos, q, new THREE.Vector3(s.r * 1.6, 1, s.r * 2.3)));
    });
    mesh.renderOrder = 1;
    mesh.frustumCulled = false;
    return mesh;
  }

  private grassPatch(spots: { x: number; z: number; lean?: THREE.Vector2 }[], seed: number, size = 1, worldOffset?: THREE.Vector3): THREE.Group {
    const rnd = mulberry(seed);
    const blades: THREE.Matrix4[] = [];
    const colors: THREE.Color[] = [];
    const q = new THREE.Quaternion();
    const e = new THREE.Euler(0, 0, 0, "YXZ");
    const base = new THREE.Color();
    for (const s of spots) {
      // a touceira: 6-9 blades fanning out from one root, tinted like the lawn around it
      const wx = s.x + (worldOffset?.x ?? 0);
      const wz = s.z + (worldOffset?.z ?? 0);
      groundColor(Math.min(1, Math.hypot(wx, wz) / 15), base);
      base.multiplyScalar(0.86 + rnd() * 0.12);
      base.offsetHSL((rnd() - 0.5) * 0.03, 0, 0);
      const n = 5 + Math.floor(rnd() * 4);
      const turn = rnd() * Math.PI * 2;
      const tuft = (0.75 + rnd() * 0.45) * size;
      for (let k = 0; k < n; k++) {
        const yaw = turn + (k / n) * Math.PI * 2 + (rnd() - 0.5) * 0.5;
        let lean = 0.08 + rnd() * 0.28;
        let yawF = yaw;
        if (s.lean) {
          // tufts at a hole's lip all lean in over the opening
          yawF = Math.atan2(s.lean.x, s.lean.y) + (rnd() - 0.5) * 1.2;
          lean = 0.4 + rnd() * 0.25;
        }
        e.set(lean, yawF, 0);
        q.setFromEuler(e);
        const h = tuft * (0.85 + rnd() * 0.55);
        const w = 0.7 + rnd() * 0.3;
        blades.push(new THREE.Matrix4().compose(new THREE.Vector3(s.x + (rnd() - 0.5) * 0.03, 0, s.z + (rnd() - 0.5) * 0.03), q, new THREE.Vector3(w, h, w)));
        colors.push(base.clone().multiplyScalar(0.94 + rnd() * 0.12));
      }
    }
    const mesh = new THREE.InstancedMesh(bladeGeometry(), this.grassMaterial(), blades.length);
    blades.forEach((m, i) => {
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, colors[i]!);
    });
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    const group = new THREE.Group();
    group.add(this.blobShadows(spots.map((s) => ({ x: s.x, z: s.z, r: 0.16 * size }))), mesh);
    return group;
  }

  /** Clovers scattered here and there: mostly three leaves, now and then a lucky four. */
  private cloverPatch(spots: { x: number; z: number }[], seed: number): THREE.Group {
    const rnd = mulberry(seed);
    const group = new THREE.Group();
    const base = new THREE.Color();
    for (const leaves of [3, 4] as const) {
      const mine = spots.filter((_, i) => (i % 13 === 7 ? 4 : 3) === leaves);
      if (!mine.length) continue;
      const mesh = new THREE.InstancedMesh(cloverGeometry(leaves), this.grassMaterial(), mine.length);
      mine.forEach((s, i) => {
        const size = 1.25 + rnd() * 0.55;
        const q = new THREE.Quaternion().setFromEuler(new THREE.Euler((rnd() - 0.5) * 0.2, rnd() * Math.PI * 2, (rnd() - 0.5) * 0.2));
        mesh.setMatrixAt(i, new THREE.Matrix4().compose(new THREE.Vector3(s.x, 0, s.z), q, new THREE.Vector3(size, size, size)));
        // a deeper, slightly bluer green than the grass, so clovers stand out softly
        groundColor(Math.min(1, Math.hypot(s.x, s.z) / 15), base);
        base.offsetHSL(0.03, 0.05, -0.04);
        mesh.setColorAt(i, base.clone().multiplyScalar(0.92 + rnd() * 0.12));
      });
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      group.add(mesh);
    }
    group.add(this.blobShadows(spots.map((s) => ({ x: s.x, z: s.z, r: 0.17 }))));
    return group;
  }

  /** Grass around a hole's lip: some tufts hang over the edge. */
  private tufts(seed: number, count: number, rMin: number, rMax: number, at: THREE.Vector3): THREE.Group {
    const rnd = mulberry(seed);
    const spots = Array.from({ length: count }, (_, k) => {
      const a = (k / count) * Math.PI * 2 + (rnd() - 0.5) * 0.6;
      const lip = true;
      const d = lip ? rMin + rnd() * 0.06 : rMin + 0.15 + rnd() * (rMax - rMin - 0.15);
      return { x: Math.cos(a) * d, z: Math.sin(a) * d, lean: lip ? new THREE.Vector2(-Math.cos(a), -Math.sin(a)) : undefined };
    });
    return this.grassPatch(spots, seed + 1, 0.85, at);
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

    // crisp grass detail tiled every ~2.5 units, tinted per vertex from the warm middle to the dark rim
    const groundGeo = new THREE.RingGeometry(0.001, 15, 96, 30);
    const colors: number[] = [];
    const pos = groundGeo.getAttribute("position");
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      groundColor(Math.hypot(pos.getX(i), pos.getY(i)) / 15, c);
      colors.push(c.r, c.g, c.b);
    }
    groundGeo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    const grass = grassTexture();
    grass.repeat.set(4, 4);
    grass.anisotropy = Math.min(16, this.renderer.capabilities.getMaxAnisotropy());
    const ground = new THREE.Mesh(groundGeo, new THREE.MeshLambertMaterial({ map: grass, vertexColors: true }));
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
    warm.add(buildMouse(0), buildPorcupine(), buildSnake(), buildLizard(), buildPaw(this.skins[0]), buildCoin("auto"));
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
    // three lumpy rims, so no two neighbouring holes look stamped from the same mould
    const rimGeos = [0, 1, 2].map((v) => lumpyRim(R, v));
    const rimMat = toon(0x6e4a32);
    const clodMat = toon(0x5a3b27);
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
    // dug-up soil around the lip that fades into the grass, darker towards the opening
    const soilGeo = new THREE.RingGeometry(R * 0.92, R * 1.75, 64);
    soilGeo.rotateX(-Math.PI / 2);
    const soilMat = new THREE.MeshLambertMaterial({ map: soilTexture(), transparent: true, depthWrite: false });
    const glowGeo = new THREE.RingGeometry(0.52, 0.62, 40);
    glowGeo.rotateX(-Math.PI / 2);
    const moundGeo = new THREE.SphereGeometry(0.3, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2);
    moundGeo.scale(1, 0.45, 1);
    const clod = new THREE.IcosahedronGeometry(0.045, 1);
    const rnd = mulberry(31);

    for (let i = 0; i < HOLES; i++) {
      const pos = holePos(i);
      const group = new THREE.Group();
      group.position.copy(pos);
      const wall = new THREE.Mesh(wallGeo, wallMat);
      const floor = new THREE.Mesh(floorGeo, floorMat);
      wall.renderOrder = floor.renderOrder = -3;
      const mask = new THREE.Mesh(maskGeo, maskMat);
      mask.renderOrder = -1;
      const ao = new THREE.Mesh(soilGeo, soilMat);
      ao.position.y = 0.008;
      ao.rotation.y = rnd() * Math.PI * 2;
      ao.receiveShadow = true;
      ao.renderOrder = 1;
      const rim = new THREE.Mesh(rimGeos[i % 3]!, rimMat);
      rim.position.y = 0.012;
      rim.rotation.y = rnd() * Math.PI * 2;
      rim.castShadow = true;
      rim.receiveShadow = true;
      const glow = new THREE.Mesh(
        glowGeo,
        new THREE.MeshBasicMaterial({ color: 0xffd66b, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending })
      );
      glow.position.y = 0.02;
      glow.renderOrder = 2;
      // clods of earth kicked out of the hole
      for (let k = 0; k < 6; k++) {
        const c = new THREE.Mesh(clod, k % 2 ? clodMat : rimMat);
        const a = rnd() * Math.PI * 2;
        const d = R * (1.25 + rnd() * 0.55);
        c.position.set(Math.cos(a) * d, 0.01, Math.sin(a) * d);
        const s = 0.5 + rnd() * 0.9;
        c.scale.set(s, s * 0.55, s);
        c.rotation.set(rnd(), rnd() * 3, rnd());
        c.castShadow = true;
        c.receiveShadow = true;
        group.add(c);
      }
      group.add(wall, floor, mask, ao, rim, glow, this.tufts(i * 97 + 5, 5, R * 0.95, R * 1.15, pos));
      group.scale.setScalar(0);
      this.scene.add(group);
      const mound = new THREE.Mesh(moundGeo, rimMat);
      mound.position.copy(pos);
      mound.visible = false;
      mound.castShadow = true;
      this.scene.add(mound);
      this.holes.push({ group, glow, mound, pos, active: false, scale: 0, vscale: 0, telegraphUntil: 0, occ: null, ice: null });
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

  private makeCat(skin: SkinId): { model: CatModel; aura: THREE.Sprite; setOpacity: (o: number) => void } {
    const model = buildCat(skin);
    const setOpacity = fadeable(model.root);
    casts(model.root);
    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 1.6),
      new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false, opacity: 0.78 })
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
    const feet = [[-0.5, 0.42], [-0.28, 0.58], [0, 0.62], [0.24, 0.6], [0.46, 0.46], [-0.62, 0.15], [0.62, 0.2], [0.1, 0.5]];
    model.root.add(this.grassPatch(feet.map(([x, z]) => ({ x: x!, z: z! })), 900 + skin.length, 0.85));
    return { model, aura, setOpacity };
  }

  private buildCats(): void {
    for (let s = 1; s <= this.opts.cats; s++) {
      const slot = s as 1 | 2;
      const { model, aura, setOpacity } = this.makeCat(this.skins[slot - 1]);
      this.scene.add(model.root);
      const ring = document.createElement("div");
      ring.className = "lick-ring";
      ring.hidden = true;
      ring.innerHTML = `<span class="lick-ring__dial"></span>`;
      this.layer.append(ring);
      this.cats.push({
        slot, model, present: true, aura, setOpacity, yaw: 0, mood: "idle", moodTimer: 0, lickFrom: 0, lickUntil: 0, swipeAt: 0, pawsOut: 0, pounce: 0, spot: new THREE.Vector3(), ring, tag: null,
        face: "idle", hunt: 0, headYaw: 0, headPitch: -0.22, ...restingFace(performance.now())
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

    // tufts of grass all over the lawn (never where a hole is or will be dug)
    const spots: { x: number; z: number }[] = [];
    const holeSpots = Array.from({ length: HOLES }, (_, i) => holePos(i));
    const want = this.quality >= 2 ? 700 : 1400;
    for (let n = 0; n < 12000 && spots.length < want; n++) {
      const a = rnd() * Math.PI * 2;
      const r = Math.sqrt(rnd()) * 9.5;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r * 0.85;
      if (holeSpots.some((h) => Math.hypot(h.x - x, h.z - z) < 0.66)) continue;
      spots.push({ x, z });
    }
    this.scene.add(this.grassPatch(spots, 404));
    const cloverSpots: { x: number; z: number }[] = [];
    for (let n = 0; n < 3000 && cloverSpots.length < 120; n++) {
      const a = rnd() * Math.PI * 2;
      const r = 0.8 + Math.pow(rnd(), 0.8) * 8.5;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r * 0.85;
      if (holeSpots.some((h) => Math.hypot(h.x - x, h.z - z) < 0.75)) continue;
      // clovers grow in little families of 2-4
      const family = 2 + Math.floor(rnd() * 3);
      for (let k = 0; k < family; k++) cloverSpots.push({ x: x + (rnd() - 0.5) * 0.3, z: z + (rnd() - 0.5) * 0.3 });
    }
    this.scene.add(this.cloverPatch(cloverSpots, 505));

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
    } else if (kind === "lizard") {
      body = buildLizard();
      down = -0.95;
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
    this.rustle(h.pos, outcome === "whiff" ? 1.2 : 1);
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
    if (c.lickUntil <= performance.now()) this.showFace(c, mood as CatFace);
  }

  /**
   * Eyes: the gaze jumps in quick saccades (to a critter, or little darts around the camera when
   * idle) and the head catches up later; the lids ease into each mood's pose and blinks ride on
   * top: a snappy close and a slower open, sometimes a double, now and then a calm slow blink.
   */
  private animateEyes(c: CatView, now: number, dt: number, licking: boolean, lookYaw: number | null): void {
    let yaw: number;
    let pitch: number;
    if (licking) {
      yaw = 0.05;
      pitch = 0.2;
    } else if (lookYaw !== null) {
      // the eyes go most of the way there, wherever the head is right now
      yaw = THREE.MathUtils.clamp(lookYaw * 0.85 - c.headYaw, -0.5, 0.5);
      pitch = 0.12;
    } else {
      if (now >= c.nextSaccade) {
        const home = reduceMotion || Math.random() < 0.4;
        c.gazeYaw = home ? 0 : (Math.random() * 2 - 1) * (0.12 + c.hunt * 0.12);
        c.gazePitch = home ? 0 : Math.random() * 0.12 - 0.04;
        c.nextSaccade = now + (c.hunt > 0.5 ? 350 + Math.random() * 700 : 700 + Math.random() * 1900);
      }
      yaw = c.gazeYaw;
      pitch = c.gazePitch;
    }
    // saccades are fast
    const k = Math.min(1, dt * 28);
    c.eyeYaw += (yaw - c.eyeYaw) * k;
    c.eyePitch += (pitch - c.eyePitch) * k;
    // lids ease into the mood's pose; wider open while hunting
    const pose = faceLids(c.face);
    const target = c.face === "idle" ? pose.lid - c.hunt * 0.08 : pose.lid;
    // (the happy "^ ^" squint is drawn on at once, so its lids shut at once too)
    const kl = c.face === "catch" ? 1 : Math.min(1, dt * 12);
    c.lid += (target - c.lid) * kl;
    c.lidTilt += (pose.tilt - c.lidTilt) * kl;
    if (blinks(c.face) && now >= c.nextBlink) {
      c.blinkSlow = c.face === "idle" && c.hunt < 0.2 && !reduceMotion && Math.random() < 0.12;
      c.blinkAt = now;
      const double = !c.blinkSlow && Math.random() < 0.18;
      c.nextBlink = now + (double ? 250 : 2000 + Math.random() * 3800 + (c.blinkSlow ? 1000 : 0));
    }
  }

  private applyEyes(c: CatView, now: number): void {
    const m = c.model;
    const b = blinks(c.face) ? blinkAmount(now - c.blinkAt, c.blinkSlow) : 0;
    // the upper lid follows the eye down a little
    const lid = Math.min(1.34, c.lid + Math.max(0, c.eyePitch) * 0.5);
    setLids(m, lid + (1.32 - lid) * b, c.lidTilt * (1 - b));
    for (const ball of m.balls) ball.rotation.set(c.eyePitch, c.eyeYaw, 0);
  }

  /**
   * Ears ride damped springs, so every move overshoots a touch and settles: they flatten or droop
   * with the mood, prick forward while hunting, swivel towards a critter, trail behind head turns,
   * flop on a pounce and flick back now and then (sometimes twice).
   */
  private animateEars(c: CatView, now: number, dt: number, lookYaw: number | null): void {
    const pose = faceEars(c.face);
    const hunt = c.face === "idle" || c.face === "catch" ? c.hunt : 0;
    const swivel = lookYaw === null ? 0 : THREE.MathUtils.clamp((lookYaw - c.headYaw) * 0.6, -0.45, 0.45);
    const dYaw = c.headYaw - c.lastHeadYaw;
    const dPitch = c.headPitch - c.lastHeadPitch;
    c.lastHeadYaw = c.headYaw;
    c.lastHeadPitch = c.headPitch;
    const kick = c.pounce > c.lastPounce + 0.05;
    c.lastPounce = c.pounce;
    if (now >= c.nextTwitch && !reduceMotion) {
      c.twitchEar = Math.random() < 0.5 ? 0 : 1;
      flickEar(c, c.twitchEar);
      c.twitchAgain = Math.random() < 0.3 ? now + 170 : 0;
      c.nextTwitch = now + (1400 + Math.random() * 3400) * (1 - 0.4 * c.hunt);
    } else if (c.twitchAgain && now >= c.twitchAgain) {
      c.twitchAgain = 0;
      flickEar(c, c.twitchEar);
    }
    c.ears.forEach((e, i) => {
      const s = i === 0 ? 1 : -1;
      const drift = reduceMotion ? 0 : Math.sin(this.wtime * 0.7 + i * 2.1 + c.slot) * 0.06;
      const tx = pose.x + hunt * 0.22;
      const ty = -s * pose.y + swivel + drift;
      const tz = s * pose.z * (1 - 0.45 * hunt);
      // the head moves, the ears trail behind
      e.v.y -= dYaw * 10;
      e.v.x -= dPitch * 10;
      if (kick) {
        e.v.x += 5;
        e.v.z += s * 3;
      }
      // spring with a little overshoot (damping ratio ~0.4), stepped finely to stay stable
      let left = Math.min(dt, 0.1);
      while (left > 0) {
        const h = Math.min(left, 1 / 120);
        e.v.x += (EAR_K * (tx - e.p.x) - EAR_D * e.v.x) * h;
        e.v.y += (EAR_K * (ty - e.p.y) - EAR_D * e.v.y) * h;
        e.v.z += (EAR_K * (tz - e.p.z) - EAR_D * e.v.z) * h;
        e.p.addScaledVector(e.v, h);
        left -= h;
      }
    });
  }

  private showFace(c: CatView, face: CatFace): void {
    c.face = face;
    setCatFace(c.model, face);
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
    if (this.mood !== "freeze") this.wtime += dt;
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
    this.grassTime.value = this.wtime;
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
        const wob = Math.sin(this.wtime * 16) * 0.12;
        h.mound.scale.set(1 + wob, 1 + Math.abs(wob) * 2, 1 - wob);
      }
      const occ = h.occ;
      const glowMat = h.glow.material as THREE.MeshBasicMaterial;
      glowMat.opacity += ((occ?.kind === "fancy" ? 0.3 + Math.sin(this.wtime * 8) * 0.12 : 0) - glowMat.opacity) * Math.min(1, dt * 10);
      if (occ) this.updateOccupant(occ, h, now, this.mood === "freeze" ? 0 : dt);
      this.updateIce(h, dt);
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
      const t = this.wtime * f.sp + f.ph;
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
    const frozen = this.mood === "freeze";
    // hunting mode: prey on the lawn makes the cat crouch a little, ears up, tail tip twitching
    const prey = this.holes.some((h) => h.occ && (h.occ.kind === "mouse" || h.occ.kind === "fancy" || h.occ.kind === "lizard"));
    if (!frozen) c.hunt += ((prey ? 1 : 0) - c.hunt) * Math.min(1, dt * 4);
    const squash = Math.sin(c.pounce * Math.PI) * 0.07;
    const breathe = Math.sin(this.wtime * 1.9 + c.slot) * 0.012;
    const crouch = c.hunt * 0.035;
    m.body.scale.set(1 + squash + crouch * 0.4, 1 - squash + breathe - crouch, 1 + squash + crouch * 0.4);
    const licking = c.lickUntil > now;
    // the right arm: a quick swipe when slapping, up at the mouth when licking
    let armTarget = REST_Q;
    // direction of whatever the cat is looking at, relative to its body (null: nothing in particular)
    let lookYaw: number | null = null;
    if (licking) {
      if (c.face !== "lick") this.showFace(c, "lick");
      // paw up to the mouth, head tipped onto it, tongue lapping
      const bob = Math.sin(this.time * 14);
      armTarget = LICK_Q.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), bob * 0.08));
      m.head.rotation.set(0.24 + bob * 0.04, 0.1, -0.16);
      m.tongue.position.set(0.05, -0.215 + Math.max(0, bob) * 0.03, 0.45);
      m.tongue.scale.set(0.9, 1.1 + Math.max(0, bob) * 0.35, 0.6);
    } else {
      if (c.face !== c.mood) this.showFace(c, c.mood as CatFace);
      // look at the latest critter (or the hole being slapped), otherwise back at the camera
      let yaw = Math.sin(this.wtime * 0.6 + c.slot) * 0.08;
      let pitch = -0.22 + Math.sin(this.wtime * 0.9 + c.slot) * 0.03;
      const glance = now < this.lookUntil ? this.lookTarget : null;
      if (glance) {
        const d = glance.clone().sub(m.root.position);
        lookYaw = THREE.MathUtils.clamp(Math.atan2(d.x, d.z) - c.yaw, -0.9, 0.9);
        // the eyes do most of the looking; the head only follows a little, so the face stays to camera
        yaw = lookYaw * 0.4;
        pitch = -0.16;
      }
      if (!frozen) {
        // the head turns a beat behind the eyes
        const k = Math.min(1, dt * 6);
        c.headYaw += (yaw - c.headYaw) * k;
        c.headPitch += (pitch - c.headPitch) * k;
      }
      m.head.rotation.set(c.headPitch, c.headYaw, 0);
    }
    if (!frozen) {
      this.animateEyes(c, now, dt, licking, lookYaw);
      this.animateEars(c, now, dt, lookYaw);
    }
    this.applyEyes(c, now);
    m.ears.forEach((e, i) => setEar(e, c.ears[i]!.p.x, c.ears[i]!.p.y, c.ears[i]!.p.z));
    m.arm.quaternion.slerp(armTarget, Math.min(1, dt * 14));
    // the tail sways as a wave that runs down to the curled tip
    const tipFrom = m.tail.length - 4;
    m.tail.forEach((seg, i) => {
      const bend = seg.userData.bend as { x: number; y: number };
      const flick = c.mood === "angry" ? 2.2 : 1;
      // the tip twitches while the cat is hunting
      const nervous = i >= tipFrom ? Math.sin(this.wtime * 11 + i) * 0.12 * c.hunt : 0;
      seg.rotation.y = bend.y + Math.sin(this.wtime * 1.8 * flick - i * 0.45 + c.slot) * (0.05 + i * 0.006) * flick + nervous;
      seg.rotation.x = bend.x + Math.sin(this.wtime * 1.2 - i * 0.3) * 0.02;
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
    const t = this.wtime + occ.phase;
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
          const wave = this.wtime * 3.2 - i * 0.55;
          const amp = 0.04 + 0.07 * k;
          const lean = reach * k * k * 0.55;
          const p = new THREE.Vector3(Math.sin(wave) * amp + lx * lean, i * 0.075 - 0.45, Math.cos(wave * 0.8) * amp * 0.5 + lz * lean);
          segs[i]!.position.copy(p);
          prev = p;
        }
        const top = prev;
        const breath = Math.sin(this.wtime * 2.1) * 0.03;
        head.position.set(top.x, top.y + 0.13 + breath + reach * 0.1, top.z + 0.03);
        const look = occ.lunge ? Math.atan2(lx, lz) : Math.sin(this.wtime * 1.1) * 0.35;
        head.rotation.y += (look - head.rotation.y) * Math.min(1, dt * 10);
        head.rotation.z = Math.sin(this.wtime * 3.2 - n * 0.55) * 0.18;
        head.rotation.x = -reach * 0.3;
        // blink every few seconds
        const blink = (this.wtime + occ.phase) % 3.4 < 0.12 ? 0.1 : 1;
        for (const e of eyes) e.scale.y += (blink - e.scale.y) * Math.min(1, dt * 30);
        // tongue: quick eased flicks with a wiggle
        const f = ((this.wtime + occ.phase) % 1.3) / 1.3;
        const out = f < 0.28 ? Math.sin((f / 0.28) * Math.PI) : 0;
        tongue.scale.z = Math.max(0.01, out * (1 + reach));
        tongue.rotation.y = Math.sin(this.wtime * 40) * 0.25 * out;
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
        if (occ.kind === "lizard") {
          const tail = occ.body.getObjectByName("lizTail");
          if (tail) tail.rotation.y = Math.PI * 0.85 + Math.sin(t * 4) * 0.3;
          const tongue = occ.body.getObjectByName("tongue");
          const f = (t % 1.6) / 1.6;
          if (tongue) tongue.scale.z = Math.max(0.01, f < 0.18 ? Math.sin((f / 0.18) * Math.PI) : 0);
        }
        if (occ.kind === "fancy" && dt > 0 && now > occ.sparkAt && occ.target === occ.up) {
          occ.sparkAt = now + 150;
          const p = h.pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.6, 0.5 + Math.random() * 0.6, 0.2));
          this.emit(p, 1, Math.random() < 0.5 ? 0xffd66b : 0xffffff, 0.3, starTexture(), true, -0.4, 0.12);
        }
      }
    }
  }

  // Freeze: whatever stands in a hole gets wrapped in a block of ice until the power runs out.
  private updateIce(h: HoleView, dt: number): void {
    const want = this.mood === "freeze" && !!h.occ && h.active;
    if (want && !h.ice) {
      h.ice = new THREE.Mesh(iceGeometry(), iceMaterial());
      h.ice.position.y = 0.5;
      h.ice.scale.setScalar(0.01);
      h.ice.renderOrder = 4;
      h.group.add(h.ice);
    }
    if (!h.ice) return;
    const s = h.ice.scale.x + ((want ? 1 : 0) - h.ice.scale.x) * Math.min(1, dt * 14);
    if (!want && s < 0.05) {
      h.ice.removeFromParent();
      h.ice = null;
      return;
    }
    h.ice.scale.set(s, s, s);
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

let iceGeo: THREE.BufferGeometry | null = null;
let iceMat: THREE.MeshPhongMaterial | null = null;
function iceGeometry(): THREE.BufferGeometry {
  iceGeo ??= new THREE.CylinderGeometry(0.4, 0.44, 1.05, 7, 1);
  return iceGeo;
}
function iceMaterial(): THREE.MeshPhongMaterial {
  iceMat ??= new THREE.MeshPhongMaterial({
    color: 0xbfeaff, emissive: 0x3a7fae, emissiveIntensity: 0.25, specular: 0xffffff, shininess: 90,
    transparent: true, opacity: 0.42, depthWrite: false, flatShading: true
  });
  return iceMat;
}

let soil: THREE.Texture | null = null;
/**
 * Dug-up earth around a hole (mapped on a ring from 0.92 R to 2.15 R): dark and crumbly at the
 * lip, breaking up into blotches and crumbs that fade into the grass.
 */
function soilTexture(): THREE.Texture {
  if (soil) return soil;
  const S = 512;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const ctx = c.getContext("2d")!;
  const C = S / 2;
  const inner = C * (0.92 / 1.75);
  const rnd = mulberry(77);
  const base = ctx.createRadialGradient(C, C, inner - 4, C, C, C * 0.98);
  base.addColorStop(0, "rgba(84,56,37,.95)");
  base.addColorStop(0.3, "rgba(98,68,44,.7)");
  base.addColorStop(0.65, "rgba(108,78,50,.2)");
  base.addColorStop(1, "rgba(110,80,50,0)");
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, S, S);
  // a ragged edge: blotches of earth thinning out into the lawn
  for (let i = 0; i < 300; i++) {
    const a = rnd() * Math.PI * 2;
    const d = inner + Math.pow(rnd(), 1.6) * (C - inner - 12);
    const r = 4 + rnd() * 12;
    ctx.fillStyle = `rgba(${90 + rnd() * 20},${60 + rnd() * 16},${38 + rnd() * 10},${(0.5 * (1 - (d - inner) / (C - inner))).toFixed(3)})`;
    ctx.beginPath();
    ctx.ellipse(C + Math.cos(a) * d, C + Math.sin(a) * d, r, r * (0.5 + rnd() * 0.5), rnd() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  // crumbs and little stones
  for (let i = 0; i < 220; i++) {
    const a = rnd() * Math.PI * 2;
    const d = inner + Math.pow(rnd(), 1.4) * (C - inner - 20);
    ctx.fillStyle = rnd() < 0.6 ? "rgba(58,36,22,.75)" : "rgba(160,124,88,.6)";
    ctx.beginPath();
    ctx.arc(C + Math.cos(a) * d, C + Math.sin(a) * d, 0.8 + rnd() * 2.6, 0, Math.PI * 2);
    ctx.fill();
  }
  // shade right at the lip, where the ground drops away
  const ao = ctx.createRadialGradient(C, C, inner - 2, C, C, inner + 30);
  ao.addColorStop(0, "rgba(18,10,8,.6)");
  ao.addColorStop(1, "rgba(18,10,8,0)");
  ctx.fillStyle = ao;
  ctx.fillRect(0, 0, S, S);
  soil = new THREE.CanvasTexture(c);
  soil.colorSpace = THREE.SRGBColorSpace;
  soil.anisotropy = 8;
  return soil;
}

/** The raised lip of a hole: a torus with lumps and dips so it reads as packed earth. */
function lumpyRim(R: number, variant: number): THREE.BufferGeometry {
  const g = new THREE.TorusGeometry(R, 0.085, 12, 72);
  g.rotateX(Math.PI / 2);
  g.scale(1, 0.5, 1);
  const pos = g.getAttribute("position");
  const p = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    const a = Math.atan2(p.z, p.x);
    const n = Math.sin(a * 3 + variant * 2.1) * 0.5 + Math.sin(a * 7 + variant * 4.3) * 0.3 + Math.sin(a * 13 + variant) * 0.2;
    const r = Math.hypot(p.x, p.z);
    const k = 1 + (n * 0.05 * (r > R ? 1 : 0.35)) / r;
    pos.setXYZ(i, p.x * k, p.y * (1 + n * 0.45) + Math.max(0, n) * 0.012, p.z * k);
  }
  g.computeVertexNormals();
  return g;
}

// Where the scene's sun throws shadows on the ground (the sun sits at -4, 9, 6).
const SHADOW_DIR = new THREE.Vector2(4, -6).normalize();

const clovers = new Map<number, THREE.BufferGeometry>();
/**
 * A clover: three (or, rarely, four) heart-shaped leaves on short stalks, lifted a little off the
 * ground. Same conventions as the grass blades (vertex colours, upward normals, height ~0.2 for
 * the sway), so it shares their material, wind and paw rustle.
 */
function cloverGeometry(leaves: 3 | 4): THREE.BufferGeometry {
  const hit = clovers.get(leaves);
  if (hit) return hit;
  const heart = new THREE.Shape();
  // a leaf pointing along +y from its stalk, notched at the far end like a clover's
  heart.moveTo(0, 0);
  heart.bezierCurveTo(-0.03, 0.012, -0.05, 0.045, -0.034, 0.064);
  heart.bezierCurveTo(-0.022, 0.078, -0.006, 0.072, 0, 0.06);
  heart.bezierCurveTo(0.006, 0.072, 0.022, 0.078, 0.034, 0.064);
  heart.bezierCurveTo(0.05, 0.045, 0.03, 0.012, 0, 0);
  const parts: THREE.BufferGeometry[] = [];
  for (let k = 0; k < leaves; k++) {
    const leaf = new THREE.ShapeGeometry(heart, 6);
    leaf.rotateX(-Math.PI / 2 + 0.35); // lie almost flat, tipped up a little
    leaf.rotateY((k / leaves) * Math.PI * 2);
    leaf.translate(0, 0.075, 0);
    parts.push(leaf);
  }
  const stalk = new THREE.CylinderGeometry(0.004, 0.006, 0.075, 4, 1, true);
  stalk.translate(0, 0.0375, 0);
  parts.push(stalk);
  for (const g of parts) {
    g.deleteAttribute("uv");
    const pos = g.getAttribute("position");
    const col: number[] = [];
    const nor: number[] = [];
    for (let i = 0; i < pos.count; i++) {
      // stalk and leaf roots darker, leaf edges light
      const r = Math.hypot(pos.getX(i), pos.getZ(i));
      const k = pos.getY(i) < 0.07 ? 0.7 : 0.82 + Math.min(1, r / 0.07) * 0.32;
      col.push(k, k, k);
      nor.push(0, 1, 0);
    }
    g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  }
  const merged = mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)));
  // both windings, like the blades
  const pos = merged.getAttribute("position");
  const idx: number[] = [];
  for (let i = 0; i < pos.count; i += 3) idx.push(i, i + 1, i + 2, i + 2, i + 1, i);
  merged.setIndex(idx);
  clovers.set(leaves, merged);
  return merged;
}

let blob: THREE.Texture | null = null;
/** Soft contact shadow, darkest in the middle. */
function blobTexture(): THREE.Texture {
  if (blob) return blob;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.5, "rgba(255,255,255,.55)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  blob = new THREE.CanvasTexture(c);
  return blob;
}

// The licking pose: the right arm turned from hanging down to pointing from the shoulder
// (0.17, 0.62, 0.32) to just under the mouth (0.03, 1.12, 0.5), all in body space.
const REST_Q = new THREE.Quaternion();
const LICK_Q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), new THREE.Vector3(-0.14, 0.5, 0.18).normalize());

let blade: THREE.BufferGeometry | null = null;
/**
 * One cartoon grass blade: a flat, curved leaf (root, waist, shoulder, tip), dark at the root
 * and light at the tip, lit like the ground under it. Tufts of them are drawn instanced.
 */
function bladeGeometry(): THREE.BufferGeometry {
  if (blade) return blade;
  const w = 0.042;
  const h = 0.2;
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute([
    -w, 0, 0, w, 0, 0,
    -w * 0.85, h * 0.42, 0.02, w * 0.85, h * 0.42, 0.02,
    -w * 0.5, h * 0.76, 0.05, w * 0.5, h * 0.76, 0.05,
    0, h, 0.085
  ], 3));
  // both windings, so the blade shows from either side with the same upward normal
  const front = [0, 1, 3, 0, 3, 2, 2, 3, 5, 2, 5, 4, 4, 5, 6];
  const back: number[] = [];
  for (let i = 0; i < front.length; i += 3) back.push(front[i + 2]!, front[i + 1]!, front[i]!);
  g.setIndex([...front, ...back]);
  const shade = [0.74, 0.74, 0.9, 0.9, 1.04, 1.04, 1.16];
  g.setAttribute("color", new THREE.Float32BufferAttribute(shade.flatMap((k) => [k, k, k]), 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(Array.from({ length: 7 }, () => [0, 1, 0]).flat(), 3));
  blade = g;
  return g;
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
