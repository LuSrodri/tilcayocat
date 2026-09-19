import { MatchRoom } from "./match";
import { Lobby } from "./lobby";
import { cleanName } from "./protocol";

export { MatchRoom, Lobby };

export interface Env {
  MATCH: DurableObjectNamespace<MatchRoom>;
  LOBBY: DurableObjectNamespace<Lobby>;
}

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function makeCode(): string {
  const bytes = new Uint8Array(5);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", ...CORS } });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/mp/, "") || "/";

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

    if (path === "/create") return json({ code: makeCode() });

    if (path === "/leaderboard") {
      const rows = await env.LOBBY.getByName("lobby").top(10);
      return json({ players: rows });
    }

    if (path === "/quick") {
      if (request.headers.get("Upgrade") !== "websocket") return new Response("Expected WebSocket", { status: 426 });
      return env.LOBBY.getByName("lobby").fetch(request);
    }

    const m = /^\/ws\/([A-Z0-9]{4,8})$/i.exec(path);
    if (m) {
      if (request.headers.get("Upgrade") !== "websocket") return new Response("Expected WebSocket", { status: 426 });
      const code = m[1]!.toUpperCase();
      const target = new URL(request.url);
      target.searchParams.set("code", code);
      target.searchParams.set("name", cleanName(url.searchParams.get("name")));
      return env.MATCH.getByName(code).fetch(new Request(target.toString(), request));
    }

    return json({ error: "not found" }, 404);
  }
} satisfies ExportedHandler<Env>;
