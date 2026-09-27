import { DurableObject } from "cloudflare:workers";
import {
  COUNTDOWN_MS, GRID, INTERMISSION_MS, MAX_ROUNDS, ROUNDS_TO_WIN, ROUND_MS,
  PORCUPINE_LICK_MS, SNAKE_LICK_MS, FANCY_EVERY, FANCY_POINTS, FANCY_KINDS, neighbours,
  type ClientMessage, type Critter, type MouseInfo, type PlayerInfo, type RoundResult, type ServerMessage, type Slot
} from "./protocol";
import type { Env } from "./index";

type Phase = "waiting" | "countdown" | "round" | "intermission" | "final";

// Server-side bookkeeping on top of what clients see.
interface Live extends MouseInfo {
  upAt: number;
  hopsLeft: number;
  nextBiteAt: number;
}

interface Attachment {
  slot: Slot;
  name: string;
}

interface Persisted {
  code: string;
  phase: Phase;
  round: number;
  wins: [number, number];
  rounds: RoundResult[];
  names: [string, string];
}

// One MatchRoom per room code. The room is authoritative: it spawns the mice, resolves taps
// (first tap wins) and keeps the score. Porcupines and snakes make the slapping cat sit out
// licking its paw; snakes also eat mice next to them; every 10th mouse calls out a fancy one. Two players share the same 5×5 lawn for 60-second
// rounds, best of three. In-memory state only matters during a round, when timers keep the
// object awake; everything needed to resume after hibernation lives in storage/attachments.
export class MatchRoom extends DurableObject<Env> {
  private state: Persisted = { code: "", phase: "waiting", round: 0, wins: [0, 0], rounds: [], names: ["", ""] };

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Restore the match record before any event is delivered (also runs after hibernation).
    ctx.blockConcurrencyWhile(async () => {
      const saved = await ctx.storage.get<Persisted>("state");
      if (saved) this.state = saved;
    });
  }
  private scores: [number, number] = [0, 0];
  private mice = new Map<number, Live>();
  private lickUntil: [number, number] = [0, 0];
  private plainCaught = 0;
  private nextSnakeAt = 0;
  private byHole = new Map<number, number>();
  private nextMouseId = 1;
  private roundStart = 0;
  private roundEnd = 0;
  private loop: ReturnType<typeof setInterval> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private nextSpawnAt = 0;
  private nextFoeAt = 0;

  private async save(): Promise<void> {
    await this.ctx.storage.put("state", this.state);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.headers.get("Upgrade") !== "websocket") return new Response("Expected WebSocket", { status: 426 });

    const code = url.searchParams.get("code") ?? "";
    const name = url.searchParams.get("name") ?? "Tilcayo";
    if (!this.state.code) {
      this.state.code = code;
      await this.save();
    }

    const taken = new Set(this.sockets().map((s) => s.att.slot));
    const slot: Slot | null = !taken.has(1) ? 1 : !taken.has(2) ? 2 : null;
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    if (slot === null || this.state.phase === "final") {
      this.ctx.acceptWebSocket(server);
      send(server, { type: "full" });
      server.close(1008, "room full");
      return new Response(null, { status: 101, webSocket: client });
    }

    const att: Attachment = { slot, name };
    this.ctx.acceptWebSocket(server, [`p${slot}`]);
    server.serializeAttachment(att);
    this.state.names[slot - 1] = name;
    await this.save();

    send(server, { type: "welcome", you: slot, code: this.state.code, players: this.players(), now: Date.now() });
    this.broadcast({ type: "players", players: this.players() });

    if (this.state.phase === "waiting" && this.sockets().length === 2) this.startCountdown();
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    if (typeof raw !== "string") return;
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw) as ClientMessage;
    } catch {
      return;
    }
    const att = ws.deserializeAttachment() as Attachment | null;
    if (!att) return;
    if (msg.type === "ping") {
      ws.send(JSON.stringify({ type: "pong", now: Date.now() }));
      return;
    }
    if (msg.type === "tap") this.tap(att.slot, msg.hole);
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    close(ws, code, reason);
    const att = ws.deserializeAttachment() as Attachment | null;
    if (!att) return;
    this.broadcast({ type: "players", players: this.players() });
    if (this.state.phase === "round" || this.state.phase === "countdown" || this.state.phase === "intermission") {
      // the remaining player wins by forfeit
      const other: Slot = att.slot === 1 ? 2 : 1;
      await this.finish(other, true);
    } else if (this.state.phase === "waiting" && this.sockets().length === 0) {
      await this.ctx.storage.deleteAll();
    }
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.webSocketClose(ws, 1011, "error");
  }

  // ---- lifecycle -------------------------------------------------------------

  private startCountdown(): void {
    this.state.phase = "countdown";
    this.state.round += 1;
    void this.save();
    const startsAt = Date.now() + COUNTDOWN_MS;
    this.broadcast({ type: "countdown", round: this.state.round, startsAt, now: Date.now() });
    this.after(COUNTDOWN_MS, () => this.startRound());
  }

  private startRound(): void {
    this.state.phase = "round";
    void this.save();
    this.scores = [0, 0];
    this.mice.clear();
    this.byHole.clear();
    this.roundStart = Date.now();
    this.roundEnd = this.roundStart + ROUND_MS;
    this.nextSpawnAt = this.roundStart + 400;
    this.nextFoeAt = this.roundStart + 6000 + Math.random() * 5000;
    this.nextSnakeAt = this.roundStart + 14000 + Math.random() * 6000;
    this.lickUntil = [0, 0];
    this.plainCaught = 0;
    this.broadcast({
      type: "round", round: this.state.round, startsAt: this.roundStart, endsAt: this.roundEnd,
      now: Date.now(), scores: this.scores, wins: this.state.wins
    });
    if (this.loop) clearInterval(this.loop);
    this.loop = setInterval(() => this.tick(), 50);
  }

  // Pace: starts at the solo game's 5×5 pace and speeds up ~35% over the round.
  private pace(now: number): { upTime: number; gap: number; simultaneous: number } {
    const t = Math.min(1, (now - this.roundStart) / ROUND_MS);
    const speed = 1.21 * (1 + 0.35 * t);
    return { upTime: 1600 / speed, gap: 800 / speed, simultaneous: t < 0.5 ? 3 : 4 };
  }

  private tick(): void {
    const now = Date.now();
    if (this.state.phase !== "round") return;
    if (now >= this.roundEnd) {
      this.endRound();
      return;
    }
    for (const m of [...this.mice.values()]) {
      if (m.kind === "snake" && now >= m.nextBiteAt) this.snakeBite(m, now);
      if (now < m.expiresAt || !this.mice.has(m.id)) continue;
      if (m.kind === "fancy" && m.hopsLeft > 0 && this.hop(m, now)) continue;
      this.remove(m);
      this.broadcast({ type: "hide", id: m.id });
    }
    if (now >= this.nextSpawnAt) {
      const p = this.pace(now);
      const upMice = [...this.mice.values()].filter((m) => m.kind === "mouse").length;
      if (upMice < p.simultaneous) this.spawn(now, p.upTime, "mouse");
      this.nextSpawnAt = now + p.gap * (0.7 + Math.random() * 0.6);
    }
    if (now >= this.nextFoeAt) {
      if (![...this.mice.values()].some((m) => m.kind === "porcupine")) this.spawn(now, 2200, "porcupine");
      this.nextFoeAt = now + 8000 + Math.random() * 6000;
    }
    if (now >= this.nextSnakeAt) {
      if (![...this.mice.values()].some((m) => m.kind === "snake")) this.spawn(now, 4800, "snake");
      this.nextSnakeAt = now + 14000 + Math.random() * 6000;
    }
  }

  private freeHoles(except = -1): number[] {
    const free: number[] = [];
    for (let h = 0; h < GRID * GRID; h++) if (!this.byHole.has(h) && h !== except) free.push(h);
    return free;
  }

  private spawn(now: number, upTime: number, kind: Critter): void {
    const free = this.freeHoles();
    if (!free.length) return;
    const hole = free[Math.floor(Math.random() * free.length)]!;
    const jitter = kind === "mouse" ? 0.8 + Math.random() * 0.4 : 1;
    const mouse: Live = {
      id: this.nextMouseId++, hole, kind, expiresAt: now + upTime * jitter, upAt: now,
      hopsLeft: kind === "fancy" ? 4 + Math.floor(Math.random() * 3) : 0, nextBiteAt: now + 650
    };
    if (kind === "fancy") mouse.variant = dailyVariant();
    this.mice.set(mouse.id, mouse);
    this.byHole.set(hole, mouse.id);
    const { id, expiresAt, variant } = mouse;
    this.broadcast({ type: "spawn", mouse: { id, hole, kind, expiresAt, variant }, now });
  }

  private remove(m: Live): void {
    this.mice.delete(m.id);
    if (this.byHole.get(m.hole) === m.id) this.byHole.delete(m.hole);
  }

  // The fancy mouse leaps to another free hole a few times before it runs off.
  private hop(m: Live, now: number): boolean {
    const free = this.freeHoles(m.hole);
    if (!free.length) return false;
    const to = free[Math.floor(Math.random() * free.length)]!;
    const from = m.hole;
    this.byHole.delete(from);
    m.hole = to;
    m.hopsLeft -= 1;
    m.upAt = now + 300;
    m.expiresAt = now + 300 + 800;
    this.byHole.set(to, m.id);
    this.broadcast({ type: "hop", id: m.id, from, to, expiresAt: m.expiresAt });
    return true;
  }

  // The snake gulps a mouse standing right next to it (after a short grace to race it).
  private snakeBite(snake: Live, now: number): void {
    for (const n of neighbours(snake.hole)) {
      const id = this.byHole.get(n);
      const v = id === undefined ? undefined : this.mice.get(id);
      if (!v || (v.kind !== "mouse" && v.kind !== "fancy") || now - v.upAt < 380) continue;
      this.remove(v);
      snake.nextBiteAt = now + 700;
      this.broadcast({ type: "eaten", id: v.id, hole: v.hole, snakeHole: snake.hole });
      return;
    }
  }

  private tap(slot: Slot, hole: number): void {
    if (this.state.phase !== "round") return;
    if (!Number.isInteger(hole) || hole < 0 || hole >= GRID * GRID) return;
    const now = Date.now();
    // a cat licking its paw can't hunt
    if (now < this.lickUntil[slot - 1]) return;
    const id = this.byHole.get(hole);
    if (id === undefined) {
      this.broadcast({ type: "whiff", hole, by: slot });
      return;
    }
    const critter = this.mice.get(id)!;
    if (critter.kind === "porcupine" || critter.kind === "snake") {
      // the critter stays; the player sits out
      const ms = critter.kind === "snake" ? SNAKE_LICK_MS : PORCUPINE_LICK_MS;
      this.lickUntil[slot - 1] = now + ms;
      this.broadcast({ type: "ouch", id, hole, by: slot, kind: critter.kind, ms });
      return;
    }
    this.remove(critter);
    const gain = critter.kind === "fancy" ? FANCY_POINTS : 1;
    this.scores[slot - 1] += gain;
    this.broadcast({ type: "catch", id, hole, by: slot, scores: this.scores, gain });
    if (critter.kind === "mouse" && ++this.plainCaught % FANCY_EVERY === 0 && ![...this.mice.values()].some((m) => m.kind === "fancy")) {
      this.spawn(now, 1050, "fancy");
    }
  }

  private endRound(): void {
    if (this.loop) clearInterval(this.loop);
    this.loop = null;
    this.mice.clear();
    this.byHole.clear();
    const [a, b] = this.scores;
    const winner: Slot | 0 = a === b ? 0 : a > b ? 1 : 2;
    const result: RoundResult = { round: this.state.round, scores: [a, b], winner };
    this.state.rounds.push(result);
    if (winner) this.state.wins[winner - 1] += 1;

    const decided = this.state.wins[0] >= ROUNDS_TO_WIN || this.state.wins[1] >= ROUNDS_TO_WIN || this.state.round >= MAX_ROUNDS;
    if (decided) {
      const [w1, w2] = this.state.wins;
      let champion: Slot | 0 = w1 === w2 ? 0 : w1 > w2 ? 1 : 2;
      if (champion === 0) {
        const t1 = this.state.rounds.reduce((s, r) => s + r.scores[0], 0);
        const t2 = this.state.rounds.reduce((s, r) => s + r.scores[1], 0);
        champion = t1 === t2 ? 0 : t1 > t2 ? 1 : 2;
      }
      this.state.phase = "intermission";
      void this.save();
      this.broadcast({ type: "roundEnd", result, wins: this.state.wins, nextAt: null, now: Date.now() });
      this.after(INTERMISSION_MS, () => void this.finish(champion, false));
      return;
    }
    this.state.phase = "intermission";
    void this.save();
    const nextAt = Date.now() + INTERMISSION_MS;
    this.broadcast({ type: "roundEnd", result, wins: this.state.wins, nextAt, now: Date.now() });
    this.after(INTERMISSION_MS, () => this.startCountdown());
  }

  private async finish(winner: Slot | 0, forfeit: boolean): Promise<void> {
    if (this.state.phase === "final") return;
    if (this.loop) clearInterval(this.loop);
    this.loop = null;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.state.phase = "final";
    const totals: [number, number] = [
      this.state.rounds.reduce((s, r) => s + r.scores[0], 0),
      this.state.rounds.reduce((s, r) => s + r.scores[1], 0)
    ];
    await this.save();
    this.broadcast({ type: "final", winner, wins: this.state.wins, rounds: this.state.rounds, totals, forfeit });

    const [n1, n2] = this.state.names;
    if (n1 && n2 && this.state.rounds.length > 0) {
      try {
        await this.env.LOBBY.getByName("lobby").recordResult(
          winner === 1 ? n1 : winner === 2 ? n2 : null,
          winner === 1 ? n2 : winner === 2 ? n1 : null,
          winner === 0 ? [n1, n2] : []
        );
      } catch (err) {
        console.error("leaderboard update failed", err);
      }
    }
    // Let clients read the result, then tear the room down so the code can be reused.
    this.after(30_000, () => {
      for (const s of this.ctx.getWebSockets()) s.close(1000, "match over");
      void this.ctx.storage.deleteAll();
    });
  }

  // ---- helpers ---------------------------------------------------------------

  private after(ms: number, fn: () => void): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(fn, ms);
  }

  private sockets(): { ws: WebSocket; att: Attachment }[] {
    const out: { ws: WebSocket; att: Attachment }[] = [];
    for (const ws of this.ctx.getWebSockets()) {
      const att = ws.deserializeAttachment() as Attachment | null;
      if (att && ws.readyState === WebSocket.OPEN) out.push({ ws, att });
    }
    return out;
  }

  private players(): PlayerInfo[] {
    const live = this.sockets();
    const out: PlayerInfo[] = [];
    for (const slot of [1, 2] as Slot[]) {
      const s = live.find((x) => x.att.slot === slot);
      const name = s?.att.name ?? this.state.names[slot - 1];
      if (name) out.push({ slot, name, connected: !!s });
    }
    return out;
  }

  private broadcast(msg: ServerMessage): void {
    const data = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets()) {
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(data);
        } catch {
          /* closed mid-send */
        }
      }
    }
  }
}

// Today's mouse of the day (UTC calendar; day #1 is launch day, 2026-09-17), same list as the site.
function dailyVariant(): number {
  const day = Math.floor((Date.now() - Date.UTC(2026, 8, 17)) / 86_400_000);
  return ((day % FANCY_KINDS) + FANCY_KINDS) % FANCY_KINDS;
}

// 1005/1006 are reserved: echoing them back throws and would skip whatever follows the call.
function close(ws: WebSocket, code: number, reason: string): void {
  try {
    ws.close(code >= 1000 && code !== 1005 && code !== 1006 ? code : 1000, reason);
  } catch {
    /* already closed */
  }
}

function send(ws: WebSocket, msg: ServerMessage): void {
  try {
    ws.send(JSON.stringify(msg));
  } catch {
    /* ignore */
  }
}
