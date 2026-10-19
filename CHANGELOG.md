# Changelog

Reconstructed from the build history. Newest first.
Each entry is the build number shown at the bottom of the sidebar.

## build-160 — optimizer, step 1: the pool backtest
- New optimizer.js learns each player's habits from past sheets (how often they take the
  favourite in close / medium / big games, shrunk toward the league, plus a league-wide home
  lean) and backtests it: every finished week predicted from only the other weeks
- /pro Optimizer tab: verdict, games tested, average miss in players per game against the
  miss chance alone would cause, how often it called the pool's lean, the league's habits,
  who takes underdogs most, and week-by-week predicted vs actual
- Tested on a made-up league with known habits: misses 1.05 players per game against 1.16
  from chance alone. Finding: per-game splits are predicted as well by league-wide habits

## build-159 — clinched weeks
- When one player tops every remaining outcome, the week is clinched. Instead of a scenario
  table repeating their name, What's Still in Play says so in one line; the Week Winner card
  names them as soon as it's clinched; the standings show Clinched instead of Lead
- Same in /pro: a CLINCHED banner instead of scenarios, a CLINCHED tag on the ladder, and the
  ladder header names who clinched it

## build-158 — faster live scores
- Scores refresh every 10 seconds while any game is live (45 otherwise), on every site;
  the week's entries refresh once a minute instead of with every score update; both refresh
  immediately when the tab comes back into view
- api/scores.js: ESPN's answer cached 8 seconds during live games (was 20), 30 otherwise.
  Saved lines are only read when games are still to kick off, and held in memory 2 minutes
- /pro: the home team's possession ball sits on the inside of its code ("🏈 PHI")
- Verified: 3 score fetches and no extra entry reads in 35 live seconds, on both sites

## build-157 — win % on games that haven't started
- /pro Matchups: games that haven't kicked off show each side's win % (from the line, or a
  small home edge when there's no line), under the same WIN PROB label as live games
- Visual snapshots now wait for the page's data before capturing (a timing wobble had made
  the Card Collection snapshot flag differences that weren't real)

## build-156 — steadier pre-game win %
- Win % moved overnight with no games played and no entries changed. The likely cause: ESPN's
  feed dropping some games' lines, which the model then treats as near coin flips (dropping
  lines on the big favourites reproduces Brock 18%→16.5%, Melissa 16%→14.8%)
- api/scores.js saves every line it sees (Redis, per game) and reuses it when the feed drops one
- Favourite now read from ESPN's per-team flag, then the moneylines, then the text; if none
  says who's favoured, no line rather than a possibly backwards one
- /pro: pre-game matchup cards show the line ("SF −7.5"), or NO LINE in orange

## build-155 — fix: three Pro styling collisions
- Card Collection: Result Overrides rows (build-153) used the class .ovr, already the card's
  rating, putting a dark block over every card's rating. Override rows are now .ovrow
- Matchups: Head to Head's container (build-147) used .tug, already the pool-split bar on
  every matchup card, stacking its two halves. Head to Head's is now .h2tug
- Ladder status tags shared .st with the matchup clock; tags are now .lst
- New checks on every build: a scan for classes reused across components, and visual
  snapshots of all 20 screens on the three sites compared pixel by pixel to references
  (verified it flags the card bug: 9.64% of the Card Collection changed)

## build-154 — Can Still Win replaces Top Score
- Week Results: the Top Score tile is now Can Still Win — how many players still have a
  mathematical path to winning the week, out of the field ("16/21"). Before kickoff it's
  everyone; once every game is final it counts the actual winner(s) after the tiebreaker
- Verified it matches the OUT tags in the standings, before kickoff, mid-week and final

## build-153 — the rest of Import in Pro
- /pro Import tab now has the four cards from the main site: Roster (add, remove, pull names
  from the week, save, never-entered note), Entries on File (rename, tiebreaker, paid, remove,
  add by hand, no-sheet-yet list, undo), Sheet Archive (photos with editable labels, add
  photos) and Result Overrides (away / home / tie / clear per game)
- Entry and override edits collect as pending changes; Save Changes replays them onto a fresh
  copy of the week, so it can't undo someone else's save (tested with a concurrent add)
- The 30-second refresh doesn't redraw a card while a box in it is being typed in

## build-152 — fix: Pro header
- Fixed: the sheet viewer (build-149) reused the id "lb", already the LB tab button, so
  the button took the viewer's full-screen styling and covered the header, and the viewer's
  controls were wired to the button. The viewer is now #sheetView
- Tab labels stay on one line; the tab strip scrolls sideways with a fade when it can't fit
- Test sweep now fails on any duplicate id in the live page

## build-151 — Import in Pro
- New importer.js holds photo prep, the sheet reader with retries, roster matching, the
  tiebreaker check, archive saving and entry merging; the main site's import uses it
- /pro Import tab: drop or choose photos/PDFs, review with roster matching, tap any pick to
  fix a misread, editable tiebreakers, wrong-week and replace warnings, remove rows;
  one-step Publish that re-reads the week first and merges into it; new names join the
  roster; photos archived and labelled with player names; Undo Last Publish; Add Photos
- /pro no longer links out to the main site for Import and Payments
- Verified end to end (read with a retry, fix, replace, publish, roster, archive) and a
  full desktop and phone sweep of all three sites

## build-150 — Payments in Pro
- /pro Payments tab: collected / outstanding / paid / pot, a tile per player to toggle
  paid, Mark All Paid, the same buy-in setting as the main site, and season balances
- Saving re-reads the week from the server and applies only the paid changes, so it can't
  overwrite an import or edit made elsewhere in the meantime (tested with a concurrent add)
- Unsaved changes are highlighted, and switching weeks with unsaved changes asks first

## build-149 — sheet photos in Pro
- /pro All Picks: the week's archived sheet photos under the grid, opening a full-screen
  viewer (arrow keys or buttons to step through, Esc or tap outside to close); PDFs open
  in a new tab
- Player drawer: View Sheet button when a photo is labelled with that player's name,
  including photos labelled with several names
- Verified thumbnails, viewer, keyboard and the button for matched / shared / missing photos

## build-148 — Season grid in Pro
- /pro Season tab: week-by-week grid under the ladder — every player's score each week,
  week winners in gold with a star, the top score that lost the tiebreaker in lime,
  sat-out weeks marked, plus total and weeks won; same order as the ladder
- Verified all 90 cells against the season data at desktop and phone width

## build-147 — Head to Head in Pro
- Head-to-head comparison moved into core.js; the main site uses it unchanged
- /pro: Head to Head tab — fight card with both players' ratings and the head-to-head
  record, a tale of the tape, a week-by-week tug of war (weeks either sat out shown
  but not counted), and the games where the two split their picks this week
- Verified: main site shows the same records as before; /pro matches it for the same pairs

## build-146 — Share Card in Pro
- New share.js draws the picks grid and standings cards for every site; the main site and
  /pro both use it. Who-won-the-week logic moved into core.js
- /pro: Share Card button in the tab bar, with Picks Grid / Standings, A–Z / By Correct /
  As Standings, and a Dark / Light card choice; Download and Copy
- Verified: the main site's card is pixel-for-pixel identical to before the move, and
  /pro's card is pixel-for-pixel identical to the main site's, in both themes

## build-145 — shared core
- New core.js holds the win-probability model, tiebreaker projection, who's-still-alive and
  win-chance math, and logo choice. /, /lab and /pro all load it instead of keeping their
  own copies, so a fix or feature is written once and the sites can't disagree
- No visible change. Verified: identical results to the original method on 40 random
  weeks, /pro matches the main site to 0.000 points for every player, and every screen of
  all three sites loads with no errors on desktop and phone

## build-144 — sheet reading that doesn't need retries
- The import reads one photo per request instead of the whole batch at once, so no
  request can run past the server's 60-second limit or Claude's reply length
- Timeouts, overloaded and rate-limit errors retry automatically, up to 3 tries per photo
- If a photo still can't be read, the others are kept and the failed one is named
- Also: theme-matched scrollbars on all three sites; Top Score shows "of games final";
  Per Week ranking needs half the weeks played (builds 142–143)

## build-140 — win % and elimination all week
- Win % and OUT tags now run from before the first kickoff (previously only once 10 or
  12 games were left). Combinations are counted as bitmasks instead of built as objects,
  so a full 16-game week takes ~150 ms; results are cached until a score, the odds or
  the picks change. Verified identical to the old method on 40 random weeks
- Same in /pro, whose numbers match the main site exactly
- Share card: every pick in its own cell (edged on the light card); fixed dark-logo list
  on the main site (builds 138–139)

## build-137 — sheet archive and share card logos
- Fixed: importing a week's sheets in several uploads archived only the last upload's photos.
  Each upload now adds to the photos waiting to be saved
- Archive stores one photo per key and saves them one request at a time, so a full week
  can no longer outgrow a single save. Older weeks are split up automatically on first view
- Add Photos to Archive button, for backfilling sheets without re-importing picks
- Share card draws team logos instead of abbreviations, via a new /api/logo endpoint
  (a canvas can't be downloaded if it's drawn with images from another site)

## build-132 — browser QA pass
- Tested every view of the main site and Pro in headless Chromium at 1440px, 390px and 360px
- Fixed: phone standings hid the Tiebreaker column and showed Paid (columns were hidden by
  position, and the Win % column shifted them); now hidden by name
- Pro: football icon no longer pushes the team code off-centre (measured 0px offset)
- Pro: scenario conditions read "LAR WINS" rather than a bare team code
- Pro: narrower player-name column in All Picks on phones
- Pro: favicon added

## builds 108–131 — Pro (/pro)
- Private manager-only build; settled on a football video game card-mode design
- Matchup VS cards, collectible player cards with power-based ratings and tiers,
  ladder with logo pips, win %, elimination and if/then scenarios, all-picks grid,
  season standings with Season / Per Week ranking, game and player drawers

## build-57
- Sheets are read for their week number; importing into a different week warns first
- Importing over existing entries lists who would be replaced and asks to confirm
- Added this changelog

## build-56
- Tiebreaker validation: blank, fractional, under 20 or over 100 flagged at import,
  in the entries list, and again before publishing

## build-55
- Fixed: manager links stayed visible to everyone (a CSS rule outranked `hidden`)

## build-54
- Fixed: missed picks showed orange — a second CSS rule was overriding the red

## build-53
- Removed the hover lift on scoreboard cards; depth without movement

## build-52
- Possession shown as text in ticker mode (the dot broke the column grid)

## build-51
- Ticker rebuilt as a fixed seven-column grid so rows align down the list

## build-49..50
- First ticker rework (superseded)

## build-48
- Tie games read as a normal final, orange border removed
- Live-game animated border and softer card shadows ported from the lab

## build-47
- Halved padding on small buttons

## build-46
- Status pills became plain coloured text; confetti removed
- Highlighting confined to Season Standings

## build-45
- Title Case pass on Entries on File

## build-44
- Sheet photos named after the player they were assigned to; names editable

## build-43
- Fixed: photo capture code was missing, so nothing was ever archived

## build-42
- Fixed: drawer links were unclickable (backdrop stacked above the drawer)

## build-41
- Drawer content pushed clear of the mobile top bar

## build-40
- Hamburger drawer replaces the horizontal mobile nav

## build-39
- Archive failures surfaced; manual "Save Photos to Archive" added

## build-38
- Removed the lab2 layout experiment

## build-37
- Standings sort by correct picks, then win chance; flips to win chance on the last game

## build-35..36
- All Picks locks until the week's first kickoff
- Sheet photo archive with lightbox
- Add to home screen (manifest + icons)
- Toasts, loading skeletons, print stylesheet

## build-33..34
- Dedicated red for missed picks; tiebreaker column alignment

## build-30..32
- Title Case throughout; winner named in the leader tile
- Hover highlight fixes; All Picks gains a Correct column

## build-29
- Manager passcode verified server-side; manager views blocked, not just hidden

## build-26..28
- Sidebar logo removed; Won column flattened; manager sections collapsible

## build-24..25
- Tiebreaker projection from market total plus live scoring pace
- Ties resolved by projection rather than a coin flip
- A-Z ordering for All Picks, Payments and Entries

## build-21..23
- Live win probability per game (score, clock, possession, red zone)
- Win % column in Standings
- Logos sized up in grid headers; hover made fluid

## build-19..20
- Auto-detect the current week, rolling over Tuesday 00:00 Central
- `/lab` experimental skin; scenario table; head-to-head; share card

## build-14..18
- Build stamp in the sidebar
- Roster with per-sheet player assignment
- Mobile pass; dark-mode logo variants
