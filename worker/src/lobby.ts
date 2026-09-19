import { DurableObject } from "cloudflare:workers";
import type { Env } from "./index";
import { makeCode } from "./index";
import type { ServerMessage } from "./protocol";

export interface LeaderRow {
  name: string;
  wins: number;
  losses: number;
  draws: number;
  matches: number;
}

// A single Lobby object: pairs players who ask for a quick match and keeps the global ranking.
export class Lobby extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS players (
          name TEXT PRIMARY KEY,
          wins INTEGER NOT NULL DEFAULT 0,
          losses INTEGER NOT NULL DEFAULT 0,
          draws INTEGER NOT NULL DEFAULT 0,
          updated INTEGER NOT NULL
        )
      `);
    });
  }

  // Quick match: hold the socket until a second player shows up, then hand both a room code.
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") return new Response("Expected WebSocket", { status: 426 });
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server, ["queue"]);
    server.serializeAttachment({ joinedAt: Date.now() });

    const waiting = this.ctx.getWebSockets("queue").filter((ws) => ws !== server && ws.readyState === WebSocket.OPEN);
    if (waiting.length) {
      const other = waiting[0]!;
      const code = makeCode();
      const msg: ServerMessage = { type: "matched", code };
      for (const ws of [other, server]) {
        try {
          ws.send(JSON.stringify(msg));
          ws.close(1000, "matched");
        } catch {
          /* ignore */
        }
      }
    } else {
      server.send(JSON.stringify({ type: "queued" } satisfies ServerMessage));
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    if (raw === '{"type":"ping"}') ws.send(JSON.stringify({ type: "pong", now: Date.now() }));
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    ws.close(code, reason);
  }

  async recordResult(winner: string | null, loser: string | null, drawn: string[]): Promise<void> {
    const now = Date.now();
    const bump = (name: string, col: "wins" | "losses" | "draws") => {
      this.ctx.storage.sql.exec(
        `INSERT INTO players (name, ${col}, updated) VALUES (?, 1, ?)
         ON CONFLICT(name) DO UPDATE SET ${col} = ${col} + 1, updated = excluded.updated`,
        name, now
      );
    };
    if (winner) bump(winner, "wins");
    if (loser) bump(loser, "losses");
    for (const n of drawn) bump(n, "draws");
  }

  async top(limit = 10): Promise<LeaderRow[]> {
    return this.ctx.storage.sql
      .exec<{ name: string; wins: number; losses: number; draws: number }>(
        `SELECT name, wins, losses, draws FROM players ORDER BY wins DESC, losses ASC, updated DESC LIMIT ?`,
        Math.min(50, Math.max(1, limit))
      )
      .toArray()
      .map((r) => ({ ...r, matches: r.wins + r.losses + r.draws }));
  }
}
