// Where the multiplayer Worker lives: same origin in production, `wrangler dev` on localhost.
const LOCAL = location.hostname === "localhost" || location.hostname === "127.0.0.1";

export const API = LOCAL ? "http://localhost:8787/mp" : "/mp";

export const WS_BASE = API.startsWith("http")
  ? API.replace(/^http/, "ws")
  : `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}${API}`;
