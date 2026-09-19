import "./style.css";
import { Game, CATCH_WINDOW_MS, POWER_LABEL } from "./game";
import { sfx, music, volume } from "./sound";

function $<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el as T;
}

const catEl = $("cat");

const scoreEl = $("score");
const bestEl = $("best");
const timerBar = $("timerBar");
const timerFill = $("timerFill");
const timerText = $("timerText");
const overlay = $("overlay");
const overlayTitle = $("overlayTitle");
const overlayText = $("overlayText");
const overlayStats = $("overlayStats");
const playBtn = $<HTMLButtonElement>("playBtn");
const shareBtn = $<HTMLButtonElement>("shareBtn");
const field = $("field");
const powerBadge = $("powerBadge");
const powerName = $("powerName");
const powerTime = $("powerTime");
const powerRing = $("powerRing");
const stageEl = $("stage");

let lastScore = 0;
let toastTimer = 0;

const game = new Game($("holes"), catEl, {
  onScore(score, best) {
    scoreEl.textContent = String(score);
    bestEl.textContent = String(best);
    scoreEl.classList.remove("is-bump");
    void scoreEl.offsetWidth;
    scoreEl.classList.add("is-bump");
  },
  onTimer(remaining) {
    const ratio = remaining / CATCH_WINDOW_MS;
    timerFill.style.transform = `scaleX(${ratio})`;
    timerText.textContent = `${(remaining / 1000).toFixed(1)}s`;
    const zone = ratio > 0.5 ? "ok" : ratio > 0.25 ? "warn" : "danger";
    timerBar.dataset.zone = zone;
    field.dataset.zone = zone;
  },
  onPower(kind, remaining, total) {
    field.dataset.power = kind ?? "";
    if (kind === "fulltime") {
      // instant effect: flash the clock and show a short toast
      timerBar.classList.remove("is-refill");
      void timerBar.offsetWidth;
      timerBar.classList.add("is-refill");
      toast("Full time!", "fulltime");
      return;
    }
    if (!kind) {
      powerBadge.hidden = true;
      powerBadge.dataset.kind = "";
      return;
    }
    if (powerBadge.hidden || powerBadge.dataset.kind !== kind) {
      powerBadge.hidden = false;
      powerBadge.dataset.kind = kind;
      powerName.textContent = POWER_LABEL[kind];
      toast(POWER_LABEL[kind] + "!", kind);
    }
    powerTime.textContent = `${Math.ceil(remaining / 1000)}s`;
    powerRing.style.setProperty("--p", String(total ? remaining / total : 0));
  },
  onStage(grid, speed, note) {
    field.dataset.grid = String(grid);
    stageEl.textContent = `${grid}×${grid} · ×${speed.toFixed(2)}`;
    if (note) toast(note, note.startsWith("Speed") ? "speed" : "grid");
  },
  onGameOver(score, best, isNewBest) {
    music.stop();
    lastScore = score;
    field.classList.add("is-shake");
    setTimeout(() => field.classList.remove("is-shake"), 320);
    overlayTitle.textContent = isNewBest ? "New record!" : "Too slow!";
    overlayText.innerHTML = isNewBest
      ? "The tilcayo is impressed. Can you beat yourself again?"
      : "The clock ran out before the next catch. The tilcayo is giving you <em>that</em> look.";
    overlayStats.hidden = false;
    overlayStats.textContent = `${score} ${score === 1 ? "mouse" : "mice"} caught · best ${best}`;
    playBtn.textContent = "Play again";
    shareBtn.hidden = !("share" in navigator || "clipboard" in navigator);
    showOverlay();
  }
});

function toast(text: string, kind: string): void {
  const el = $("toast");
  el.textContent = text;
  el.dataset.kind = kind;
  el.classList.remove("is-on");
  void el.offsetWidth;
  el.classList.add("is-on");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove("is-on"), 1400);
}

function showOverlay(): void {
  overlay.hidden = false;
  overlay.classList.remove("is-leaving");
  playBtn.focus({ preventScroll: true });
}

function hideOverlay(): void {
  overlay.classList.add("is-leaving");
  setTimeout(() => {
    overlay.hidden = true;
  }, 250);
}

playBtn.addEventListener("click", () => {
  sfx.unlock();
  hideOverlay();
  music.start();
  game.start();
});

// Sound toggle
const soundBtn = $<HTMLButtonElement>("soundBtn");
const renderSound = (): void => {
  soundBtn.setAttribute("aria-pressed", String(volume.muted));
  soundBtn.setAttribute("aria-label", volume.muted ? "Unmute sound" : "Mute sound");
};
renderSound();
soundBtn.addEventListener("click", () => {
  sfx.unlock();
  volume.toggle();
  renderSound();
});

// Pause the tune when the tab is hidden; the round itself ends on return (timer keeps counting).
document.addEventListener("visibilitychange", () => {
  if (document.hidden) music.stop();
  else if (overlay.hidden) music.start();
});

shareBtn.addEventListener("click", async () => {
  const text = `I caught ${lastScore} mice as the tilcayo cat 🐱🐭 Can you beat me?`;
  const url = "https://tilcayo.cat/";
  try {
    if (navigator.share) {
      await navigator.share({ title: "Tilcayo Cat Game", text, url });
    } else {
      await navigator.clipboard.writeText(`${text} ${url}`);
      shareBtn.textContent = "Copied!";
      setTimeout(() => (shareBtn.textContent = "Share score"), 1500);
    }
  } catch {
    /* user cancelled */
  }
});

// Block iOS double-tap zoom / long-press callouts on the play area.
field.addEventListener("contextmenu", (ev) => ev.preventDefault());
field.addEventListener("touchstart", () => sfx.unlock(), { passive: true, once: true });
