# Google Ads: Cat The Mouse Company (US launch)

Goal: people who buy the 50,000-point pack (US$ 3.44). Total cap: **R$ 100** (plan spends at most R$ 98).

## Measurement
- GA4 property "Cat The Mouse Company" linked to Google Ads 271-801-6468 (personalized ads on, auto-tagging on).
- Primary conversion: GA4 `purchase` (value + currency from the game, transaction_id = Stripe session).
- Secondary: GA4 `sign_up` (mark as key event once it shows up in GA4 → Admin → Events).
- The game sends `user_id` (Supabase id) and `game_start`, `game_end`, `unlock_cat`, `begin_checkout`, `purchase`.

## Budget (never above R$ 98)
| Campaign | Type | Daily | Days | Max |
|---|---|---|---|---|
| CTMC · Search · US | Search | R$ 7 | 7 (fixed end date) | R$ 49 |
| CTMC · YouTube · US | Demand Gen (YouTube in-stream, in-feed, Shorts) | R$ 7 | 7 (fixed end date) | R$ 49 |

Google may spend up to 2× the daily budget on a single day, but never bills more than daily budget × days active,
so a fixed 7-day end date keeps the total at R$ 98.

Bidding: Maximize conversions, goal = purchase. Location: United States (presence). Language: English.

## Search
Final URL: https://catthemouse.co/ · Display path: catthemouse.co/cat-game

Keywords (phrase match): "cat game", "cat games online", "free cat game", "cat and mouse game",
"mouse catching game", "cute cat game", "whack a mole game", "browser cat game", "3d cat game", "kitten game"

Negatives: download, apk, real cat, toy, laser, app store, steam, ps5, xbox, nintendo, casino, porn, jobs

Headlines (≤ 30):
1. Cat The Mouse Company
2. Free 3D Cat Game Online
3. Catch the Mice, Collect Cats
4. Play Free in Your Browser
5. No Download. Just Tap & Play
6. 7 Cats to Unlock
7. 100 Mice of the Day
8. Duel Friends 1v1 Online
9. Cute Cat & Mouse Game
10. Tap Fast, Earn Points
11. 50,000 Points for $3.44
12. Daily Challenge Every Day
13. Works on Phone & Desktop
14. Mind the Grumpy Porcupine
15. Start Playing in 1 Tap

Descriptions (≤ 90):
1. Tap the mice before the clock runs out. Free 3D cat game that runs right in your browser.
2. Earn points every round to unlock 7 cats, or grab 50,000 points for just $3.44.
3. Catch 20 mice of the day, dodge the porcupine and the snake, then duel friends 1v1.
4. No download, no install. Create a free account to keep your cats on every device.

Images: marketing/ads/ad-landscape-1200x628.jpg, ad-square-1200x1200.jpg · Logo: logo-square-1200x1200.png

## YouTube (Demand Gen)
Videos: marketing/trailer/catthemouse-trailer-16x9-1920x1080.mp4, catthemouse-trailer-9x16-1080x1920.mp4
(uploaded to YouTube as unlisted). Images: ad-landscape, ad-square, ad-portrait. Logo: logo-square.
Headline: Catch the mice. Collect the cats. · Description: Free 3D cat game in your browser. 7 cats, 100 mice of the day, 1v1 duels.
CTA: Play now · Final URL: https://catthemouse.co/
Channels: YouTube only (in-stream, in-feed, Shorts). Audience: optimized targeting on, plus custom segment
"casual mobile game players / cat lovers" (searches: cat games, cute games, idle games, whack a mole).
