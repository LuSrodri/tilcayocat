# Tilcayo Cat Game

A new cat discovered after 100+ years, turned into a game.

A mobile-first browser game at [tilcayo.cat](https://tilcayo.cat). You are a tilcayo cat (*Leopardus tilcayo*, the first new wild cat species described in over a century) sitting on the grass. Tap the mice as they pop out. The lawn starts at 2×2 and grows to 5×5 (10 s, 35 s, 75 s) while the mice speed up 10% at a time (25 s, 60 s, then every 15 s). You start with **5 seconds**; each catch adds **0.8 s** (capped at 5), each empty slap costs **0.3 s**. Power-ups pop up now and then: **Auto-catch** (6 s of automatic paws), **Full time** (clock back to 5 s) and **Freeze** (clock, mice and spawns paused 4 s). When the timer hits zero the round is over.

The ⓘ button opens `/about`, a sourced profile of the real cat with photos and a donation link to Senda Verde.

## Seals

Six wax seals are earned by playing and kept on the device (`localStorage`); the start screen and the 1v1 lobby show the shelf, and earning one pops a toast.

| seal | how to earn it |
| --- | --- |
| Quick Paws | catch 30 mice in one round |
| Night Watch | survive 90 seconds in one round |
| Clean Paws | 20 catches in a round without an empty slap or a porcupine |
| Power Hoarder | collect 6 power-ups |
| No Escape | 12 catches in a row without letting a mouse escape |
| Lawn Duelist | win a 1v1 online match (a rival who walks out does not count) |

`src/seals.ts` holds the definitions, the shelf rendering and the tracker; the solo game feeds it round events (`GameEvent` in `src/game.ts`) and `/play` grants the duel seal.

## Cats online

Every open page holds one WebSocket into a single `Presence` Durable Object (`worker/src/presence.ts`), tagged `solo` or `duel`. The object has nothing to store — the tally is its list of live sockets — and it broadcasts the new count whenever somebody arrives or leaves. `GET /mp/online` returns the same numbers as JSON.

## 1v1 online (`/play`)

Two players share one 5×5 lawn for 60-second rounds, best of three, no power-ups. The room is a Cloudflare Durable Object (`worker/src/match.ts`) that spawns the mice, resolves taps (first tap wins) and keeps the score; a single `Lobby` object (`worker/src/lobby.ts`) pairs quick-match players and stores the global ranking in SQLite, and a single `Presence` object counts everyone online. The Worker is routed at `tilcayo.cat/mp/*`.

```
cd worker && npm i
npm run dev      # local API on :8787 (the /play page uses it automatically on localhost)
npm run deploy   # wrangler deploy
```

## Stack

- Vite + TypeScript, no framework
- Painted sprites (cat states, mouse, paw, hole, power-ups, aurora sky) generated with GPT Image, optimized to WebP + PNG
- Synthesized Web Audio effects and a chiptune loop, no media assets
- Static output deployed to Cloudflare Pages

## Scripts

| command | what it does |
| --- | --- |
| `npm run dev` | dev server |
| `npm run build` | type-check and build to `dist/` |
| `npm run preview` | serve `dist/` |
| `npm run og` | regenerate `og.png`, favicons and PWA icons from the SVG art |
| `npm run deploy` | build and publish to Cloudflare Pages |

## SEO / GEO

`index.html` carries canonical, Open Graph, Twitter card, geo and theme metadata plus a JSON-LD graph (WebSite, Organization, VideoGame/WebApplication, Taxon, FAQPage). `public/` adds `robots.txt`, `sitemap.xml`, `llms.txt`, `humans.txt`, a web manifest and Cloudflare `_headers` (security + caching). The www → apex redirect is a zone Redirect Rule.
