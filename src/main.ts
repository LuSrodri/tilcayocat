import "./style.css";
import { Game, CATCH_WINDOW_MS, COMBO_WINDOW_MS, POWER_LABEL, type RoundStats } from "./game";
import { sfx, music, volume } from "./sound";
import { SealTracker, mountSeals } from "./seals";
import { mountOnline } from "./presence";
import {
  rankFor,
  nextRank,
  rankProgress,
  currentStreak,
  touchStreak,
  challengeTarget,
  challengeUrl,
  heatStrip,
  formatTime,
  type Rank
} from "./rank";
import { drawCard, canvasToBlob, preloadCard } from "./sharecard";

function $<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el as T;
}

const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

const catEl = $("cat");
const scoreEl = $("score");
const bestEl = $("best");
const timerBar = $("timerBar");
const timerFill = $("timerFill");
const timerText = $("timerText");
const overlay = $("overlay");
const overlayTitle = $("overlayTitle");
const overlayText = $("overlayText");
const kicker = $("kicker");
const playBtn = $<HTMLButtonElement>("playBtn");
const shareBtn = $<HTMLButtonElement>("shareBtn");
const field = $("field");
const fx = $("fx");
const powerBadge = $("powerBadge");
const powerName = $("powerName");
const powerTime = $("powerTime");
const powerRing = $("powerRing");
const stageEl = $("stage");
const comboEl = $("combo");
const comboNum = $("comboNum");
const comboFill = $("comboFill");

const beat = challengeTarget();
let lastStats: RoundStats | null = null;
let lastIsNewBest = false;
let roundRank: Rank = rankFor(0);
let roundBestBefore = 0;
let passedBest = false;
let passedBeat = false;
let toastTimer = 0;
let comboTimer = 0;

// ---- seals ------------------------------------------------------------------

const seals = new SealTracker();
mountSeals($("sealsList"), $("sealsCount"), toast);

// how many cats have the game open right now
mountOnline("solo");

const COMBO_CALLS: Record<number, string> = {
  5: "Nice combo!",
  10: "Purrfect!",
  15: "Unstoppable!",
  20: "Feline frenzy!",
  30: "LEGENDARY!"
};

const game = new Game($("holes"), catEl, {
  onScore(score, best) {
    scoreEl.textContent = String(score);
    bestEl.textContent = String(best);
    scoreEl.classList.remove("is-bump");
    void scoreEl.offsetWidth;
    scoreEl.classList.add("is-bump");
    if (!score) return;

    // Milestones inside the round: each one is a small, unexpected reward.
    const rank = rankFor(score);
    if (rank.id !== roundRank.id) {
      roundRank = rank;
      toast(`${rank.emoji} ${rank.name}!`, "rank");
      sfx.rankUp();
      flash(rank.tint[0]);
    } else if (!passedBest && roundBestBefore > 0 && score === roundBestBefore + 1) {
      passedBest = true;
      toast("New best!", "seal");
      sfx.rankUp();
    }
    if (beat && !passedBeat && score === beat + 1) {
      passedBeat = true;
      toast("Friend beaten!", "grid");
      sfx.combo(4);
    }
  },
  onCombo(combo, hole) {
    renderCombo(combo);
    if (hole) sparkle(hole, combo);
    const call = COMBO_CALLS[combo] ?? (combo > 30 && combo % 10 === 0 ? `×${combo} LEGENDARY!` : "");
    if (call) {
      toast(call, "combo");
      sfx.combo(Math.floor(combo / 5));
      flash("#ffd84a");
    }
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
  onEvent(ev) {
    seals.feed(ev);
  },
  onGameOver(score, best, isNewBest, stats) {
    music.stop();
    lastStats = stats;
    lastIsNewBest = isNewBest;
    field.classList.add("is-shake");
    setTimeout(() => field.classList.remove("is-shake"), 320);
    showResults(score, best, isNewBest, stats);
  }
});

// ---- in-round juice -----------------------------------------------------------

function renderCombo(combo: number): void {
  window.clearTimeout(comboTimer);
  if (combo < 2) {
    comboEl.classList.remove("is-on");
    field.dataset.frenzy = "";
    return;
  }
  comboNum.textContent = String(combo);
  comboEl.dataset.level = String(combo >= 20 ? 3 : combo >= 10 ? 2 : combo >= 5 ? 1 : 0);
  comboEl.classList.add("is-on");
  comboEl.classList.remove("is-bump");
  void comboEl.offsetWidth;
  comboEl.classList.add("is-bump");
  // the bar drains over the combo window: catch again before it empties
  comboFill.style.animation = "none";
  void comboFill.offsetWidth;
  comboFill.style.animation = `comboDrain ${COMBO_WINDOW_MS}ms linear forwards`;
  field.dataset.frenzy = combo >= 10 ? "1" : "";
  comboTimer = window.setTimeout(() => renderCombo(0), COMBO_WINDOW_MS);
}

// A little shower of stars from the hole that was just caught; bigger combos throw more.
function sparkle(hole: HTMLElement, combo: number): void {
  if (reduceMotion) return;
  const f = field.getBoundingClientRect();
  const h = hole.getBoundingClientRect();
  const cx = h.left - f.left + h.width / 2;
  const cy = h.top - f.top + h.height * 0.45;
  const count = Math.min(5 + combo, 16);
  const colors = combo >= 10 ? ["#ffd84a", "#ff5fb8", "#3ef2d0", "#fff"] : ["#ffd84a", "#fff3c4", "#ff9f2e"];
  for (let i = 0; i < count; i++) {
    const p = document.createElement("span");
    p.className = i % 3 ? "spark" : "spark spark--star";
    const angle = (Math.PI * 2 * i) / count + Math.random() * 0.6;
    const dist = 40 + Math.random() * (50 + combo * 3);
    p.style.cssText =
      `left:${cx}px;top:${cy}px;--dx:${Math.cos(angle) * dist}px;--dy:${Math.sin(angle) * dist - 30}px;` +
      `--c:${colors[i % colors.length]};--s:${0.6 + Math.random() * 0.8}`;
    fx.append(p);
    setTimeout(() => p.remove(), 750);
  }
}

function flash(color: string): void {
  if (reduceMotion) return;
  field.style.setProperty("--flash", color);
  field.classList.remove("is-flash");
  void field.offsetWidth;
  field.classList.add("is-flash");
}

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

// ---- start / results screen ---------------------------------------------------

const resultEl = $("result");
const challengeEl = $("challenge");

function renderStreak(): void {
  const days = currentStreak();
  $("streak").hidden = days < 2;
  $("streakText").textContent = `${days}-day streak`;
}

function renderChallenge(score: number | null): void {
  if (!beat) return;
  challengeEl.hidden = false;
  if (score === null) {
    challengeEl.innerHTML = `A friend caught <b>${beat}</b> mice and dares you to beat it.`;
  } else if (score > beat) {
    challengeEl.innerHTML = `You beat your friend's <b>${beat}</b>! Send it back to them.`;
    challengeEl.dataset.state = "won";
  } else {
    challengeEl.innerHTML = `Your friend's <b>${beat}</b> still stands — ${beat - score + 1} more to win.`;
    challengeEl.dataset.state = "lost";
  }
}

function renderRank(score: number, label: string): void {
  const rank = rankFor(score);
  const next = nextRank(score);
  const badge = $("rankBadge");
  badge.style.setProperty("--r1", rank.tint[0]);
  badge.style.setProperty("--r2", rank.tint[1]);
  $("rankEmoji").textContent = rank.emoji;
  $("rankName").textContent = rank.name;
  $("rankLabel").textContent = label;
  const pct = Math.round(rankProgress(score) * 100);
  const fill = $("progressFill");
  fill.style.width = "0%";
  requestAnimationFrame(() => requestAnimationFrame(() => (fill.style.width = `${pct}%`)));
  fill.parentElement!.setAttribute("aria-valuenow", String(pct));
  $("progressText").innerHTML = next
    ? `<b>${next.min - score}</b> more ${next.min - score === 1 ? "mouse" : "mice"} to ${next.emoji} ${next.name}`
    : "Top rank. The Yungas bow to you.";
}

function countUp(el: HTMLElement, to: number): void {
  if (reduceMotion || to <= 0) {
    el.textContent = String(to);
    return;
  }
  const dur = Math.min(1200, 300 + to * 25);
  const t0 = performance.now();
  let shown = -1;
  const step = (now: number): void => {
    const t = Math.min(1, (now - t0) / dur);
    const v = Math.round(to * (1 - Math.pow(1 - t, 3)));
    if (v !== shown) {
      shown = v;
      el.textContent = String(v);
      sfx.tick();
    }
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function renderStart(): void {
  const best = game.bestScore;
  renderStreak();
  renderChallenge(null);
  if (best > 0) {
    resultEl.hidden = false;
    resultEl.classList.add("result--compact");
    $("resultNum").textContent = String(best);
    $("resultUnit").textContent = "best";
    $("resultChips").replaceChildren();
    $("heat").textContent = "";
    renderRank(best, "Your rank");
  }
  if (beat) {
    overlayTitle.textContent = `Beat ${beat} mice`;
    kicker.textContent = "You've been challenged";
    playBtn.textContent = "Accept challenge";
  }
}

function showResults(score: number, best: number, isNewBest: boolean, stats: RoundStats): void {
  const wonChallenge = beat !== null && score > beat;
  const gap = best - score;
  kicker.textContent = isNewBest ? "Personal best" : "Round over";
  overlayTitle.textContent = isNewBest
    ? "New record!"
    : wonChallenge
      ? "Challenge won!"
      : score > 0 && gap <= 3
        ? "So close!"
        : score === 0
          ? "Too slow!"
          : "Nice hunt!";
  overlayText.innerHTML = isNewBest
    ? "The tilcayo is impressed. Flex it before someone beats you."
    : score > 0 && gap <= 3
      ? `Just <b>${gap + 1}</b> short of your best. One more round?`
      : score === 0
        ? "The clock ran out before the first catch. The tilcayo is giving you <em>that</em> look."
        : `Your best is <b>${best}</b>. The mice are laughing. One more round?`;

  overlay.dataset.mode = "result";
  resultEl.hidden = false;
  resultEl.classList.remove("result--compact");
  $("resultUnit").textContent = score === 1 ? "mouse" : "mice";
  countUp($("resultNum"), score);
  renderRank(score, "Rank");
  const chips = [
    `⏱ ${formatTime(stats.elapsedMs)}`,
    `🔥 ×${stats.bestCombo} combo`,
    `🌿 ${stats.grid}×${stats.grid}`
  ];
  $("resultChips").replaceChildren(
    ...chips.map((c) => {
      const li = document.createElement("li");
      li.textContent = c;
      return li;
    })
  );
  $("heat").textContent = heatStrip(stats.slices);
  renderChallenge(score);
  renderStreak();

  playBtn.textContent = "Play again";
  shareBtn.hidden = score <= 0;
  showOverlay();
  if (isNewBest || wonChallenge) {
    confetti();
    setTimeout(() => sfx.record(), 350);
  }
}

function confetti(): void {
  if (reduceMotion) return;
  const box = $("confetti");
  box.replaceChildren();
  const colors = ["#ffd84a", "#ff9f2e", "#ff5fb8", "#3ef2d0", "#8fe9ff", "#fff"];
  for (let i = 0; i < 70; i++) {
    const p = document.createElement("i");
    p.style.cssText =
      `left:${Math.random() * 100}%;--c:${colors[i % colors.length]};--d:${1.4 + Math.random() * 1.4}s;` +
      `--delay:${Math.random() * 0.4}s;--x:${(Math.random() - 0.5) * 160}px;--r:${Math.random() * 720 - 360}deg`;
    box.append(p);
  }
  setTimeout(() => box.replaceChildren(), 3200);
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

function play(): void {
  sfx.unlock();
  hideOverlay();
  closeSheet();
  roundRank = rankFor(0);
  roundBestBefore = game.bestScore;
  passedBest = false;
  passedBeat = false;
  const streak = touchStreak();
  music.start();
  game.start();
  preloadCard();
  if (streak.grew) setTimeout(() => toast(`🔥 ${streak.days}-day streak!`, "seal"), 400);
}

playBtn.addEventListener("click", play);

document.addEventListener("keydown", (ev) => {
  if (ev.code !== "Space" || overlay.hidden || !sheet.hidden) return;
  if (document.activeElement instanceof HTMLButtonElement && document.activeElement !== playBtn) return;
  ev.preventDefault();
  play();
});

// ---- share sheet ------------------------------------------------------------

const sheet = $("shareSheet");
const sheetImg = $<HTMLImageElement>("sheetImg");
const shareImgBtn = $<HTMLButtonElement>("shareImgBtn");
const saveImgBtn = $<HTMLAnchorElement>("saveImgBtn");
const postXBtn = $<HTMLAnchorElement>("postXBtn");
const copyBtn = $<HTMLButtonElement>("copyBtn");
let cardFile: File | null = null;

function shareText(stats: RoundStats): string {
  const rank = rankFor(stats.score);
  return (
    `🐆 Tilcayo Cat — I caught ${stats.score} ${stats.score === 1 ? "mouse" : "mice"} 🐭\n` +
    `${rank.emoji} ${rank.name} · ⏱ ${formatTime(stats.elapsedMs)} · 🔥 ×${stats.bestCombo}\n` +
    `${heatStrip(stats.slices)}\n` +
    `Can you beat me?`
  );
}

async function openSheet(): Promise<void> {
  if (!lastStats) return;
  const stats = lastStats;
  const text = shareText(stats);
  const url = challengeUrl(stats.score);
  sheet.hidden = false;
  sheetImg.hidden = true;
  $("sheetSpinner").hidden = false;
  $("shareText").textContent = `${text}\n${url}`;
  postXBtn.href = `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
  cardFile = null;

  const canvas = await drawCard({ ...stats, best: game.bestScore, isNewBest: lastIsNewBest, beat });
  const blob = await canvasToBlob(canvas);
  cardFile = new File([blob], `tilcayo-cat-${stats.score}.png`, { type: "image/png" });
  const dataUrl = canvas.toDataURL("image/png");
  sheetImg.src = dataUrl;
  saveImgBtn.href = dataUrl;
  saveImgBtn.download = cardFile.name;
  sheetImg.hidden = false;
  $("sheetSpinner").hidden = true;
  const canShareFile = "canShare" in navigator && navigator.canShare({ files: [cardFile] });
  shareImgBtn.hidden = !canShareFile;
  shareImgBtn.focus({ preventScroll: true });
}

function closeSheet(): void {
  sheet.hidden = true;
}

shareBtn.addEventListener("click", () => {
  sfx.unlock();
  void openSheet();
});
$("sheetClose").addEventListener("click", () => {
  closeSheet();
  playBtn.focus({ preventScroll: true });
});
sheet.addEventListener("click", (ev) => {
  if (ev.target === sheet) closeSheet();
});
document.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape" && !sheet.hidden) closeSheet();
});

shareImgBtn.addEventListener("click", async () => {
  if (!cardFile || !lastStats) return;
  try {
    await navigator.share({
      files: [cardFile],
      title: "Tilcayo Cat Game",
      text: `${shareText(lastStats)} ${challengeUrl(lastStats.score)}`
    });
  } catch {
    /* user cancelled */
  }
});

copyBtn.addEventListener("click", async () => {
  if (!lastStats) return;
  try {
    await navigator.clipboard.writeText(`${shareText(lastStats)}\n${challengeUrl(lastStats.score)}`);
    copyBtn.textContent = "Copied!";
  } catch {
    copyBtn.textContent = "Copy failed";
  }
  setTimeout(() => (copyBtn.textContent = "Copy challenge"), 1500);
});

// ---- sound, visibility, touch -------------------------------------------------

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

// Block iOS double-tap zoom / long-press callouts on the play area.
field.addEventListener("contextmenu", (ev) => ev.preventDefault());
field.addEventListener("touchstart", () => sfx.unlock(), { passive: true, once: true });

renderStart();
