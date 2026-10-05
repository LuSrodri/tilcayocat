import "./style.css";
import { Game, CATCH_WINDOW_MS, COMBO_WINDOW_MS, POWER_LABEL, DAILY_GOAL, HOLE_TIMES, FULL_LAWN_MS, GUARD_MS, type RoundStats } from "./game";
import { Lawn, webgl2Available } from "./engine/lawn";
import { sfx, music, volume } from "./sound";
import { SealTracker, mountSeals, collectFancy, checkStreakSeals } from "./seals";
import { rankFor, touchStreak, currentStreak, challengeTarget, type Rank } from "./rank";
import {
  SKINS, LIZARD_PRICE, LIZARD_VALUE, wallet, earnPoints, ownsSkin, currentSkin, equipSkin, buySkin, hasLizard, buyLizard, skinById, onInventory, starterUsed, type SkinId
} from "./shop";
import type { PackId } from "../worker/src/protocol";
import { dailyNumber, dailyVariant, dailyState, addDailyCatch, recordRound, dailyShareText } from "./daily";
import { nextFact } from "./facts";
import { fancyKind, albumHas, albumSize, FANCY_COUNT } from "./fancy";
import { guard, isGuarded } from "./guard";
import { track } from "./analytics";

function $<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el as T;
}

const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

const scoreEl = $("score");
const timerBar = $("timerBar");
const timerFill = $("timerFill");
const overlay = $("overlay");
const overlayCard = $("overlayCard");
const overlayTitle = $("overlayTitle");
const kicker = $("kicker");
const playBtn = $<HTMLButtonElement>("playBtn");
const shareBtn = $<HTMLButtonElement>("shareBtn");
const field = $("field");
const topbar = document.querySelector<HTMLElement>(".topbar")!;
const powerBadge = $("powerBadge");
const powerTime = $("powerTime");
const powerRing = $("powerRing");
const hudDaily = $("hudDaily");
const comboEl = $("combo");
const comboNum = $("comboNum");
const comboFill = $("comboFill");
const today = dailyVariant();

const beat = challengeTarget();
let lastStats: RoundStats | null = null;
let roundRank: Rank = rankFor(0);
let roundBestBefore = 0;
let passedBest = false;
let toastTimer = 0;
let roundLive = false;
let comboTimer = 0;
let dailyDoneThisRound = false;

for (const el of document.querySelectorAll(".dailyNo")) el.textContent = String(dailyNumber());

if (!webgl2Available()) {
  // very old browsers: say so instead of showing a broken lawn
  const box = document.getElementById("loading")!;
  box.innerHTML = `<p class="nogl">The 3D lawn needs a browser with WebGL 2.<br>Try updating your browser, or read <a href="/about">about the cats</a>.</p>`;
  document.getElementById("overlay")!.hidden = true;
  throw new Error("WebGL 2 unavailable");
}

// ---- the 3D lawn --------------------------------------------------------------

const lawn = new Lawn({
  container: field,
  cats: 1,
  insets: () => {
    const f = field.getBoundingClientRect();
    const t = topbar.getBoundingClientRect();
    return { top: Math.max(0, t.bottom - f.top + 10), bottom: 12, left: 10, right: 10 };
  }
});
lawn.setCatSkin(1, currentSkin());
void lawn.ready.then(() => {
  $("loading").hidden = true;
  if (!views.shop.hidden) renderShop();
  const thumb = lawn.thumbnail(today);
  $<HTMLImageElement>("dailyImg").src = thumb;
  $<HTMLImageElement>("hudDailyImg").src = thumb;
});
new ResizeObserver(() => lawn.refit()).observe(topbar);

// ---- seals ------------------------------------------------------------------

const seals = new SealTracker();
mountSeals($("sealsList"), $("sealsCount"), toast);
// a streak carried over from earlier visits counts too
checkStreakSeals(currentStreak());

const COMBO_CALLS: Record<number, string> = {
  5: "Nice combo!",
  10: "Purrfect!",
  15: "Unstoppable!",
  20: "Feline frenzy!",
  30: "LEGENDARY!"
};

// round bar: a dot for every hole still to come
$("roundTicks").replaceChildren(
  ...HOLE_TIMES.map((t) => {
    const i = document.createElement("i");
    i.style.left = `${(t / FULL_LAWN_MS) * 100}%`;
    return i;
  })
);
const roundFill = $("roundFill");
const roundNext = $("roundNext");
const holesOpen = $("holesOpen");
const roundBar = $("roundBar");
const ticks = [...$("roundTicks").children] as HTMLElement[];

const game = new Game(lawn, {
  onScore(score) {
    scoreEl.textContent = String(score);
    scoreEl.classList.remove("is-bump");
    void scoreEl.offsetWidth;
    scoreEl.classList.add("is-bump");
    if (!score) return;
    // a few milestones inside the round: small, unexpected rewards
    const rank = rankFor(score);
    if (rank.id !== roundRank.id) {
      roundRank = rank;
      toast(`${rank.emoji} ${rank.name}!`, "rank");
      sfx.rankUp();
    } else if (!passedBest && roundBestBefore > 0 && score === roundBestBefore + 1) {
      passedBest = true;
      toast("New best!", "seal");
      sfx.rankUp();
    }
  },
  onCombo(combo) {
    renderCombo(combo);
    const call = COMBO_CALLS[combo] ?? (combo > 30 && combo % 10 === 0 ? `×${combo} LEGENDARY!` : "");
    if (call) {
      toast(call, "combo");
      sfx.combo(Math.floor(combo / 5));
      flash("#ffd66b");
    }
  },
  onTimer(remaining) {
    const ratio = remaining / CATCH_WINDOW_MS;
    timerFill.style.transform = `scaleX(${ratio})`;
    const zone = ratio > 0.5 ? "ok" : ratio > 0.25 ? "warn" : "danger";
    timerBar.dataset.zone = zone;
    field.dataset.zone = roundLive ? zone : "";
  },
  onPower(kind, remaining, total) {
    field.dataset.power = kind ?? "";
    if (kind === "fulltime") {
      toast("Full time!", "fulltime");
      return;
    }
    if (!kind) {
      powerBadge.hidden = true;
      return;
    }
    if (powerBadge.hidden || powerBadge.dataset.kind !== kind) {
      powerBadge.hidden = false;
      powerBadge.dataset.kind = kind;
      toast(POWER_LABEL[kind] + "!", kind);
    }
    powerTime.textContent = `${Math.ceil(remaining / 1000)}s`;
    powerRing.style.setProperty("--p", String(total ? remaining / total : 0));
  },
  onLawn(p) {
    roundFill.style.transform = `scaleX(${p.progress})`;
    holesOpen.textContent = String(p.open);
    const passed = p.open - 4;
    ticks.forEach((t, i) => {
      t.classList.toggle("is-open", i < passed);
      t.classList.toggle("is-next", i === passed);
    });
    roundNext.textContent = p.nextInMs === null ? `×${p.speed.toFixed(1)}` : `${Math.ceil(p.nextInMs / 1000)}s`;
    roundBar.classList.toggle("is-soon", p.nextInMs !== null && p.nextInMs < 1500);
    roundBar.classList.toggle("is-full", p.nextInMs === null);
  },
  onNewHole(open) {
    if (open === 25) toast("Full lawn!", "grid");
  },
  onLick(ms, cause) {
    toast(cause === "snake" ? "Chomp! Lick lick…" : "Ouch! Lick lick…", "ouch");
    field.dataset.lick = "1";
    window.setTimeout(() => (field.dataset.lick = ""), ms);
  },
  onFancy(variant) {
    // every round of the day adds to the same count
    const { state, justDone } = addDailyCatch();
    renderHudDaily(state.caught);
    if (justDone) {
      dailyDoneThisRound = true;
      const isNew = collectFancy(variant);
      toast(isNew ? "Daily done! New in your album" : "Daily Challenge done!", "seal");
      sfx.record();
    } else {
      toast(`${fancyKind(variant).name} ${state.caught}/${DAILY_GOAL}`, "fancy");
    }
  },
  onEvent(ev) {
    seals.feed(ev);
    if (ev.type === "eaten" && ev.fancy) toast("The snake got the mouse of the day!", "ouch");
  },
  onGameOver(score, best, isNewBest, stats) {
    roundLive = false;
    field.dataset.zone = "";
    music.stop();
    lastStats = stats;
    earnPoints(stats.points);
    track("game_end", { mode: "solo", score, points: stats.points, duration_s: Math.round(stats.elapsedMs / 1000), new_best: isNewBest });
    lawn.shakeIt(0.12);
    showResults(score, best, isNewBest, stats);
  }
}, { lizard: hasLizard, dailyDone: () => dailyState().done });

// ---- in-round juice -----------------------------------------------------------

function renderHudDaily(count: number): void {
  hudDaily.hidden = count === 0;
  $("hudDailyNum").textContent = String(count);
}

// The combo badge: the number bumps on every catch and its bar drains over the combo window,
// so you can see how long you have to keep the chain going.
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
  comboFill.style.animation = "none";
  void comboFill.offsetWidth;
  comboFill.style.animation = `comboDrain ${COMBO_WINDOW_MS}ms linear forwards`;
  field.dataset.frenzy = combo >= 10 ? "1" : "";
  comboTimer = window.setTimeout(() => renderCombo(0), COMBO_WINDOW_MS);
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

const views = { home: $("homeView"), album: $("albumView"), seals: $("sealsView"), shop: $("shopView"), account: $("accountView") };
const resultEl = $("result");
const challengeEl = $("challenge");

function showView(which: keyof typeof views): void {
  for (const [k, el] of Object.entries(views)) el.hidden = k !== which;
  guard(overlayCard);
  if (which === "album") renderAlbum();
  if (which === "shop") renderShop();
  renderWallet();
}
$("albumBtn").addEventListener("click", () => showView("album"));
$("sealsBtn").addEventListener("click", () => showView("seals"));
$("shopBtn").addEventListener("click", () => showView("shop"));
$("dailyCard").addEventListener("click", () => showView("album"));
for (const b of document.querySelectorAll("[data-back]")) b.addEventListener("click", () => showView("home"));

function renderDaily(): void {
  const st = dailyState();
  $("dailyName").textContent = fancyKind(today).name;
  $("dailyFill").style.transform = `scaleX(${st.caught / DAILY_GOAL})`;
  $("dailyCount").textContent = st.done ? "Done ✓" : `${st.caught}/${DAILY_GOAL}`;
  $("dailyCard").classList.toggle("is-done", st.done);
  $("albumCount").textContent = String(albumSize());
}

let albumSelected = -1;
function renderAlbum(): void {
  const grid = $("albumGrid");
  const name = $("albumName");
  name.textContent = "";
  grid.replaceChildren(
    ...Array.from({ length: FANCY_COUNT }, (_, i) => {
      const li = document.createElement("li");
      const b = document.createElement("button");
      b.type = "button";
      const has = albumHas(i);
      if (has) {
        b.className = "is-on";
        const url = lawn.thumbnail(i);
        if (url) b.style.backgroundImage = `url(${url})`;
      }
      if (i === today) b.classList.add("is-today");
      b.setAttribute("aria-label", has ? fancyKind(i).name : `Mouse #${i + 1}, not in the album yet`);
      b.addEventListener("click", () => {
        albumSelected = i;
        name.textContent = has ? fancyKind(i).name : i === today ? "Today's mouse!" : "???";
        grid.querySelector(".is-sel")?.classList.remove("is-sel");
        b.classList.add("is-sel");
      });
      if (i === albumSelected) b.classList.add("is-sel");
      li.append(b);
      return li;
    })
  );
}

// ---- shop ---------------------------------------------------------------------------

type ShopItem = SkinId | "lizard";
const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
let shopSelected: ShopItem = currentSkin();

function renderWallet(): void {
  const w = wallet().toLocaleString("en-US");
  $("walletCount").textContent = w;
  $("walletNum").textContent = w;
}

function renderShop(): void {
  const items: ShopItem[] = [...SKINS.map((s) => s.id), "lizard"];
  const equipped = currentSkin();
  $("shopGrid").replaceChildren(
    ...items.map((id) => {
      const li = document.createElement("li");
      const b = document.createElement("button");
      b.type = "button";
      b.className = "shop__item";
      const isLizard = id === "lizard";
      const own = isLizard ? hasLizard() : ownsSkin(id);
      const price = isLizard ? LIZARD_PRICE : skinById(id).price;
      const name = isLizard ? "Yellow Lizard" : skinById(id).name;
      if (own) b.classList.add("is-owned");
      if (!isLizard && id === equipped) b.classList.add("is-equipped");
      if (id === shopSelected) b.classList.add("is-sel");
      if (isLizard) b.classList.add("is-critter");
      const img = document.createElement("img");
      img.alt = "";
      img.width = img.height = 64;
      img.src = isLizard ? lawn.lizardThumbnail() : lawn.catThumbnail(id);
      const tag = document.createElement("small");
      tag.textContent = own ? (isLizard ? "Unlocked" : id === equipped ? "On" : "Owned") : compact.format(price);
      if (!own) tag.classList.add("is-price");
      b.append(img, tag);
      b.setAttribute("aria-label", `${name}, ${own ? "owned" : `${price} points`}`);
      b.addEventListener("click", () => {
        shopSelected = id;
        renderShop();
      });
      li.append(b);
      return li;
    })
  );
  renderShopDetail();
}

function renderShopDetail(): void {
  const id = shopSelected;
  const isLizard = id === "lizard";
  const btn = $<HTMLButtonElement>("shopBuy");
  const price = isLizard ? LIZARD_PRICE : skinById(id).price;
  const own = isLizard ? hasLizard() : ownsSkin(id);
  $("shopName").textContent = isLizard ? "Yellow Lizard" : skinById(id).name;
  $("shopBlurb").textContent = isLizard
    ? `A new critter to hunt. Quick, and worth ${LIZARD_VALUE} mice.`
    : skinById(id).blurb;
  btn.disabled = false;
  if (own) {
    btn.textContent = isLizard ? "Unlocked" : currentSkin() === id ? "Your cat" : "Choose";
    btn.disabled = isLizard || currentSkin() === id;
  } else {
    btn.textContent = `Buy · ${price.toLocaleString("en-US")}`;
    btn.disabled = wallet() < price;
  }
}

$("shopBuy").addEventListener("click", () => {
  const id = shopSelected;
  if (id === "lizard") {
    if (buyLizard()) {
      track("unlock_item", { item: "lizard", price: LIZARD_PRICE });
      toast("Lizard unlocked!", "seal");
      sfx.record();
    }
  } else if (ownsSkin(id)) {
    equipSkin(id);
    lawn.setCatSkin(1, id);
    sfx.powerCollect();
  } else if (buySkin(id)) {
    track("unlock_cat", { cat: id, price: skinById(id).price });
    lawn.setCatSkin(1, id);
    toast(`${skinById(id).name} joined the company!`, "seal");
    sfx.record();
  }
  renderWallet();
  renderShop();
});

function renderStart(): void {
  overlay.dataset.mode = "start";
  $("brandLogo").hidden = false;
  overlayTitle.hidden = true;
  resultEl.hidden = true;
  $("intro").hidden = false;
  renderDaily();
  if (beat) {
    challengeEl.hidden = false;
    challengeEl.innerHTML = `A friend caught <b>${beat}</b> mice. Beat it!`;
  }
}

function countUp(el: HTMLElement, to: number): void {
  if (reduceMotion || to <= 0) {
    el.textContent = String(to);
    return;
  }
  const dur = Math.min(1100, 300 + to * 25);
  const t0 = performance.now();
  const step = (now: number): void => {
    const t = Math.min(1, (now - t0) / dur);
    el.textContent = String(Math.round(to * (1 - Math.pow(1 - t, 3))));
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function showResults(score: number, best: number, isNewBest: boolean, stats: RoundStats): void {
  const wonChallenge = beat !== null && score > beat;
  recordRound();
  const dailyDone = dailyDoneThisRound;
  kicker.textContent = dailyDone ? `Daily #${dailyNumber()} complete` : isNewBest ? "Personal best" : "Round over";
  $("brandLogo").hidden = true;
  overlayTitle.hidden = false;
  overlayTitle.textContent = dailyDone
    ? "Fancy feast!"
    : isNewBest
      ? "New record!"
      : wonChallenge
        ? "Challenge won!"
        : score === 0
          ? "Too slow!"
          : best - score <= 3
            ? "So close!"
            : "Nice hunt!";
  challengeEl.hidden = true;
  $("intro").hidden = true;
  resultEl.hidden = false;
  $("resultUnit").textContent = score === 1 ? "mouse" : "mice";
  countUp($("resultNum"), score);
  const rank = rankFor(score);
  const chip = $("rankChip");
  chip.textContent = `${rank.emoji} ${rank.name}`;
  chip.style.setProperty("--r1", rank.tint[0]);
  chip.style.setProperty("--r2", rank.tint[1]);
  $("resultPoints").textContent = `+${stats.points.toLocaleString("en-US")} pts · best ${best}`;
  $("factText").textContent = nextFact().text;
  renderWallet();
  renderDaily();
  renderNudge();

  playBtn.textContent = "Play again";
  shareBtn.hidden = false;
  showOverlay();
  if (isNewBest || wonChallenge || dailyDone) {
    confetti();
    setTimeout(() => sfx.record(), 350);
  }
}

// The next cat the player doesn't own yet: how many points it still needs, and a way to the packs.
function renderNudge(): void {
  const next = SKINS.filter((s) => !ownsSkin(s.id)).sort((a, b) => a.price - b.price)[0];
  const guest = !acc?.account().member;
  const nudge = $("nudge");
  nudge.hidden = !next && !guest;
  const need = next ? next.price - wallet() : 0;
  $("nudgeText").innerHTML = next
    ? need > 0
      ? `<b>${need.toLocaleString("en-US")} pts</b> to the ${next.name}`
      : `You can unlock the <b>${next.name}</b>!`
    : "All the cats are yours!";
  $("nudgeShop").textContent = next && need > 0 ? "Get points" : "Open the shop";
  $("nudgeShop").hidden = !next;
  $("nudgeSignIn").hidden = !guest || wallet() <= 0;
}
$("nudgeShop").addEventListener("click", () => showView("shop"));
$("nudgeSignIn").addEventListener("click", () => openAccount("signup"));

function confetti(): void {
  if (reduceMotion) return;
  const box = $("confetti");
  box.replaceChildren();
  const colors = ["#ffd66b", "#ffae42", "#ff8fb1", "#7fe0c3", "#c9b6ff", "#fff"];
  for (let i = 0; i < 60; i++) {
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
  lawn.setCalm(true);
  overlay.classList.remove("is-leaving");
  showView("home");
  playBtn.focus({ preventScroll: true });
}

function hideOverlay(): void {
  lawn.setCalm(false);
  overlay.classList.add("is-leaving");
  setTimeout(() => (overlay.hidden = true), 250);
}

function play(): void {
  if (isGuarded()) return;
  sfx.unlock();
  hideOverlay();
  closeSheet();
  roundRank = rankFor(0);
  roundBestBefore = game.bestScore;
  passedBest = false;
  dailyDoneThisRound = false;
  track("game_start", { mode: "solo", skin: currentSkin() });
  const today0 = dailyState();
  renderHudDaily(today0.done ? 0 : today0.caught);
  const streak = touchStreak();
  music.start();
  roundLive = true;
  game.start();
  // the lawn gets the same grace period as the menus: nothing to tap for a moment
  const ready = $("ready");
  ready.hidden = false;
  setTimeout(() => (ready.hidden = true), GUARD_MS);
  if (streak.grew) setTimeout(() => toast(`🔥 ${streak.days}-day streak!`, "seal"), GUARD_MS + 200);
  setTimeout(() => checkStreakSeals(streak.days), GUARD_MS + 1700);
}

playBtn.addEventListener("click", play);

document.addEventListener("keydown", (ev) => {
  if (ev.code !== "Space" || overlay.hidden || !sheet.hidden || views.home.hidden) return;
  if (document.activeElement instanceof HTMLButtonElement && document.activeElement !== playBtn) return;
  ev.preventDefault();
  play();
});

// ---- share: Wordle-style text ---------------------------------------------------

const sheet = $("shareSheet");
const sheetCard = sheet.querySelector<HTMLElement>(".sheet__card")!;
const copyBtn = $<HTMLButtonElement>("copyBtn");
const nativeBtn = $<HTMLButtonElement>("shareNativeBtn");
nativeBtn.hidden = !("share" in navigator);

function shareText(): string {
  return lastStats ? dailyShareText(lastStats, lastStats.score) : "";
}

shareBtn.addEventListener("click", () => {
  if (!lastStats) return;
  sfx.unlock();
  const text = shareText();
  $("shareText").textContent = text;
  $<HTMLAnchorElement>("postXBtn").href = `https://x.com/intent/post?text=${encodeURIComponent(text)}`;
  sheet.hidden = false;
  guard(sheetCard);
});

function closeSheet(): void {
  sheet.hidden = true;
}
$("sheetClose").addEventListener("click", () => {
  closeSheet();
  guard(overlayCard);
});
sheet.addEventListener("click", (ev) => {
  if (ev.target === sheet) {
    closeSheet();
    guard(overlayCard);
  }
});
document.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape" && !sheet.hidden) closeSheet();
});
copyBtn.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(shareText());
    copyBtn.textContent = "Copied!";
  } catch {
    copyBtn.textContent = "Copy failed";
  }
  setTimeout(() => (copyBtn.textContent = "Copy"), 1500);
});
nativeBtn.addEventListener("click", async () => {
  try {
    await navigator.share({ text: shareText() });
  } catch {
    /* cancelled */
  }
});

// ---- sound, visibility --------------------------------------------------------

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
field.addEventListener("touchstart", () => sfx.unlock(), { passive: true, once: true });

// the game script ran (the self-heal snippet in index.html and support checks look for this)
document.documentElement.dataset.booted = "1";
renderStart();
renderWallet();
guard(overlayCard);
lawn.setCalm(true);

// ---- account and the points pack ------------------------------------------------
// Supabase loads in its own chunk after the game is up. Guests play on an anonymous session; an
// e-mail account keeps points and cats on the server and is needed to buy points.

type AccountModule = typeof import("./account");
let acc: AccountModule | null = null;
const offerBtns = [...document.querySelectorAll<HTMLButtonElement>(".offer[data-pack]")];
const accountBtn = $<HTMLButtonElement>("accountBtn");
const authForm = $<HTMLFormElement>("authForm");
const authEmail = $<HTMLInputElement>("authEmail");
const authPassword = $<HTMLInputElement>("authPassword");
const authSubmit = $<HTMLButtonElement>("authSubmit");
const authMsg = $("authMsg");
type AuthMode = "signin" | "signup" | "reset" | "newpass";
let authMode: AuthMode = "signin";

function renderAccount(): void {
  const st = acc?.account();
  const member = !!st?.member;
  $("accountText").textContent = member ? st!.email : "Playing as a guest";
  accountBtn.textContent = member ? "Account" : "Sign in to save your points";
  $("offerNote").textContent = member ? "One-time payments, added to your account" : "Sign in to buy points";
  for (const b of offerBtns) {
    b.disabled = !acc;
    b.hidden = b.dataset.pack === "starter" && member && starterUsed();
  }
  accountBtn.disabled = !acc;
  // the account view: a form for guests, the account for members
  if (st?.recovering) authMode = "newpass";
  const showForm = !member || authMode === "newpass";
  authForm.hidden = !showForm;
  $("authLinks").hidden = !showForm || authMode === "newpass";
  $("authMember").hidden = showForm;
  $("authWho").textContent = st?.email ?? "";
  const titles: Record<AuthMode, [string, string, string]> = {
    signin: ["Sign in", "Keep your points and cats on every device, and buy points.", "Sign in"],
    signup: ["Create an account", "We'll e-mail you a link to confirm your address. Your points and cats on this device come along.", "Create account"],
    reset: ["Reset password", "We'll e-mail you a link to choose a new password.", "Send link"],
    newpass: ["New password", "Choose a new password for your account.", "Save password"]
  };
  const [title, sub, submit] = member && authMode !== "newpass" ? ["Your account", "", ""] : titles[authMode];
  $("authTitle").textContent = title;
  $("authSub").textContent = sub;
  $("authSub").hidden = !sub;
  authSubmit.textContent = submit;
  authEmail.hidden = authMode === "newpass";
  authPassword.hidden = authMode === "reset";
  authPassword.autocomplete = authMode === "signin" ? "current-password" : "new-password";
  authPassword.placeholder = authMode === "signin" ? "Password" : "Password (8+ characters)";
  $("authSwitch").textContent = authMode === "signup" ? "Have an account? Sign in" : "New here? Create an account";
  $("authForgot").hidden = $("authForgotSep").hidden = authMode !== "signin";
  $("authWallet").textContent = wallet().toLocaleString("en-US");
  $("homeAccountBtn").textContent = member ? "Account" : "Sign in";
}

function say(text: string, kind: "ok" | "error" | "" = ""): void {
  authMsg.textContent = text;
  authMsg.dataset.kind = kind;
  authMsg.hidden = !text;
}

function openAccount(mode?: AuthMode): void {
  if (mode) authMode = mode;
  say("");
  showView("account");
  renderAccount();
}

$("authSwitch").addEventListener("click", () => {
  authMode = authMode === "signup" ? "signin" : "signup";
  say("");
  renderAccount();
});
$("authForgot").addEventListener("click", () => {
  authMode = "reset";
  say("");
  renderAccount();
});

authForm.addEventListener("submit", (ev) => {
  ev.preventDefault();
  if (!acc) return;
  const a = acc;
  const email = authEmail.value.trim();
  const password = authPassword.value;
  if (authMode !== "newpass" && !/^\S+@\S+\.\S+$/.test(email)) return say("Enter a valid e-mail address.", "error");
  if (authMode !== "reset" && password.length < 8) return say("Passwords have at least 8 characters.", "error");
  authSubmit.disabled = true;
  say("");
  const run = async (): Promise<void> => {
    if (authMode === "signin") {
      await a.signIn(email, password);
      authPassword.value = "";
    } else if (authMode === "signup") {
      await a.signUp(email, password);
      authPassword.value = "";
      authMode = "signin";
      say(`Almost there: we sent a confirmation link to ${email}. Open it, then sign in here.`, "ok");
    } else if (authMode === "reset") {
      await a.sendPasswordReset(email);
      authMode = "signin";
      say(`If ${email} has an account, a reset link is on its way.`, "ok");
    } else {
      await a.setNewPassword(password);
      authPassword.value = "";
      authMode = "signin";
      say("Password saved. You're signed in.", "ok");
    }
  };
  run()
    .catch((err: unknown) => say(err instanceof Error ? err.message : "Something went wrong", "error"))
    .finally(() => {
      authSubmit.disabled = false;
      renderAccount();
    });
});

$("signOutBtn").addEventListener("click", () => {
  if (!acc) return;
  void acc.signOut().then(() => {
    authMode = "signin";
    say("Signed out. You're playing as a guest.", "ok");
    renderAccount();
  });
});

accountBtn.addEventListener("click", () => openAccount(acc?.account().member ? undefined : "signin"));
$("homeAccountBtn").addEventListener("click", () => openAccount(acc?.account().member ? undefined : "signin"));
$("authShopBtn").addEventListener("click", () => showView("shop"));
for (const btn of offerBtns) {
  btn.addEventListener("click", () => {
    if (!acc) return;
    if (!acc.account().member) return openAccount("signin");
    for (const b of offerBtns) b.disabled = true;
    acc.buyPoints(btn.dataset.pack as PackId)
      .catch((err: unknown) => toast(err instanceof Error ? err.message : "Checkout is unavailable", "ouch"))
      .finally(renderAccount);
  });
}

// the wallet and the cats can change from the server (sign-in, purchases, a refused buy)
onInventory(() => {
  renderWallet();
  renderAccount();
  if (!views.shop.hidden) renderShop();
  lawn.setCatSkin(1, currentSkin());
});

void (async () => {
  const url = new URL(location.href);
  const paid = url.searchParams.get("paid");
  const openShop = paid !== null || url.searchParams.has("shop");
  const openAcc = url.searchParams.has("account");
  for (const k of ["paid", "shop", "account"]) url.searchParams.delete(k);
  if (openShop || openAcc) history.replaceState(null, "", url.pathname + url.search + location.hash);
  try {
    acc = await import("./account");
    acc.onAccount(renderAccount);
    await acc.initAccount();
  } catch (err) {
    console.warn("accounts unavailable", err);
    return;
  }
  if (!overlay.hidden) {
    if (openAcc) openAccount();
    else if (openShop) showView("shop");
  }
  if (paid) {
    const got = await acc.confirmPurchase(paid);
    if (got > 0) {
      toast(`+${got.toLocaleString("en-US")} pts added!`, "seal");
      sfx.record();
      confetti();
    } else toast("Payment received. Your points will arrive shortly.", "seal");
  }
})();

// dev-only handles for poking at the lawn from the console
if (import.meta.env.DEV) Object.assign(window, { __lawn: lawn, __game: game });
