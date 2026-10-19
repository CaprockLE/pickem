# League Console

NFL pick'em league management. Scores update themselves from ESPN's public feed; the league
manager drops in photos of the paper pick sheets and the site reads them.

## Deploy (about 20 minutes)

### 1. Storage
Add a Redis store: Vercel dashboard -> Storage -> Marketplace -> Upstash (free tier),
or create one at upstash.com. Connect it to the project. You need these two values:

    KV_REST_API_URL
    KV_REST_API_TOKEN

Connecting through Vercel sets them automatically. (The code also accepts
UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN if you set up Upstash directly.)

### 2. Environment variables
Project -> Settings -> Environment Variables:

| Name | Value |
|---|---|
| `ADMIN_PASSCODE` | any phrase you pick; the manager types it to save |
| `ANTHROPIC_API_KEY` | from console.anthropic.com (only needed for photo import) |
| `SEASON` | `2026` |
| `CLAUDE_MODEL` | optional; defaults to `claude-sonnet-5-5` |

### 3. Ship it
Drop this folder into a Git repo and import it on Vercel, or run `vercel` from here.
No build step: static `core.js` (the shared model and logo logic, loaded by every page), `share.js` (the share card, drawn the same on every site), `importer.js` (reading and importing pick sheets), `optimizer.js` (predicting how the pool picks), `index.html` plus three functions in `/api`.

See `CHANGELOG.md` for what changed in each build.

## Two builds
`/` is the main site. `/lab` is an experimental skin, `/pro` a private control build (manager passcode required) (clean URLs are enabled in
`vercel.json`; without it the path is `/lab.html`) with the same data and logic —
regenerate it after editing index.html with `node make-lab.mjs`.

## Sections
- **Season standings** — cumulative totals, weeks won, week-by-week grid.
- **Week results** — live scoreboard, standings, every pick, auto winner with tiebreaker.
- **Import sheets** — drop photos, confirm what was read, publish.
- **Payments** — paid toggles, pot and outstanding totals, season owed.

## Using it
- `/?week=5` — any week, or use the dropdown.
- **Scoreboard** refreshes every 30 seconds while the tab is open.
- **Manager** button -> enter the passcode -> drag sheet photos onto the drop zone.
  Check the names it read, hit *Add these entries*, then **Save changes**.
- Click any standings row (while the manager panel is open) to toggle paid.
- Overrides exist per game for the rare case the feed is wrong; otherwise results are automatic.
- The winner panel settles ties using the last game of the week (or
  `tiebreakerGameId`) and each person's guess.

## Costs
Vercel: free. Upstash: free tier is plenty. Claude API: a few cents per sheet import.
ESPN's feed is free and needs no key.
