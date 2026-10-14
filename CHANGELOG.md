# Changelog

Reconstructed from the build history. Newest first.
Each entry is the build number shown at the bottom of the sidebar.

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
