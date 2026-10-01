# Cat The Mouse Company

Catch the mice, collect the cats. A mobile-first 3D browser game at [catthemouse.co](https://catthemouse.co) (formerly *Tilcayo Cat Game*).

You start as a grey tabby on a moonlit lawn. Tap the mice as they pop out; the lawn grows from 4 to 25 holes while the mice speed up. You start with **5 seconds**; each catch adds **0.8 s** (capped at 5), each empty slap costs **0.3 s**. Power-ups: **Auto-catch** (6 s), **Full time** (clock back to 5 s) and **Freeze** (4 s: the clock stops and the whole world holds still — critters, fireflies and the cat's idle motion run on a separate world clock in `src/engine/lawn.ts`, and each critter gets a block of ice).

## Shop (`src/shop.ts`)

Round points go to a wallet in localStorage (1v1 adds 10 per mouse caught). They buy cats — Orange Tabby 150,000, Badger 400,000, Black 800,000, White 1,400,000, Calico 2,200,000, Tilcayo 4,000,000 — and the **Yellow Lizard** (600,000), a critter worth 2 mice. All cats share one procedural sculpt with per-coat canvas textures and colours (`LOOKS` in `src/engine/models.ts`); `Lawn.setCatSkin()` swaps a cat live. The chosen cat and the lizard travel to 1v1 as `?skin=…&lizard=1` on the room WebSocket; the room spawns lizards if either player owns it.

Storage keys keep the original `tilcayo.` prefix.

## Combos, ranks and streaks

Catches less than 1.5 s apart chain into a **combo**: each link raises the catch sound a semitone, a draining meter shows how long you have, and 5/10/15/20/30 trigger callouts (10+ turns on "frenzy", a pulsing glow over the lawn). An escape, an empty slap or a porcupine breaks it.

Every round ends on a **hunter rank** by mice caught — Sleepy Kitten (0), Curious Cub (5), Lawn Prowler (12), Night Hunter (20), Shadow Stalker (30), Lawn Legend (45), Mythic Mouser (65) — with a bar showing how many mice to the next one. Rank-ups, beating your best and beating a friend's score all pop mid-round. Days played in a row are kept as a **streak** (`src/rank.ts`).

## Sharing

After a round, **Share my card** draws a 1080×1350 PNG on a canvas (`src/sharecard.ts`, backdrop `public/img/card-bg.*`): score, rank, time, best combo, a heat strip (one tile per 10 s), the seal shelf and a "Can you beat me?" call to action. The sheet shares the image through the Web Share API where files are supported, and otherwise offers Save image, Post on X and Copy challenge (a Wordle-style emoji summary).

Shared links carry the score: `https://catthemouse.co/?beat=42`. The start screen turns into "Beat 42 mice", and `functions/index.ts` (a Pages Function on `/`) rewrites the Open Graph / X tags so the link unfurls as "Can you beat 42 mice?" with the sharer's rank card from `public/og/beat-<rank>.jpg`.

## Seals

Eleven wax seals (including Regular, Loyal Hunter, Lawn Keeper and Company Legend for 5, 15, 60 and 90 days in a row) are earned by playing and kept on the device (`localStorage`); the start screen and the 1v1 lobby show the shelf, and earning one pops a toast.

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

Two players share one 5×5 lawn for 60-second rounds, best of three, no power-ups. The room is a Cloudflare Durable Object (`worker/src/match.ts`) that spawns the mice, resolves taps (first tap wins) and keeps the score; a single `Lobby` object (`worker/src/lobby.ts`) pairs quick-match players and stores the global ranking in SQLite, and a single `Presence` object counts everyone online. The Worker is routed at `catthemouse.co/mp/*`.

```
cd worker && npm i
npm run dev      # local API on :8787 (the /play page uses it automatically on localhost)
npm run deploy   # wrangler deploy
```

## Stack

- Vite + TypeScript, no framework
- Painted sprites and key art (cat states, mouse, paw, hole, power-ups, aurora sky, pounce key art, share-card backdrop) generated with GPT Image, optimized to WebP + PNG/JPEG
- Synthesized Web Audio effects and a chiptune loop, no media assets
- Static output deployed to Cloudflare Pages, plus one Pages Function (`functions/index.ts`) for challenge-link previews

## Scripts

| command | what it does |
| --- | --- |
| `npm run dev` | dev server |
| `npm run build` | type-check and build to `dist/` |
| `npm run preview` | serve `dist/` |
| `npm run og` | regenerate the logo, favicons and PWA icons from `art-src/renders/logo-head.png` (a render of the 3D grey tabby) |
| `npm run logo` | rebuild the cartoon wordmark (`public/brand/logo-wordmark*`) from the Fredoka font in `art-src/fonts` and the 3D renders |
| `npm run social` | regenerate `public/catthemouse-og-v3.jpg` and the per-rank challenge cards from the 3D cat renders in `art-src/renders/` over `art-src/sky.png` |
| `npm run deploy` | build and publish to Cloudflare Pages |

## SEO / GEO / AEO

Every page carries canonical, Open Graph, X card and a JSON-LD graph sharing `@id`s across pages: WebSite, Organization and VideoGame on `/`; VideoGame (1v1) and BreadcrumbList on `/play`; Taxon (with `sameAs` to Wikipedia, Wikidata, iNaturalist, ZooBank), ScholarlyArticle and FAQPage on `/about`; FAQPage and the ranks ItemList on `/how-to-play`; Article, an ItemList of VideoGames and FAQPage on `/cat-games` (comparison with other cat browser games — re-check the other games' pages before editing it). FAQ markup always mirrors a visible FAQ on the same page. `public/` adds `robots.txt` (search and AI crawlers allowed, `/mp/` excluded), `sitemap.xml`, `llms.txt` / `llms-full.txt`, `humans.txt`, a web manifest and Cloudflare `_headers` (security + caching). The www → apex redirect is a zone Redirect Rule. When game rules or species facts change, update the visible page, its JSON-LD and both `llms` files together.
