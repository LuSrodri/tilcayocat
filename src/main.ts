import "./style.css";
import catSvg from "./art/cat.svg?raw";
import mouseSvg from "./art/mouse.svg?raw";
import { Game, CATCH_WINDOW_MS } from "./game";
import { sfx } from "./sound";

function $<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el as T;
}

const catEl = $("cat");
catEl.innerHTML = catSvg;

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
const about = $<HTMLDialogElement>("aboutDialog");

let lastScore = 0;

const game = new Game($("holes"), catEl, mouseSvg, {
  onScore(score, best) {
    scoreEl.textContent = String(score);
    bestEl.textContent = String(best);
  },
  onTimer(remaining) {
    const ratio = remaining / CATCH_WINDOW_MS;
    timerFill.style.transform = `scaleX(${ratio})`;
    timerText.textContent = `${(remaining / 1000).toFixed(1)}s`;
    timerBar.dataset.zone = ratio > 0.5 ? "ok" : ratio > 0.25 ? "warn" : "danger";
  },
  onGameOver(score, best, isNewBest) {
    lastScore = score;
    field.classList.add("is-shake");
    setTimeout(() => field.classList.remove("is-shake"), 320);
    overlayTitle.textContent = isNewBest ? "New record!" : "Too slow!";
    overlayText.innerHTML = isNewBest
      ? "The tilcayo is impressed. Can you beat yourself again?"
      : "Five seconds went by with no mouse. The tilcayo is giving you <em>that</em> look.";
    overlayStats.hidden = false;
    overlayStats.textContent = `${score} ${score === 1 ? "mouse" : "mice"} caught · best ${best}`;
    playBtn.textContent = "Play again";
    shareBtn.hidden = !("share" in navigator || "clipboard" in navigator);
    showOverlay();
  }
});

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
  game.start();
});

shareBtn.addEventListener("click", async () => {
  const text = `I caught ${lastScore} mice as the tilcayo cat 🐱🐭 Can you beat me?`;
  const url = "https://tilcayo.cat/";
  try {
    if (navigator.share) {
      await navigator.share({ title: "Tilcayo Cat", text, url });
    } else {
      await navigator.clipboard.writeText(`${text} ${url}`);
      shareBtn.textContent = "Copied!";
      setTimeout(() => (shareBtn.textContent = "Share score"), 1500);
    }
  } catch {
    /* user cancelled */
  }
});

// About dialog
const openAbout = (): void => {
  about.showModal();
  $("closeAbout").focus({ preventScroll: true });
};
$("infoBtn").addEventListener("click", openAbout);
$("overlayInfo").addEventListener("click", openAbout);
$("closeAbout").addEventListener("click", () => about.close());
about.addEventListener("click", (ev) => {
  if (ev.target === about) about.close();
});

// Block iOS double-tap zoom / long-press callouts on the play area.
field.addEventListener("contextmenu", (ev) => ev.preventDefault());
field.addEventListener("touchstart", () => sfx.unlock(), { passive: true, once: true });

// Keyboard support: 1–9 taps the matching hole (numpad layout, top-left is 7).
const keyMap: Record<string, number> = { "7": 0, "8": 1, "9": 2, "4": 3, "5": 4, "6": 5, "1": 6, "2": 7, "3": 8 };
document.addEventListener("keydown", (ev) => {
  if (about.open || !overlay.hidden) return;
  const idx = keyMap[ev.key];
  if (idx === undefined) return;
  const hole = $("holes").children[idx];
  hole?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
});
