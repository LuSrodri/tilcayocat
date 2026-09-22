// Challenge links (https://tilcayo.cat/?beat=42) unfurl as a personal dare: the static page is
// served as usual, and only its social tags are rewritten to name the score and show the
// sharer's rank card from /og/beat-<rank>.jpg.
import { rankFor } from "../src/rank";

interface Ctx {
  request: Request;
  next(): Promise<Response>;
}

declare class HTMLRewriter {
  on(selector: string, handlers: { element(el: { setAttribute(name: string, value: string): void }): void }): HTMLRewriter;
  transform(res: Response): Response;
}

export const onRequestGet = async ({ request, next }: Ctx): Promise<Response> => {
  const res = await next();
  const raw = new URL(request.url).searchParams.get("beat");
  const beat = raw ? Number.parseInt(raw, 10) : NaN;
  if (!Number.isFinite(beat) || beat <= 0 || beat >= 10000) return res;
  if (!res.headers.get("content-type")?.includes("text/html")) return res;

  const rank = rankFor(beat);
  const title = `Can you beat ${beat} ${beat === 1 ? "mouse" : "mice"}? 🐆 Tilcayo Cat Game`;
  const description = `A friend caught ${beat} mice as the tilcayo cat and reached ${rank.name}. Tap to accept the challenge — free, no install.`;
  const image = `https://tilcayo.cat/og/beat-${rank.id}.jpg`;
  const url = `https://tilcayo.cat/?beat=${beat}`;

  const set = (value: string) => ({ element: (el: { setAttribute(n: string, v: string): void }) => el.setAttribute("content", value) });
  const out = new HTMLRewriter()
    .on('meta[property="og:title"], meta[name="twitter:title"]', set(title))
    .on('meta[property="og:description"], meta[name="twitter:description"], meta[name="description"]', set(description))
    .on('meta[property="og:image"], meta[property="og:image:secure_url"], meta[name="twitter:image"]', set(image))
    .on('meta[property="og:url"]', set(url))
    .on('meta[property="og:image:alt"], meta[name="twitter:image:alt"]', set(`Challenge card: can you beat ${beat} mice? Rank ${rank.name}`))
    .transform(res);
  const headers = new Headers(out.headers);
  headers.set("Cache-Control", "public, max-age=300");
  return new Response(out.body, { status: out.status, headers });
};
