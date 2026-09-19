import "./style.css";
import { createHoleEl, burst } from "./holes";
import { sfx, music, volume } from "./sound";
import type { PlayerInfo, RoundResult, ServerMessage, Slot } from "../worker/src/protocol";
import { GRID, ROUND_MS } from "../worker/src/protocol";

// The 1v1 arena is server-driven: the MatchRoom Durable Object spawns the mice and resolves
// every tap; this file only renders what the room says and sends taps.

const API = location.hostname === "localhost" || location.hostname === "127.0.0.1" ? "http://localhost:8787/mp" : "/mp";
const WS_BASE = API.startsWith("http") ? API.replace(/^http/, "ws") : `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}${API}`;
const NAME_KEY = "tilcayo.name";

function $<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el as T;
}

const holesEl = $("holes");
const field = $("field");
const overlay = $("overlay");
const panels = { lobby: $("panelLobby"), wait: $("panelWait"), result: $("panelResult") };
const nameInput = $<HTMLInputElement>("nameInput");
const codeInput = $<HTMLInputElement>("codeInput");
const lobbyError = $("lobbyError");
const countdownEl = $("countdown");
const cats: Record<Slot, HTMLElement> = { 1: $("cat1"), 2: $("cat2") };

const holes: HTMLButtonElement[] = [];
for (let i = 0; i < GRID * GRID; i++) {
  const el = createHoleEl(i);
  el.dataset.what = "mouse";
  el.addEventListener("pointerdown", (ev) => {
    ev.preventDefault();
    sfx.unlock();
    if (ws && ws.readyState === WebSocket.OPEN && phase === "round") ws.send(JSON.stringify({ type: "tap", hole: i }));
  });
  holes.push(el);
  holesEl.append(el);
}

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
const catTimers: Record<Slot, number> = { 1: 0, 2: 0 };
const mouseHole = new Map<number, number>();

// ---- lobby ------------------------------------------------------------------

try {
  nameInput.value = localStorage.getItem(NAME_KEY) ?? "";
} catch {
  /* ignore */
}

function myName(): string {
  const n = nameInput.value.trim().slice(0, 14) || "Tilcayo";
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
}

function hideOverlay(): void {
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
  ws?.close();
  ws = null;
  phase = "idle";
  history.replaceState(null, "", "/play");
  showPanel("lobby");
});

$("copyBtn").addEventListener("click", async () => {
  const url = `${location.origin}/play?room=${code}`;
  try {
    if (navigator.share) await navigator.share({ title: "Tilcayo Cat 1v1", text: "Catch more mice than me!", url });
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
    if (navigator.share) await navigator.share({ title: "Tilcayo Cat 1v1", text, url: "https://tilcayo.cat/play" });
    else await navigator.clipboard.writeText(`${text} https://tilcayo.cat/play`);
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

function connect(roomCode: string, name: string): void {
  ws?.close();
  code = roomCode.toUpperCase();
  history.replaceState(null, "", `/play?room=${code}`);
  $("waitText").textContent = "Share this code or link with a friend.";
  $("codeBox").hidden = false;
  $("codeText").textContent = code;
  showPanel("wait");
  phase = "waiting";
  lobbyError.hidden = true;

  ws = new WebSocket(`${WS_BASE}/ws/${code}?name=${encodeURIComponent(name)}`);
  ws.onmessage = (ev) => handle(JSON.parse(ev.data) as ServerMessage);
  ws.onerror = () => fail("Connection failed. Check the code and try again.");
  ws.onclose = (ev) => {
    if (phase === "final" || phase === "idle") return;
    if (ev.code === 1008) return; // "full" was already handled
    fail("Connection lost.");
    phase = "idle";
  };
}

function handle(msg: ServerMessage): void {
  switch (msg.type) {
    case "full":
      fail("That room is already full.");
      phase = "idle";
      break;
    case "welcome":
      me = msg.you;
      clockOffset = msg.now - Date.now();
      applyPlayers(msg.players);
      break;
    case "players":
      applyPlayers(msg.players);
      break;
    case "countdown": {
      phase = "countdown";
      clockOffset = msg.now - Date.now();
      resetArena();
      $("hudRound").textContent = String(msg.round);
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
      setScores(msg.scores);
      setWins(msg.wins);
      $("hudRound").textContent = String(msg.round);
      music.start();
      startClock();
      break;
    }
    case "spawn": {
      mouseHole.set(msg.mouse.id, msg.mouse.hole);
      const el = holes[msg.mouse.hole]!;
      el.classList.add("is-up");
      sfx.squeak();
      break;
    }
    case "hide": {
      const h = mouseHole.get(msg.id);
      mouseHole.delete(msg.id);
      if (h !== undefined) holes[h]!.classList.remove("is-up");
      break;
    }
    case "catch": {
      mouseHole.delete(msg.id);
      const el = holes[msg.hole]!;
      el.classList.remove("is-up");
      el.dataset.by = String(msg.by);
      burst(el, "is-caught", "+1", 550);
      setScores(msg.scores);
      catState(msg.by, "catch", 800);
      if (msg.by === me) {
        sfx.catch();
        if (navigator.vibrate) navigator.vibrate(12);
      } else {
        sfx.miss();
      }
      break;
    }
    case "whiff": {
      const el = holes[msg.hole]!;
      el.dataset.by = String(msg.by);
      burst(el, "is-whiff", "miss", 420);
      catState(msg.by, "angry", 420);
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
    $(`tagName${p.slot}`).textContent = p.name;
    cats[p.slot].classList.toggle("is-absent", !p.connected);
  }
  if (players.length < 2) {
    const other: Slot = me === 1 ? 2 : 1;
    $(`hudName${other}`).textContent = "…";
    $(`tagName${other}`).textContent = "…";
    cats[other].classList.add("is-absent");
  }
  document.body.dataset.me = String(me);
}

// ---- arena rendering --------------------------------------------------------

function resetArena(): void {
  clearMice();
  setScores([0, 0]);
  $("hudClock").textContent = String(ROUND_MS / 1000);
  for (const s of [1, 2] as Slot[]) {
    cats[s].dataset.state = "idle";
    cats[s].classList.remove("is-sad");
  }
}

function clearMice(): void {
  mouseHole.clear();
  for (const el of holes) el.classList.remove("is-up");
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

function catState(slot: Slot, state: "catch" | "angry" | "idle", ms: number): void {
  const el = cats[slot];
  window.clearTimeout(catTimers[slot]);
  el.dataset.state = state;
  if (state === "catch") {
    el.classList.remove("is-pounce");
    void el.offsetWidth;
    el.classList.add("is-pounce");
  }
  catTimers[slot] = window.setTimeout(() => (el.dataset.state = "idle"), ms);
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
    field.dataset.zone = left < 10_000 ? "danger" : left < 20_000 ? "warn" : "ok";
  };
  step();
  clockTimer = window.setInterval(step, 200);
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
  catState(won ? me : me === 1 ? 2 : 1, "catch", 1500);
  if (!won && result.winner !== 0) catState(me, "angry", 1500);
}

function showFinal(winner: Slot | 0, wins: [number, number], rounds: RoundResult[], totals: [number, number], forfeit: boolean): void {
  const won = winner === me;
  $("resultTitle").textContent = winner === 0 ? "It's a draw" : won ? "You win the match!" : "You lose the match";
  $("resultText").textContent = forfeit
    ? won ? "Your rival left the lawn. Victory by forfeit." : "You left the lawn, so the round went to your rival."
    : `Best of three · rounds ${wins[0]}–${wins[1]} · ${totals[0]} × ${totals[1]} mice in total.`;
  $("rankingTable").innerHTML = rankingTable(rounds, totals, wins);
  fillNames(wins[0] === wins[1] ? (totals[0] >= totals[1] ? [1, 2] : [2, 1]) : wins[0] > wins[1] ? [1, 2] : [2, 1]);
  $("againBtn").hidden = false;
  $("shareBtn").hidden = !("share" in navigator || "clipboard" in navigator);
  $("resultCountdown").hidden = true;
  lastShareText = won
    ? `I beat ${names[me === 1 ? 1 : 0]} ${wins[me - 1]}–${wins[me === 1 ? 1 : 0]} in Tilcayo Cat 1v1 🐱🐭`
    : `I lost to ${names[me === 1 ? 1 : 0]} in Tilcayo Cat 1v1 — rematch? 🐱🐭`;
  showPanel("result");
  if (winner === 0) {
    catState(1, "idle", 0);
  } else {
    catState(winner, "catch", 4000);
    catState(winner === 1 ? 2 : 1, "angry", 4000);
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
field.addEventListener("contextmenu", (ev) => ev.preventDefault());
window.addEventListener("beforeunload", () => ws?.close());
document.addEventListener("visibilitychange", () => {
  if (document.hidden) music.stop();
  else if (phase === "round") music.start();
});

// keepalive so idle rooms are not dropped by proxies while waiting for a rival
setInterval(() => {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send('{"type":"ping"}');
  if (queueWs && queueWs.readyState === WebSocket.OPEN) queueWs.send('{"type":"ping"}');
}, 25_000);

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
