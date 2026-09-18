# Tilcayo Cat

A mobile-first browser game at [tilcayo.cat](https://tilcayo.cat). You are a tilcayo cat (*Leopardus tilcayo*, the first new wild cat species described in over a century) sitting on the grass. Tap the mice as they pop out of their holes. Go more than **5 seconds** without a catch and the round is over.

The info button opens a short, sourced profile of the real cat.

## Stack

- Vite + TypeScript, no framework
- Original SVG artwork (cat, mouse, paw) inlined at build time
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
