import { WS_BASE } from "./api";
import type { OnlineCount } from "../worker/src/protocol";

// Live "cats online" ticker. Every page holds one socket into the Presence Durable Object,
// which answers with the current tally whenever anybody arrives or leaves; the pills are any
// elements carrying `data-online`.
const RETRY_MS = [2000, 5000, 15000, 30000];
const BEAT_MS = 25000;

export function mountOnline(where: "solo" | "duel"): void {
  const pills = Array.from(document.querySelectorAll<HTMLElement>("[data-online]"));
  if (!pills.length) return;

  let ws: WebSocket | null = null;
  let attempt = 0;
  let retry = 0;

  const render = (count: OnlineCount | null): void => {
    for (const pill of pills) {
      if (!count) {
        pill.dataset.live = "0";
        continue;
      }
      pill.hidden = false;
      pill.dataset.live = "1";
      const label = count.total === 1 ? "cat online" : "cats online";
      pill.querySelector(".online__text")!.textContent =
        `${count.total} ${label}` + (count.duel ? ` · ${count.duel} in 1v1` : "");
    }
  };

  const schedule = (): void => {
    window.clearTimeout(retry);
    retry = window.setTimeout(open, RETRY_MS[Math.min(attempt++, RETRY_MS.length - 1)]!);
  };

  function open(): void {
    window.clearTimeout(retry);
    try {
      ws = new WebSocket(`${WS_BASE}/presence?where=${where}`);
    } catch {
      schedule();
      return;
    }
    ws.onopen = () => {
      attempt = 0;
    };
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data as string) as { type: string } & OnlineCount;
        if (msg.type === "online") render(msg);
      } catch {
        /* ignore malformed frame */
      }
    };
    ws.onclose = () => {
      ws = null;
      render(null);
      schedule();
    };
    ws.onerror = () => {
      /* onclose follows */
    };
  }

  open();
  // the heartbeat only ever pokes a live socket, so it can keep running across bfcache freezes
  window.setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send('{"type":"ping"}');
  }, BEAT_MS);

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && !ws) {
      attempt = 0;
      open();
    }
  });
  // leaving the page frees the slot right away instead of waiting for the socket to time out
  window.addEventListener("pagehide", () => {
    ws?.close();
    ws = null;
  });
  window.addEventListener("pageshow", () => {
    if (!ws) {
      attempt = 0;
      open();
    }
  });
}
