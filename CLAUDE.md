# CLAUDE.md: Windmill (third base coach simulator)

Handoff notes for Claude Code. Read this before touching anything.

## Who and why

Jacob Gearity built this as a portfolio project for GitHub and LinkedIn while applying for MLB and NFL front office and analytics jobs (Guardians, Cubs, Tigers, Brewers, Rays, Lions). The audience is team R&D and baseball ops staff plus casual fans, so the game has to be fun and the analytics have to hold up when a quant reads the code.

It's a passion project. The leaderboard runs on the honor system; don't add auth or anti-cheat unless he asks. Jacob works in R, so the data pipeline stays in R. The front end is plain HTML, CSS and JS.

It runs locally (double-click `index.html`) and online at https://gearity.github.io/windmill/ from the public repo https://github.com/gearity/windmill. GitHub Pages serves the `main` branch root, so every push redeploys.

## Writing style

All text in this project follows Jacob's anti-AI writing guide: UI copy, the About dialog, code comments, R messages, chart titles, README, this file, commit messages, and the GitHub repo description. The guide is at `C:\Users\Jacob\Desktop\anti-ai-writing-guide.md`; the core rules are in `C:\Users\Jacob\.claude\CLAUDE.md`. In short: no em dashes, no "not X but Y" contrasts, no reflexive lists of three, no AI vocabulary, no bold-label bullet lists, no recap at the end.

Keep the baseball voice. "Send him," "Hold him," "Take the box," "The read," "Back to the box," and scouting lines like "Cannon. Runners know about this arm." stay. The filter is for generic AI habits, not for the game's personality.

## The game

A real MLB play: the runner on second is rounding third on a single to the outfield. An animated top-down field plays the hit out, then freezes as the runner nears third. The player has an adjustable clock (default 5 seconds; 3, 5, 8, 12 or off) to send or hold, by button or the S and H keys. Then the play resolves, the real result shows, and the broadcast clip plays.

| Call | Real result | Streak |
|---|---|---|
| Send | Safe | +1 |
| Hold | Out at home | +1 |
| Send | Out at home | Ends |
| Hold | Safe | Ends |
| Clock expires | Either | Ends |

## Design decisions already made (don't relitigate)

1. Hybrid grading. The pool holds only real sends, so every play has a known outcome; real holds are left out because nobody knows what would have happened. The streak grades the result. The timing model grades the decision: P(safe) against the breakeven for the number of outs, shown on the reveal, plus a line ranking the play's P(safe) against every real send ("By the model, riskier than 68% of the 6,472 sends real coaches made"). The ranking exists because the calibrated model rates every pool play above breakeven, so the send/hold verdict alone never varies.
2. Balanced pool. Real sends score 97% of the time, so `pickPlay()` in `game.js` flips a coin between safe and out plays. Without it, always sending wins. The About dialog says so.
3. Outs matter. Breakeven comes from RE24 (computed by the pipeline from the same seasons), assuming every trailing runner, batter included, takes an extra base on the throw home. A hold leaves first and third (or the bases loaded); safe adds a run with runners on second (and third); out adds an out with the same trailing runners.
4. Video streams from MLB. The original plan was to rehost clips in the repo, but MLB's clip server (`sporty-clips.mlb.com`) answers scripted downloads with a Cloudflare block. Don't try to get around it. The pipeline reads each play's mp4 URL from its Savant `sporty-videos` page, and the visitor's browser plays it straight from MLB (verified cross-origin, Oct 2026). A hand-saved `clips/<play_id>.mp4` wins over the stream. If a clip fails, the reveal falls back to a "Watch it on Baseball Savant" link.
5. Animated field, then the real clip. The animation is a recreation built from play data, not tracking data. It always shows the real result: `throwArriveShown` in `model.js` nudges the throw so the animation matches what happened even when the model disagrees, and the model's own number still shows on the reveal. Everything after the call plays at `FINISH_SPEED` (1.3x, in `game.js`), runner and ball together, so the race is unchanged. On the reveal the clip covers the field area (`#clipStage`) with a "Show the field" toggle in the panel; on phones it's pinned to the top of that area so it sits on screen under the verdict.
6. The right column reads top to bottom: scorebug (inning, outs, score, postseason round), then the read (runner, outfielder, batted ball) before the call, or the reveal after it. The scorebug used to sit on top of the field; Jacob moved it so the player's eyes don't jump between the field and the panel. Keep the read's type large; he has asked twice for it to be bigger.
7. Storage goes through one module. `window.Store` (`js/store.js`) holds coaches, streaks and settings in `localStorage` (keys `windmill.users.v1`, `windmill.lastUser`, `windmill.timer`, `windmill.sound`, `windmill.device`), every access wrapped in try/catch, and talks to the leaderboard.
8. Shared leaderboard on Supabase, over plain REST with no client library. `js/config.js` holds the project URL and publishable key; both are public by design. `supabase/schema.sql` creates an insert-and-read-only `streaks` table plus `board_all_time` and `board_week` views (each coach's best, names matched without case). Every streak counts whatever the clock; each row records the most lenient clock used during the streak (off counts as most lenient). A streak posts when it ends, when the coach switches, or when the page is hidden mid-streak (`keepalive` fetch); posting the same run again at a higher value is harmless because the views keep each coach's best. With `js/config.js` empty, every leaderboard link stays hidden and the game works offline.
9. No build step. Static files run straight from `index.html`, from `file://` or GitHub Pages. Scripts are classic globals, not modules, so `file://` works.
10. One model, two languages. `pipeline/model.R` and `js/model.js` implement the same timing model. The pipeline fits the two calibration coefficients and ships them in `window.MODEL_FIT`; every play also carries R's `p_model`, and `game.js` logs a console warning if `WM.timeline(p).pSafe` differs by more than 0.002. Change both files together.
11. Physics hand-set, calibration fit. A first attempt also freed `throwCarry`, `speedFactor` and an offset. On real data they ran to the edges of their ranges (throws at 46% of arm strength, which made the animation's throws crawl) and scored worse than a flat rate out of sample. Don't refit physical constants on sends-only data without a much richer feature set.
12. Labels come from the MLB game feed, not the play description. See the pipeline section.

## File map

```
index.html              the game: scoreboard header, field canvas, call bar, login overlay, scorebug, read, reveal, About dialog
leaderboard.html        shared leaderboard page (all time and last 7 days)
css/style.css           all styles; tokens on :root; breakpoints at 980px and 560px; respects prefers-reduced-motion
js/config.js            Supabase URL and publishable key (empty = no leaderboard)
js/model.js             window.WM: field geometry, constants K with MODEL_FIT overrides, default RE24, breakeven(), timeline(play)
js/store.js             window.Store: coaches, streaks, settings, device id, submitStreak(), fetchBoard()
js/field.js             window.Field: canvas renderer (static layer cached offscreen, ResizeObserver) and per-frame positions
js/game.js              state machine, UI, play selection, clock, reveal, risk ranking, clip, leaderboard posting, keyboard, R/JS parity check
js/leaderboard.js       leaderboard page
data/plays.js           GENERATED: window.PLAYS_META, RE24, MODEL_FIT, PLAYS
supabase/schema.sql     leaderboard tables, policies and views; run once in the Supabase SQL editor
favicon.svg, og-image.png   tab icon and 1200x630 social card
.nojekyll               tells GitHub Pages to serve files as they are
clips/                  optional hand-saved <play_id>.mp4 (git-ignored by default)
pipeline/run.R          entry point: Rscript pipeline/run.R, from the repo root
pipeline/config.R       seasons, chunk size, pool size, paths
pipeline/helpers.R      httr2 request, retry and parallel helpers; caching
pipeline/model.R        R twin of js/model.js, breakeven, scoring rules
pipeline/01_statcast.R  Savant search CSV in 4-day chunks to PAs, RE24, candidate plays
pipeline/02_feeds.R     MLB game feed per game to a label (safe, out, held...) and the Savant playId
pipeline/03_players.R   sprint speed and arm strength leaderboards, names, features
pipeline/04_fit.R       calibration fit, 5-fold CV, per-piece regression, coaches vs. breakeven, charts
pipeline/05_clips.R     pool selection, clip URL lookup
pipeline/06_write.R     data/plays.js and pipeline/out/*.csv
pipeline/out/           committed analysis outputs (CSV, JSON, PNG)
pipeline/cache/         git-ignored download cache
```

Script order on the game page: `data/plays.js`, `config.js`, `model.js`, `store.js`, `field.js`, `game.js`. The leaderboard page loads `config.js`, `store.js`, `leaderboard.js`.

## Game state machine (`game.js`)

`login`, then `approach` (animate from 0 to `decisionT`), then `decide` (frozen frame and clock), then `resolve` (animate the send; on a hold or timeout, the hold animation and then a faded replay of the real send), then `reveal` (verdict, model numbers, risk ranking, clip; Enter or the button deals the next play).

`decide("timeout")` counts as wrong; the coach gives no signal and the runner pulls up like a hold. The clip's `<video>` is created when each play starts so it buffers during the animation. Clips start muted; once a visitor unmutes one, later clips try to play with sound (`windmill.sound`).

Animation runs on `requestAnimationFrame` with wall-clock time, so a background tab freezes the animation but not the clock. In a hidden browser pane rAF may not fire at all.

## The timing model (`model.js` and `model.R`)

Times are seconds after contact. Coordinates are feet, with home at (0, 0) and +y toward center field.

The runner's lead is 15 ft, plus 8 with two outs. He starts after `readDelay`, plus `lineDriveFreeze` on liners with fewer than two outs, or at `twoOutStart` with two outs. He runs at `sprint_speed * speedFactor` and loses `turnLoss` rounding third; `tHome` is when he reaches the plate.

The ball's travel time is distance / (launch_speed * ballFactor[type]), clamped to 1.6 to 5.0 seconds. Release is field time plus `exchange`. Throw speed is arm_mph * 1.4667 * `throwCarry`.

`margin = throwArrive + tagTime - tHome` in seconds, and `logit pSafe = calibIntercept + calibSlope * margin`. The call comes at `decisionT = max(0.9, min(tField + 0.15, tAt3B - 0.2))`.

`calibIntercept` and `calibSlope` come from `glm(safe ~ margin, binomial)` on every labeled send (`04_fit.R`). Everything else in `K` is hand-set because it drives the animation. The hand-set calibration defaults are 0 and 1/0.28.

The fit uses sends only, so it estimates P(safe | the coach sent him). It says nothing reliable about holds, which is why the coach table compares coaches with breakeven directly instead of with the model.

Results from the full run on Oct 23 2026 (2024 to 2026, postseason through Oct 19):

- 559,650 PAs, 7,413 games, 9,094 candidates. Feed labels: 6,323 safe, 205 out, 2,524 held, 20 error, 19 unclear, 3 out elsewhere. 6,472 sends with features (16 imputed sprint speeds, 280 imputed arms). Pool: 1,704 plays (all 204 outs and 1,500 safes, 27 from the postseason), 1,703 with a clip.
- Calibration: `logit P = 2.84 (SE 0.10) + 0.516 (SE 0.07) * margin`. 5-fold CV: Brier 0.0304 against 0.0305 for a flat rate, log loss 0.136 against 0.140, AUC 0.664. The hand-set physics ranks plays the same (AUC 0.665) but is badly calibrated (Brier 0.073).
- Pieces of the margin (`model_terms.csv`): runner time -1.46 per second (z -6.0) and ball-to-fielder time +0.65 per second (z +4.5) carry the signal. Throw time from arm and distance doesn't (z 0.7) once coaches have filtered whom to send. Two outs -0.45 (z -2.9): two-out sends are riskier.
- Coaches vs. breakeven (`coach_decisions.csv`): with 0 outs they send 48%, sends score 97.6%, breakeven 74%; 1 out, 62%, 96.7%, 62%; 2 outs, 94%, 96.7%, 42%.
- Every pool play's P(safe) falls between 0.95 and 0.98, above every breakeven. That's why the reveal adds the risk ranking (`META.send_p_quantiles`, the 0th to 100th percentiles of P(safe) over all 6,472 sends).

## Play data schema (`data/plays.js`)

```js
{
  id /* Savant playId */, date, game_type /* R|F|D|L|W */, bat_team, fld_team, inning, half: "Top"|"Bottom", outs,
  score: { bat, fld }, runner_on_first: bool,
  runner:  { name, sprint_speed /* ft/s */, imputed: bool },
  batter:  { name },
  fielder: { name, pos: "LF"|"CF"|"RF", arm_mph, imputed: bool },
  batted_ball: { type: "ground_ball"|"line_drive"|"fly_ball"|"popup", x, y /* ft */, launch_speed },
  result: "safe"|"out",
  description, play_id, clip /* MLB mp4 URL, "clips/<id>.mp4", or null */,
  p_model /* R's P(safe), for the parity check */
}
```

`PLAYS_META`: `{ demo, seasons, built, ref: { speed: {min,max,avg}, arm: {min,max,avg} }, n_safe, n_out, n_postseason, send_p_quantiles, game_types }`. `ref` sets the scouting meters (2nd and 98th percentile of regulars). `MODEL_FIT`: `{ K: { calibIntercept, calibSlope }, n, n_out, seasons, metrics: { base_rate, hand_tuned, fitted_cv: { log_loss, brier, auc } } }`; the About dialog quotes it.

## Pipeline (`Rscript pipeline/run.R`)

Seasons 2024 to 2026, regular season and postseason (`config.R`). The first run downloads about 170 Savant search chunks (around 45 seconds each), about 5,000 game feeds and about 1,700 Savant video pages. Everything is cached, and reruns take about two minutes. Chunks that end in the last two days aren't cached, so in-progress postseason games refresh.

1. Statcast (`01`): Savant search CSV (`hfGT=R|PO|`) in 4-day chunks; a chunk that hits the 25k row cap is split in half and pulled again. Keeps only PA-ending pitches. RE24 from regular-season PAs, skipping the bottom of the 9th and later. Candidates: `events == "single"`, runner on second, third empty, `hit_location` 7, 8 or 9, has `hc_x` and `hc_y`, no error, interference or obstruction in `des`.
2. Labels (`02`): `statsapi.mlb.com/api/v1/game/{pk}/playByPlay` with a `fields=` filter (about 100 KB a game). The play is the one with `atBatIndex == at_bat_number - 1`. The runner from second (`on_2b` id) is tracked across all his movement rows: scored is `safe`; out with `outBase == "4B"` and an outfielder credited with `f_assist_of` or `f_assist` is `out`; out at home without an outfield assist is `out_no_of_assist` (rundowns, excluded); out anywhere else is `out_elsewhere`; ending at third is `held`; any error credit is `error`. The playId is the last pitch event's `playId`. Disagreements with the description-based label go to `out/label_check.csv`.
3. Players (`03`): Savant sprint speed (`player_id`, `sprint_speed`, `competitive_runs`) and arm strength (`player_id`, `arm_of` with `arm_overall` as fallback, `total_throws_of`) leaderboard CSVs per season; postseason plays use that season's numbers. Missing values get the league average and an `*_imputed` flag. Names come from `statsapi.mlb.com/api/v1/people`. Hit coordinates to feet: `x = (hc_x - 125.42) * 2.5`, `y = (198.27 - hc_y) * 2.5`; keeps y > 120 ft.
4. Fit (`04`): see the model section. Writes `model_fit.json`, `model_terms.csv`, `model_calibration.csv`, `coach_decisions.csv`, `calibration.png`, `p_safe_by_result.png`, `coaches_vs_breakeven.png`.
5. Clips (`05`): the pool is every `out` send plus up to 1,500 seeded-random `safe` sends with a playId. The clip URL is the first `https://sporty-clips.mlb.com/...mp4` on `baseballsavant.mlb.com/sporty-videos?playId=`, cached raw in `cache/clip_urls.csv` and HTML-unescaped on use. Its base64 padding arrives as `&#x3D;`, which broke 134 of 1,704 URLs before the fix.
6. Write (`06`): `data/plays.js`, `out/sends.csv`, `out/re24.csv`, `out/send_summary_by_outs.csv`.

## Visual design

The look is a painted-steel ballpark manual scoreboard: deep green board, a rivet line, stencil numerals, and foul-pole yellow for the Send button and the streak. Keep it.

- Tokens: `--board #1e3a2b`, `--board-deep #142a1e`, `--board-line #2d5240`, `--chalk #eef0e8`, `--chalk-dim #a9bcae`, `--signal #f2c230`, `--out #e0553f`, `--clay #9a6743`.
- Fonts from Google Fonts: Saira Stencil One for display numerals and headings, Barlow Condensed for labels and buttons, Barlow for body text.
- Copy is sentence case and plain: "Send him," "Hold him," "Next play," "Right call. Streak: 3." No all-caps labels and no arrows on buttons. The SAFE and OUT umpire calls on the field are the one exception.
- At 980px and below the right column stacks above the field. At 560px and below the read becomes a compact two-column card.
- The R charts use the same palette (`theme_board()` in `04_fit.R`).

## Verified so far (Oct 2026, Windows, local static server and in-app Chromium)

- Full 2024 to 2026 pipeline run (39 minutes the first time with a parallel Statcast prefetch; about two minutes cached). All six feed-vs-description label disagreements are the case the feed is there for: the runner from second scored and a trailing runner was out at home.
- Game loop at 1440x900 and 375x812: login, approach, decide, send, reveal with the MLB clip over the field; hold with the replay; 3-second timeout; timer persists; risk ranking shows. On phones the scorebug, read, field and buttons fit in 812px. No console errors; R/JS parity max difference 5e-5. 40 sampled clip URLs (20 random, 20 that were broken before the unescape fix) all load cross-origin.
- Live site checked after publishing: data, fonts and a clip playing from MLB on the github.io domain.
- Testing note: the in-app browser pane must be visible for rAF to run, and screenshots of a large emulated viewport in a narrow pane can't be read; measure layout in JS or snapshot the canvas with `toBlob`.

## Next steps

1. The leaderboard is connected (Supabase project `ontyfvpcpcjqxktghmed`, free tier, created Oct 23 2026). Tested end to end: a streak posts from the game and reads back from both views, and the public key can't edit or delete rows or insert an invalid clock. Jacob moderates by deleting rows in the Supabase dashboard (Table Editor, or `delete from public.streaks where ...` in the SQL editor). Free projects pause after a week without traffic; if the board stops loading, restore the project from the dashboard.
2. Model features worth trying: hang time from launch angle for air balls instead of the flat `ballFactor`, or the per-piece regression (`model_terms.csv`) as the game's model in place of the single margin.
3. The LinkedIn write-up (Jacob asked to be reminded). Lead with `coaches_vs_breakeven.png`: with nobody out, coaches send 48% of the time and those sends score 97.6% against a 74% breakeven, so they're holding runners who would usually score (the known finding that coaches are too conservative, on 2024 to 2026 data). Back it with `send_summary_by_outs.csv` and the finding that arm strength doesn't separate safe from out among sends. Match the voice of his "Scottie Effect" post: a punchy, specific question, a clear finding, and a chart.

Possible later additions, only if he asks: a daily challenge with a fixed seed, a coach report after a streak ends (aggressive or conservative), sound effects, runners going from first to third.

## Conventions

- Vanilla JS in IIFEs that expose `window.WM`, `window.Store` and `window.Field`. No framework, bundler or npm.
- Every `localStorage` call goes through `Store` inside try/catch.
- Model constants live in `K` with a comment on each, mirrored in `model.R`. Update the README and the About dialog when the model changes.
- R code uses tidyverse style with the native pipe `|>` (R 4.1 or later) and caches every network call.
- Run the pipeline from the repo root; it refuses to run anywhere else.
- Commits use a repo-local identity (Jacob Gearity, gearity noreply email). Commit messages follow the writing guide: imperative and specific.
