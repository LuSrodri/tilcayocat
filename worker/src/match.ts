import { DurableObject } from "cloudflare:workers";
import {
  COUNTDOWN_MS, GRID, INTERMISSION_MS, MAX_ROUNDS, ROUNDS_TO_WIN, ROUND_MS,
  type ClientMessage, type MouseInfo, type PlayerInfo, type RoundResult, type ServerMessage, type Slot
} from "./protocol";
import type { Env } from "./index";

type Phase = "waiting" | "countdown" | "round" | "intermission" | "final";

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
// (first tap wins) and keeps the score. Two players share the same 5×5 lawn for 60-second
// rounds, best of three. In-memory state only matters during a round, when timers keep the
// object awake; everything needed to resume after hibernation lives in storage/attachments.
export class MatchRoom extends DurableObject<Env> {
  private state: Persisted = { code: "", phase: "waiting", round: 0, wins: [0, 0], rounds: [], names: ["", ""] };
  private loaded = false;
  private scores: [number, number] = [0, 0];
  private mice = new Map<number, MouseInfo>();
  private byHole = new Map<number, number>();
  private nextMouseId = 1;
  private roundStart = 0;
  private roundEnd = 0;
  private loop: ReturnType<typeof setInterval> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private nextSpawnAt = 0;

  private async load(): Promise<void> {
    if (this.loaded) return;
    const saved = await this.ctx.storage.get<Persisted>("state");
    if (saved) this.state = saved;
    this.loaded = true;
  }

  private async save(): Promise<void> {
    await this.ctx.storage.put("state", this.state);
  }

  async fetch(request: Request): Promise<Response> {
    await this.load();
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
    await this.load();
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
    await this.load();
    ws.close(code, reason);
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
    for (const m of this.mice.values()) {
      if (now >= m.expiresAt) {
        this.mice.delete(m.id);
        this.byHole.delete(m.hole);
        this.broadcast({ type: "hide", id: m.id });
      }
    }
    if (now >= this.nextSpawnAt) {
      const p = this.pace(now);
      if (this.mice.size < p.simultaneous) this.spawn(now, p.upTime);
      this.nextSpawnAt = now + p.gap * (0.7 + Math.random() * 0.6);
    }
  }

  private spawn(now: number, upTime: number): void {
    const free: number[] = [];
    for (let h = 0; h < GRID * GRID; h++) if (!this.byHole.has(h)) free.push(h);
    if (!free.length) return;
    const hole = free[Math.floor(Math.random() * free.length)]!;
    const mouse: MouseInfo = { id: this.nextMouseId++, hole, expiresAt: now + upTime * (0.8 + Math.random() * 0.4) };
    this.mice.set(mouse.id, mouse);
    this.byHole.set(hole, mouse.id);
    this.broadcast({ type: "spawn", mouse, now });
  }

  private tap(slot: Slot, hole: number): void {
    if (this.state.phase !== "round") return;
    if (!Number.isInteger(hole) || hole < 0 || hole >= GRID * GRID) return;
    const id = this.byHole.get(hole);
    if (id === undefined) {
      this.broadcast({ type: "whiff", hole, by: slot });
      return;
    }
    this.mice.delete(id);
    this.byHole.delete(hole);
    this.scores[slot - 1] += 1;
    this.broadcast({ type: "catch", id, hole, by: slot, scores: this.scores });
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

function send(ws: WebSocket, msg: ServerMessage): void {
  try {
    ws.send(JSON.stringify(msg));
  } catch {
    /* ignore */
  }
}
