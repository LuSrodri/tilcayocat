# Tilcayo Cat Game

A new cat discovered after 100+ years, turned into a game.

A mobile-first browser game at [tilcayo.cat](https://tilcayo.cat). You are a tilcayo cat (*Leopardus tilcayo*, the first new wild cat species described in over a century) sitting on the grass. Tap the mice as they pop out of 25 holes. You start with **5 seconds**; each catch adds **0.8 s** (capped at 5), each empty slap costs **0.3 s**. Power-ups pop up now and then: **Auto-catch** (6 s of automatic paws), **Full time** (clock back to 5 s) and **Freeze** (clock, mice and spawns paused 4 s). When the timer hits zero the round is over.

The ⓘ button opens `/about`, a sourced profile of the real cat with photos and a donation link to Senda Verde.

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
