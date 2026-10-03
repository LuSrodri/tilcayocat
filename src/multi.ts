import "./style.css";
import { Lawn, webgl2Available } from "./engine/lawn";
import { sfx, music, volume } from "./sound";
import { API, WS_BASE } from "./api";
import { earn, mountSeals, checkStreakSeals } from "./seals";
import { touchStreak } from "./rank";
import { currentSkin, hasLizard, earnPoints } from "./shop";
import { mountOnline } from "./presence";
import { fancyKind } from "./fancy";
import { guard } from "./guard";
import { track } from "./analytics";
import type { PlayerInfo, RoundResult, ServerMessage, Slot } from "../worker/src/protocol";
import { GRID, ROUND_MS, RECONNECT_GRACE_MS } from "../worker/src/protocol";

// The 1v1 arena is server-driven: the MatchRoom Durable Object spawns the critters and resolves
// every tap; this file only renders what the room says (on the same 3D lawn as solo) and sends taps.

const NAME_KEY = "tilcayo.name";

function $<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el as T;
}

const field = $("field");
const overlay = $("overlay");
const overlayCard = overlay.querySelector<HTMLElement>(".overlay__card")!;
const panels = { lobby: $("panelLobby"), wait: $("panelWait"), result: $("panelResult") };
const nameInput = $<HTMLInputElement>("nameInput");
const codeInput = $<HTMLInputElement>("codeInput");
const lobbyError = $("lobbyError");
const countdownEl = $("countdown");
const hudEl = document.querySelector<HTMLElement>(".hud")!;
if (!webgl2Available()) {
  // very old browsers: say so instead of showing a broken lawn
  const box = document.getElementById("loading")!;
  box.innerHTML = `<p class="nogl">The 3D lawn needs a browser with WebGL 2.<br>Try updating your browser, or read <a href="/about">about the cats</a>.</p>`;
  document.getElementById("overlay")!.hidden = true;
  throw new Error("WebGL 2 unavailable");
}

const ALL_HOLES = Array.from({ length: GRID * GRID }, (_, i) => i);

const lawn = new Lawn({
  container: field,
  cats: 2,
  insets: () => {
    const f = field.getBoundingClientRect();
    const h = hudEl.getBoundingClientRect();
    // leave room above the cats for their name tags
    return { top: Math.max(0, h.bottom - f.top + 34), bottom: 12, left: 8, right: 8 };
  }
});
// until the room says who is who, both cats wear yours
lawn.setCatSkin(1, currentSkin());
lawn.setCatSkin(2, currentSkin());
void lawn.ready.then(() => {
  $("loading").hidden = true;
  lawn.setActive(ALL_HOLES, false);
  lawn.setTag(1, $("tag1"));
  lawn.setTag(2, $("tag2"));
});
lawn.onTap((hole) => {
  sfx.unlock();
  if (phase !== "round" || lawn.isLicking(me)) return;
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "tap", hole }));
});

// the lobby has no seal shelf; earning one still gets its toast and fanfare
mountSeals(document.createElement("ul"), document.createElement("span"), toast);
mountOnline("duel");

let ws: WebSocket | null = null;
let queueWs: WebSocket | null = null;
let me: Slot = 1;
let code = "";
let phase: "idle" | "waiting" | "countdown" | "round" | "intermission" | "final" = "idle";
let clockOffset = 0; // serverNow - Date.now()
let roundEndsAt = 0;
let clockTimer = 0;
let toastTimer = 0;
let names: [string, string] = ["You", "Opponent"];
// reconnection: the room hands out a token that takes our slot back after a drop
let token = "";
let joinName = "";
let lostAt = 0; // when the current outage began; 0 while connected
let retries = 0;
let retryTimer = 0;
let lastHeard = 0;
let rivalHere = false;
const mouseHole = new Map<number, number>();
const fancyOf = new Map<number, number>();

// ---- lobby ------------------------------------------------------------------

try {
  nameInput.value = localStorage.getItem(NAME_KEY) ?? "";
} catch {
  /* ignore */
}

function myName(): string {
  const n = nameInput.value.trim().slice(0, 14) || "Cat";
  try {
    localStorage.setItem(NAME_KEY, n);
  } catch {
    /* ignore */
  }
  return n;
}

function showPanel(which: keyof typeof panels): void {
  for (const [k, el] of Object.entries(panels)) el.hidden = k !== which;
  overlay.hidden = false;
  overlay.classList.remove("is-leaving");
  lawn.setCalm(true);
  guard(overlayCard);
}

function hideOverlay(): void {
  lawn.setCalm(false);
  overlay.classList.add("is-leaving");
  setTimeout(() => (overlay.hidden = true), 250);
}

function fail(message: string): void {
  lobbyError.textContent = message;
  lobbyError.hidden = false;
  showPanel("lobby");
}

$("quickBtn").addEventListener("click", () => {
  sfx.unlock();
  const name = myName();
  $("waitText").textContent = "Looking for a random rival…";
  $("codeBox").hidden = true;
  showPanel("wait");
  queueWs = new WebSocket(`${WS_BASE}/quick?name=${encodeURIComponent(name)}`);
  queueWs.onmessage = (ev) => {
    const msg = JSON.parse(ev.data) as ServerMessage;
    if (msg.type === "matched") {
      queueWs?.close();
      queueWs = null;
      connect(msg.code, name);
    }
  };
  queueWs.onerror = () => fail("Could not reach the matchmaking server.");
});

$("createBtn").addEventListener("click", async () => {
  sfx.unlock();
  const name = myName();
  try {
    const res = await fetch(`${API}/create`);
    const data = (await res.json()) as { code: string };
    connect(data.code, name);
  } catch {
    fail("Could not create a room. Try again.");
  }
});

$<HTMLFormElement>("joinForm").addEventListener("submit", (ev) => {
  ev.preventDefault();
  sfx.unlock();
  const c = codeInput.value.trim().toUpperCase();
  if (!/^[A-Z0-9]{4,8}$/.test(c)) {
    fail("Room codes have 5 letters or digits.");
    return;
  }
  connect(c, myName());
});

$("cancelBtn").addEventListener("click", () => {
  queueWs?.close();
  queueWs = null;
  phase = "idle";
  dropSocket();
  history.replaceState(null, "", "/play");
  showPanel("lobby");
});

$("copyBtn").addEventListener("click", async () => {
  const url = `${location.origin}/play?room=${code}`;
  try {
    if (navigator.share) await navigator.share({ title: "Cat The Mouse Company 1v1", text: "🐱 Join my lawn in Cat The Mouse Company! First cat to win 2 rounds takes the match. 🐭", url });
    else await navigator.clipboard.writeText(url);
    $("copyBtn").textContent = "Copied!";
    setTimeout(() => ($("copyBtn").textContent = "Copy link"), 1500);
  } catch {
    /* cancelled */
  }
});

$("againBtn").addEventListener("click", () => {
  history.replaceState(null, "", "/play");
  resetArena();
  showPanel("lobby");
  void loadLeaderboard();
});

$("shareBtn").addEventListener("click", async () => {
  const text = lastShareText;
  try {
    if (navigator.share) await navigator.share({ title: "Cat The Mouse Company 1v1", text, url: "https://catthemouse.co/play" });
    else await navigator.clipboard.writeText(`${text} https://catthemouse.co/play`);
  } catch {
    /* cancelled */
  }
});
let lastShareText = "";

async function loadLeaderboard(): Promise<void> {
  try {
    const res = await fetch(`${API}/leaderboard`);
    const data = (await res.json()) as { players: { name: string; wins: number; losses: number; draws: number }[] };
    const list = $("leaderList");
    if (!data.players.length) return;
    list.replaceChildren(
      ...data.players.map((p, i) => {
        const li = document.createElement("li");
        li.className = "leader__row";
        li.innerHTML = `<span class="leader__rank">${i + 1}</span><span class="leader__name"></span><span class="leader__wins">${p.wins} W · ${p.losses} L</span>`;
        li.querySelector(".leader__name")!.textContent = p.name;
        return li;
      })
    );
  } catch {
    /* offline: keep placeholder */
  }
}

// ---- connection -------------------------------------------------------------

const tokenKey = (c: string): string => `tilcayo.mp.${c}`;

function connect(roomCode: string, name: string): void {
  phase = "idle";
  dropSocket();
  code = roomCode.toUpperCase();
  joinName = name;
  // a token from this tab (e.g. after a reload mid-match) takes the same seat back
  try {
    token = sessionStorage.getItem(tokenKey(code)) ?? "";
  } catch {
    token = "";
  }
  history.replaceState(null, "", `/play?room=${code}`);
  showWaiting();
  phase = "waiting";
  lobbyError.hidden = true;
  openSocket();
}

function showWaiting(): void {
  $("waitText").textContent = "Share this code or link with a friend.";
  $("codeBox").hidden = false;
  $("codeText").textContent = code;
  showPanel("wait");
}

function openSocket(): void {
  window.clearTimeout(retryTimer);
  // your cat and your unlocked lizard come along to the match
  const sock = new WebSocket(
    `${WS_BASE}/ws/${code}?name=${encodeURIComponent(joinName)}&skin=${currentSkin()}&lizard=${hasLizard() ? 1 : 0}&token=${encodeURIComponent(token)}`
  );
  const prev = ws;
  ws = sock;
  prev?.close(); // an attempt still hanging in "connecting"
  let opened = false;
  sock.onopen = () => {
    opened = true;
    lastHeard = Date.now();
  };
  sock.onmessage = (ev) => {
    if (sock !== ws) return;
    lastHeard = Date.now();
    handle(JSON.parse(ev.data) as ServerMessage);
  };
  sock.onclose = (ev) => {
    if (sock !== ws) return;
    ws = null;
    if (phase === "final" || phase === "idle") return;
    if (ev.code === 1008) return; // "full" was already handled
    if (!opened && !lostAt) {
      phase = "idle";
      fail("Connection failed. Check the code and try again.");
      return;
    }
    reconnect();
  };
}

// Forget the current socket without triggering a reconnect.
function dropSocket(): void {
  window.clearTimeout(retryTimer);
  lostAt = 0;
  retries = 0;
  const s = ws;
  ws = null;
  s?.close();
}

// Retry with backoff while the room still holds our seat (it waits RECONNECT_GRACE_MS for us).
function reconnect(): void {
  if (!lostAt) {
    lostAt = Date.now();
    retries = 0;
    stopClock();
    music.stop();
    clearMice();
    countdownEl.hidden = true;
    $("waitText").textContent = "Connection lost. Reconnecting…";
    $("codeBox").hidden = true;
    showPanel("wait");
  }
  if (Date.now() - lostAt > RECONNECT_GRACE_MS + 5000) {
    phase = "idle";
    dropSocket();
    fail("Connection lost. Could not get back to the lawn.");
    return;
  }
  window.clearTimeout(retryTimer);
  retryTimer = window.setTimeout(openSocket, Math.min(4000, 500 * 2 ** retries++));
}

function matchLive(): boolean {
  return phase === "waiting" || phase === "countdown" || phase === "round" || phase === "intermission";
}

function handle(msg: ServerMessage): void {
  switch (msg.type) {
    case "full":
      phase = "idle";
      fail(lostAt ? "Connection lost. The match ended while you were away." : "That room is already full.");
      lostAt = 0;
      break;
    case "welcome": {
      const wasLost = lostAt !== 0;
      lostAt = 0;
      retries = 0;
      if (wasLost && !msg.resumed && phase !== "waiting") {
        // the room forgot us (the match is long over): nothing to go back to
        phase = "idle";
        dropSocket();
        fail("Connection lost. The match ended while you were away.");
        return;
      }
      me = msg.you;
      token = msg.token;
      try {
        sessionStorage.setItem(tokenKey(code), token);
      } catch {
        /* ignore */
      }
      clockOffset = msg.now - Date.now();
      applyPlayers(msg.players);
      // still waiting for a rival: back to the code screen; otherwise the room resyncs us next
      if (wasLost && phase === "waiting") showWaiting();
      break;
    }
    case "players":
      applyPlayers(msg.players);
      break;
    case "countdown": {
      phase = "countdown";
      clockOffset = msg.now - Date.now();
      resetArena();
      $("hudRound").textContent = String(msg.round);
      $("roundFill").style.transform = "scaleX(0)";
      hideOverlay();
      toast(`Round ${msg.round}`, "grid");
      runCountdown(msg.startsAt);
      break;
    }
    case "round": {
      phase = "round";
      clockOffset = msg.now - Date.now();
      roundEndsAt = msg.endsAt;
      countdownEl.hidden = true;
      if (!overlay.hidden) hideOverlay(); // back from a reconnect mid-round
      setScores(msg.scores);
      setWins(msg.wins);
      $("hudRound").textContent = String(msg.round);
      music.start();
      startClock();
      if (msg.round === 1) {
        checkStreakSeals(touchStreak().days);
        track("game_start", { mode: "duel", skin: currentSkin() });
      }
      break;
    }
    case "spawn": {
      const m = msg.mouse;
      mouseHole.set(m.id, m.hole);
      if (m.kind === "fancy" && m.variant !== undefined) fancyOf.set(m.id, m.variant);
      lawn.raise(m.hole, m.kind, m.variant ?? null);
      if (m.kind === "porcupine") sfx.grunt();
      else if (m.kind === "snake") sfx.hiss();
      else if (m.kind === "lizard") sfx.squeak();
      else if (m.kind === "fancy") {
        sfx.fancy();
        toast("Fancy mouse! +3", "fancy");
      } else sfx.squeak();
      break;
    }
    case "hop": {
      mouseHole.set(msg.id, msg.to);
      lawn.hop(msg.from, msg.to);
      sfx.hop();
      break;
    }
    case "eaten": {
      mouseHole.delete(msg.id);
      fancyOf.delete(msg.id);
      lawn.eat(msg.snakeHole, msg.hole);
      sfx.gulp();
      break;
    }
    case "ouch": {
      lawn.slap(msg.hole, msg.by, msg.kind === "snake" ? "bite" : "prick", msg.kind === "snake" ? "Chomp!" : "Ouch!");
      const by = msg.by;
      setTimeout(() => lawn.lick(by, msg.ms - 300), 300);
      if (by === me) {
        sfx.ouch();
        setTimeout(() => sfx.lick(), 500);
        toast(msg.kind === "snake" ? "Snake bite! Lick lick…" : "Prickly! Lick lick…", "ouch");
        if (navigator.vibrate) navigator.vibrate([30, 40, 30]);
      }
      break;
    }
    case "hide": {
      const h = mouseHole.get(msg.id);
      mouseHole.delete(msg.id);
      fancyOf.delete(msg.id);
      if (h !== undefined) lawn.lower(h);
      break;
    }
    case "catch": {
      mouseHole.delete(msg.id);
      const variant = fancyOf.get(msg.id);
      fancyOf.delete(msg.id);
      lawn.slap(msg.hole, msg.by, "catch", "");
      const label = `+${msg.gain}`;
      const kind = msg.gain > 1 ? "fancy" : msg.by === me ? "catch" : "rival";
      setTimeout(() => lawn.pop(msg.hole, label, kind), 160);
      setScores(msg.scores);
      lawn.cat(msg.by, "catch", 800);
      if (msg.by === me) {
        sfx.catch();
        if (variant !== undefined) {
          sfx.fancyCatch();
          toast(fancyKind(variant).name, "fancy");
        }
        if (navigator.vibrate) navigator.vibrate(12);
      } else {
        sfx.miss();
      }
      break;
    }
    case "whiff": {
      lawn.slap(msg.hole, msg.by, "whiff", msg.by === me ? "miss" : "");
      lawn.cat(msg.by, "angry", 420);
      break;
    }
    case "roundEnd": {
      phase = "intermission";
      stopClock();
      music.stop();
      clearMice();
      setWins(msg.wins);
      showRoundResult(msg.result, msg.wins, msg.nextAt ? msg.nextAt - (msg.now - Date.now()) : null);
      break;
    }
    case "final": {
      phase = "final";
      stopClock();
      music.stop();
      clearMice();
      setWins(msg.wins);
      showFinal(msg.winner, msg.wins, msg.rounds, msg.totals, msg.forfeit);
      track("game_end", { mode: "duel", score: msg.totals[me - 1], won: msg.winner === me, forfeit: msg.forfeit });
      void loadLeaderboard();
      break;
    }
    default:
      break;
  }
}

function applyPlayers(players: PlayerInfo[]): void {
  for (const p of players) {
    names[p.slot - 1] = p.name;
    $(`hudName${p.slot}`).textContent = p.slot === me ? `${p.name} (you)` : p.name;
    $(`tagName${p.slot}`).textContent = p.slot === me ? `${p.name} (you)` : p.name;
    lawn.setCatPresent(p.slot, p.connected);
    if (p.skin) lawn.setCatSkin(p.slot, p.skin);
  }
  const rival = players.find((p) => p.slot !== me);
  if (rival && phase !== "waiting" && matchLive()) {
    if (rivalHere && !rival.connected) toast(`${rival.name} lost connection…`, "ouch");
    else if (!rivalHere && rival.connected) toast(`${rival.name} is back!`, "grid");
  }
  rivalHere = rival?.connected ?? false;
  if (players.length < 2) {
    const other: Slot = me === 1 ? 2 : 1;
    $(`hudName${other}`).textContent = "…";
    $(`tagName${other}`).textContent = "…";
    lawn.setCatPresent(other, false);
  }
  document.body.dataset.me = String(me);
}

// ---- arena rendering --------------------------------------------------------

function resetArena(): void {
  clearMice();
  setScores([0, 0]);
  $("hudClock").textContent = String(ROUND_MS / 1000);
  for (const s of [1, 2] as Slot[]) lawn.cat(s, "idle");
}

function clearMice(): void {
  mouseHole.clear();
  fancyOf.clear();
  lawn.clear();
}

function setScores(scores: [number, number]): void {
  for (const s of [1, 2] as Slot[]) {
    const v = String(scores[s - 1]);
    const hud = $(`hudScore${s}`);
    if (hud.textContent !== v) {
      hud.textContent = v;
      hud.classList.remove("is-bump");
      void hud.offsetWidth;
      hud.classList.add("is-bump");
    }
    $(`tagScore${s}`).textContent = v;
  }
}

function setWins(wins: [number, number]): void {
  for (const s of [1, 2] as Slot[]) {
    $(`hudWins${s}`).innerHTML = [0, 1].map((i) => `<i class="${i < wins[s - 1] ? "is-won" : ""}"></i>`).join("");
  }
}

function runCountdown(startsAt: number): void {
  countdownEl.hidden = false;
  const tick = (): void => {
    const left = Math.ceil((startsAt - (Date.now() + clockOffset)) / 1000);
    if (left <= 0) {
      countdownEl.textContent = "Go!";
      setTimeout(() => (countdownEl.hidden = true), 600);
      return;
    }
    countdownEl.textContent = String(left);
    sfx.squeak();
    setTimeout(tick, 250);
  };
  tick();
}

function startClock(): void {
  stopClock();
  const step = (): void => {
    const left = Math.max(0, roundEndsAt - (Date.now() + clockOffset));
    $("hudClock").textContent = String(Math.ceil(left / 1000));
    $("roundFill").style.transform = `scaleX(${1 - left / ROUND_MS})`;
    field.dataset.zone = left < 10_000 ? "danger" : left < 20_000 ? "warn" : "ok";
  };
  step();
  clockTimer = window.setInterval(step, 100);
}

function stopClock(): void {
  window.clearInterval(clockTimer);
  field.dataset.zone = "";
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

// ---- results ----------------------------------------------------------------

function rankingTable(rounds: RoundResult[], totals: [number, number], wins: [number, number]): string {
  const order: Slot[] = wins[0] === wins[1] ? (totals[0] >= totals[1] ? [1, 2] : [2, 1]) : wins[0] > wins[1] ? [1, 2] : [2, 1];
  const head = `<tr><th>#</th><th>Player</th>${rounds.map((r) => `<th>R${r.round}</th>`).join("")}<th>Total</th><th>Rounds</th></tr>`;
  const rows = order
    .map((s, i) => {
      const cells = rounds.map((r) => `<td class="${r.winner === s ? "is-won" : ""}">${r.scores[s - 1]}</td>`).join("");
      return `<tr class="${s === me ? "is-me" : ""}"><td>${i + 1}${i === 0 ? " 🏆" : ""}</td><td class="ranking__name"></td>${cells}<td><b>${totals[s - 1]}</b></td><td>${wins[s - 1]}</td></tr>`;
    })
    .join("");
  return `<thead>${head}</thead><tbody>${rows}</tbody>`;
}

function fillNames(order: Slot[]): void {
  const cells = $("rankingTable").querySelectorAll<HTMLElement>(".ranking__name");
  cells.forEach((c, i) => (c.textContent = names[order[i]! - 1] + (order[i] === me ? " (you)" : "")));
}

function showRoundResult(result: RoundResult, wins: [number, number], nextAt: number | null): void {
  const won = result.winner === me;
  $("resultTitle").textContent = result.winner === 0 ? "Round tied" : won ? "Round won!" : "Round lost";
  $("resultText").textContent = `${names[0]} ${result.scores[0]} × ${result.scores[1]} ${names[1]} · rounds ${wins[0]}–${wins[1]}`;
  const totals: [number, number] = [result.scores[0], result.scores[1]];
  $("rankingTable").innerHTML = rankingTable([result], totals, wins);
  fillNames(wins[0] === wins[1] ? (totals[0] >= totals[1] ? [1, 2] : [2, 1]) : wins[0] > wins[1] ? [1, 2] : [2, 1]);
  $("againBtn").hidden = true;
  $("shareBtn").hidden = true;
  const cd = $("resultCountdown");
  cd.hidden = false;
  showPanel("result");
  if (nextAt) {
    const step = (): void => {
      const left = Math.max(0, Math.ceil((nextAt - Date.now()) / 1000));
      cd.textContent = `Next round in ${left}s`;
      if (left > 0 && phase === "intermission") setTimeout(step, 250);
    };
    step();
  } else {
    cd.textContent = "Final results in a moment…";
  }
  lawn.cat(won ? me : me === 1 ? 2 : 1, "catch", 1500);
  if (!won && result.winner !== 0) lawn.cat(me, "angry", 1500);
}

function showFinal(winner: Slot | 0, wins: [number, number], rounds: RoundResult[], totals: [number, number], forfeit: boolean): void {
  const won = winner === me;
  $("resultTitle").textContent = winner === 0 ? "It's a draw" : won ? "You win the match!" : "You lose the match";
  $("resultText").textContent = forfeit
    ? won ? "Your rival left the lawn. Victory by forfeit." : "You left the lawn, so the round went to your rival."
    : `Best of three · rounds ${wins[0]}–${wins[1]} · ${totals[0]} × ${totals[1]} points in total.`;
  $("rankingTable").innerHTML = rankingTable(rounds, totals, wins);
  fillNames(wins[0] === wins[1] ? (totals[0] >= totals[1] ? [1, 2] : [2, 1]) : wins[0] > wins[1] ? [1, 2] : [2, 1]);
  if (won && !forfeit) earn("duelist");
  // every mouse you caught in the match goes to your wallet, like in solo (10 points a mouse)
  const caught = totals[me - 1];
  if (caught > 0) {
    earnPoints(caught * 10, "duel");
    setTimeout(() => toast(`+${caught * 10} pts for the shop`, "seal"), 600);
  }
  $("againBtn").hidden = false;
  $("shareBtn").hidden = !("share" in navigator || "clipboard" in navigator);
  $("resultCountdown").hidden = true;
  const rival = names[me === 1 ? 1 : 0];
  lastShareText = won
    ? `🏆 My cat beat ${rival} ${wins[me - 1]}–${wins[me === 1 ? 1 : 0]} in a Cat The Mouse Company duel (${totals[me - 1]} mice caught). Think your cat is faster? 🐭`
    : `😼 ${rival} out-hunted me in Cat The Mouse Company 1v1. I want a rematch. Who's next? 🐭`;
  showPanel("result");
  if (winner === 0) {
    lawn.cat(1, "idle");
    lawn.cat(2, "idle");
  } else {
    lawn.cat(winner, "catch", 4000);
    lawn.cat(winner === 1 ? 2 : 1, "angry", 4000);
  }
  ws?.close();
  ws = null;
}

// ---- sound / misc -----------------------------------------------------------

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
window.addEventListener("beforeunload", () => ws?.close());

// come straight back when the network or the tab does, instead of waiting for the next retry
function retryNow(): void {
  if (lostAt && matchLive()) openSocket();
}
window.addEventListener("online", retryNow);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) music.stop();
  else {
    if (phase === "round") music.start();
    retryNow();
  }
});

// keepalive so idle rooms are not dropped by proxies while waiting for a rival
setInterval(() => {
  if (ws && ws.readyState === WebSocket.OPEN && phase === "waiting") ws.send('{"type":"ping"}');
  if (queueWs && queueWs.readyState === WebSocket.OPEN) queueWs.send('{"type":"ping"}');
}, 25_000);

// heartbeat during a match: a dead connection often never fires "close" (Wi-Fi switch, sleep),
// so silence from the room for too long counts as a drop
setInterval(() => {
  if (!ws || ws.readyState !== WebSocket.OPEN || phase === "waiting" || !matchLive()) return;
  if (Date.now() - lastHeard > 10_000) {
    const dead = ws;
    ws = null;
    dead.close();
    reconnect();
  } else {
    ws.send('{"type":"ping"}');
  }
}, 3_000);

// deep link: /play?room=CODE
const roomParam = new URLSearchParams(location.search).get("room");
if (roomParam && /^[A-Za-z0-9]{4,8}$/.test(roomParam)) {
  codeInput.value = roomParam.toUpperCase();
  if (nameInput.value) connect(roomParam, myName());
  else {
    showPanel("lobby");
    nameInput.focus();
  }
} else {
  showPanel("lobby");
}
void loadLeaderboard();
// same account as solo, so 1v1 events carry the player's id too
void import("./account").then((a) => a.initAccount()).catch(() => undefined);
