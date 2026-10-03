// Google Analytics 4 events. The gtag snippet sits in every page's <head>; when it is blocked
// (ad blockers, CSP, offline) these calls simply do nothing.

const GA_ID = "G-F66DVGWFBE";

type Gtag = (...args: unknown[]) => void;

function gtag(...args: unknown[]): void {
  const g = (window as unknown as { gtag?: Gtag }).gtag;
  if (typeof g === "function") g(...args);
}

export function track(event: string, params: Record<string, unknown> = {}): void {
  gtag("event", event, params);
}

/** Tie every later event to the player's account id (the Supabase user id), anonymous or not. */
export function setUserId(id: string | null): void {
  gtag("config", GA_ID, { user_id: id ?? undefined, send_page_view: false });
}
