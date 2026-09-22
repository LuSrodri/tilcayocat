import { DurableObject } from "cloudflare:workers";
import type { Env } from "./index";
import type { OnlineCount } from "./protocol";

// A single Presence object counts everybody with the game open: each page holds one
// hibernatable WebSocket tagged with the page it sits on ("solo" or "duel"), so the tally is
// just the list of live sockets — nothing to store, nothing to expire. Arrivals and departures
// broadcast the new count to everyone.
export class Presence extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // The runtime answers the keepalive itself, so idle tabs never wake this object.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('{"type":"ping"}', '{"type":"pong"}'));
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") return new Response("Expected WebSocket", { status: 426 });
    const where = new URL(request.url).searchParams.get("where") === "duel" ? "duel" : "solo";
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server, [where]);
    this.broadcast();
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    try {
      ws.close(code, reason);
    } catch {
      /* already gone */
    }
    this.broadcast(ws);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    this.broadcast(ws);
  }

  // Read the tally over RPC, for the plain HTTP endpoint.
  async count(): Promise<OnlineCount> {
    return this.counts();
  }

  private counts(leaving?: WebSocket): OnlineCount {
    let total = 0;
    let duel = 0;
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === leaving || ws.readyState !== WebSocket.OPEN) continue;
      total++;
      if (this.ctx.getTags(ws).includes("duel")) duel++;
    }
    return { total, duel, solo: total - duel };
  }

  private broadcast(leaving?: WebSocket): void {
    const data = JSON.stringify({ type: "online", ...this.counts(leaving) });
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === leaving || ws.readyState !== WebSocket.OPEN) continue;
      try {
        ws.send(data);
      } catch {
        /* closed mid-send */
      }
    }
  }
}
