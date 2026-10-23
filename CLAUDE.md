# CLAUDE.md: Windmill (third base coach simulator)

Handoff notes for Claude Code. Read this before touching anything.

## Who and why

- **Owner:** Jacob Gearity. He's applying for MLB and NFL front-office and analytics jobs (Guardians, Cubs, Tigers, Brewers, Rays, Lions). This is a portfolio project for GitHub and LinkedIn.
- **Audience:** team R&D and baseball ops staff, plus casual fans. It has to be fun, and the analytics underneath have to hold up when a quant reads the code.
- **Tone:** passion project. Usernames and leaderboard security don't matter. Don't add auth, a backend, or anti-cheat unless he asks.
- **Jacob works in R.** Keep the data pipeline in R. The front end is plain HTML/CSS/JS.
- **Goal:** runs locally (double-click `index.html`) and goes online as a static site on GitHub Pages.

## The game

A real MLB play: the runner on second is rounding third on a single to the outfield. An animated top-down field plays the hit out, then freezes as the runner nears third. The user has an adjustable clock (default 5 s; 3/5/8/12/off) to **Send** or **Hold** (or press S/H). Then the play resolves, the real result shows, and the real broadcast clip plays.

**Streak rules (graded on the real outcome):**

| Call | Real result | Streak |
|---|---|---|
| Send | Safe | +1 |
| Hold | Out at home | +1 |
| Send | Out at home | Ends |
| Hold | Safe | Ends |
| Clock expires | Either | Ends |

## Design decisions already made (don't relitigate)

1. **Hybrid grading.** The pool contains only real sends, so every play has a known outcome. Real holds are excluded because nobody knows what would have happened. The streak grades the *result*. A separate timing model grades the *decision*: P(safe) vs. the outs-dependent breakeven, shown on the reveal.
2. **Balanced pool.** Real sends score far more often than not, so `pickPlay()` in `game.js` flips a coin between safe and out plays. Without this, "always send" wins. The About dialog discloses it.
3. **Outs matter.** The breakeven comes from RE24 (computed by the pipeline from the same seasons), assuming every trailing runner (batter included) takes an extra base on the throw home. Hold leads to 1st and 3rd (or loaded); safe leads to +1 run with runners on 2nd (and 3rd); out leads to +1 out with the same trailing runners.
4. **Video streams from MLB.** Originally the plan was to rehost clips in the repo, but MLB's clip CDN (`sporty-clips.mlb.com`) returns a Cloudflare block to scripted downloads. Do not try to get around that block. Instead the pipeline reads each play's mp4 URL from its Savant `sporty-videos` page, and the visitor's browser plays it straight from MLB (verified cross-origin, Oct 2026). A hand-saved `clips/<play_id>.mp4` wins over the stream. If a clip fails, the reveal falls back to a "Watch it on Baseball Savant" link.
5. **Animated field, then the real clip.** The animation is a *recreation* built from play data, not tracking data. It always shows the **real** result: `throwArriveShown` in `model.js` nudges the throw timing so the animation matches reality even when the model disagrees. The model's honest number is still shown on the reveal. Everything after the call plays at `FINISH_SPEED` (1.3×, `game.js`), runner and ball together, so the race is unchanged. On the reveal the clip takes over the field area (`#clipStage`), with a "Show the field" toggle in the panel; on phones it's pinned to the top of that area so it's on screen under the verdict.
6. **Local-only persistence, behind one module.** All storage goes through `window.Store` (`js/store.js`). `localStorage` keys: `windmill.users.v1`, `windmill.lastUser`, `windmill.timer`, `windmill.sound`. Every access is wrapped in try/catch. A shared online leaderboard, if Jacob ever asks for one, gets added inside `Store` without touching `game.js`.
7. **No build step.** Static files run directly from `index.html`, from `file://` or GitHub Pages. Scripts are classic globals (not modules) precisely so `file://` works.
8. **One model, two languages.** `pipeline/model.R` and `js/model.js` implement the same timing model. The pipeline fits the two calibration coefficients and ships them as `window.MODEL_FIT`; every play also carries R's `p_model`, and `game.js` logs a console warning if `WM.timeline(p).pSafe` differs by more than 0.002. Change both files together.
9. **Physics hand-set, calibration fit.** A first attempt freed `throwCarry`, `speedFactor` and an offset too; on real data they ran to the edges of their ranges (throws at 46% of arm strength, which made the animation's throws crawl) and scored worse than a flat rate out of sample. Don't refit physical constants on sends-only data without a much richer feature set.
10. **Labels come from the MLB game feed, not description text.** See the pipeline section.

## File map

```
index.html              markup: scoreboard header, canvas, call bar, login overlay, scout panel, reveal panel, About <dialog>
css/style.css           all styles; tokens on :root; breakpoints at 980px and 560px; prefers-reduced-motion respected
js/model.js             window.WM: field geometry, constants K (+ MODEL_FIT overrides), RE24 default, breakeven(), timeline(play)
js/store.js             window.Store: coaches, streaks, timer and sound prefs in localStorage
js/field.js             window.Field: canvas renderer (static layer cached offscreen, ResizeObserver) + per-frame positions
js/game.js              state machine, UI, play selection, timer, reveal, clip, keyboard, R/JS parity check
data/plays.js           GENERATED: window.PLAYS_META, RE24, MODEL_FIT, PLAYS
favicon.svg, og-image.png   tab icon and 1200x630 social card (LinkedIn/Twitter preview)
.nojekyll               tells GitHub Pages to serve files as-is
clips/                  optional hand-saved <play_id>.mp4 (git-ignored by default)
pipeline/run.R          entry point: Rscript pipeline/run.R (from repo root)
pipeline/config.R       seasons, chunk size, pool size, paths
pipeline/helpers.R      httr2 request/retry/parallel helpers, caching
pipeline/model.R        R twin of js/model.js, breakeven, scoring rules
pipeline/01_statcast.R  Savant search CSV in 4-day chunks -> PAs, RE24, candidate plays
pipeline/02_feeds.R     MLB game feed per game -> label (safe/out/held/...) and Savant playId
pipeline/03_players.R   sprint speed + arm strength leaderboards, names, features
pipeline/04_fit.R       MLE fit, 5-fold CV, calibration, coaches-vs-model table, charts
pipeline/05_clips.R     pool selection, clip URL lookup
pipeline/06_write.R     data/plays.js + pipeline/out/*.csv
pipeline/out/           committed analysis outputs (CSV, JSON, PNG)
pipeline/cache/         git-ignored download cache
```

Scripts load in this order: `data/plays.js` → `model.js` → `store.js` → `field.js` → `game.js`.

## Game state machine (`game.js`)

`login` → `approach` (animate 0 → `decisionT`) → `decide` (frozen frame + clock) → `resolve` (animate the send; or, on a hold or timeout, the hold animation and then a faded "ghost" replay of the real send) → `reveal` (verdict, model numbers, clip; Enter or the button goes to the next play).

`decide("timeout")` counts as wrong. On a timeout the coach shows no signal and the runner pulls up like a hold. The clip's `<video>` is created at the start of each play so it buffers during the animation. Clips start muted; once a visitor unmutes one, later clips try to play with sound (`windmill.sound`).

Animation is driven by `requestAnimationFrame` with wall-clock time, so a backgrounded tab freezes the animation but not the clock. When testing in a headless or hidden browser pane, rAF may not fire at all.

## The timing model (`model.js` / `model.R`)

Times are in seconds after contact. Coordinates are in feet, with home at (0,0) and +y toward center field.

- Runner: lead = 15 ft (+8 with 2 outs). He starts after `readDelay` (+`lineDriveFreeze` on liners with fewer than 2 outs; `twoOutStart` with 2 outs). His speed is `sprint_speed × speedFactor`, and he loses `turnLoss` rounding third. `tHome` is when he reaches the plate.
- Ball: travel time = distance / (launch_speed × ballFactor[type]), clamped to 1.6–5.0 s. Release = field time + `exchange`. Throw speed = arm_mph × 1.4667 × `throwCarry`.
- `margin = throwArrive + tagTime − tHome` (seconds); `logit pSafe = calibIntercept + calibSlope × margin`.
- `decisionT = clamp(min(tField + 0.15, tAt3B − 0.2), ≥ 0.9)`.

**Fitted:** `calibIntercept`, `calibSlope`: `glm(safe ~ margin, binomial)` on every labeled send (`04_fit.R`). **Hand-set:** everything else in `K` (they drive the animation). Hand-set defaults for the calibration are 0 and 1/0.28.

Caveat to keep stating: the fit is on sends only, so it's P(safe | coach sent him). It says nothing reliable about holds, which is why the coach table compares coaches with breakeven directly.

**Results (full run, Oct 23 2026; 2024–2026 incl. postseason through Oct 19):**
- 559,650 PAs, 7,413 games, 9,094 candidates. Feed labels: 6,323 safe, 205 out, 2,524 held, 20 error, 19 unclear, 3 out elsewhere. 6,472 sends with features (16 imputed sprint speeds, 280 imputed arms). Pool: 1,704 plays (all 204 outs + 1,500 safes, 27 postseason), 1,703 with a clip.
- Calibration: `logit P = 2.84 (SE 0.10) + 0.516 (SE 0.07) × margin`. 5-fold CV: Brier 0.0304 vs. 0.0305 flat rate, log loss 0.136 vs. 0.140, AUC 0.664. The hand-set physics ranks plays the same (AUC 0.665) but is badly calibrated (Brier 0.073).
- Pieces of the margin (`model_terms.csv`, logistic regression): runner time −1.46/s (z −6.0) and ball-to-fielder time +0.65/s (z +4.5) carry the signal; throw time from arm and distance doesn't (z 0.7) once coaches have filtered who to send; two outs −0.45 (z −2.9), i.e. two-out sends are riskier.
- Coaches vs. breakeven (`coach_decisions.csv`): 0 outs send 48%, sends score 97.6%, breakeven 74%; 1 out 62% / 96.7% / 62%; 2 outs 94% / 96.7% / 43%. Coaches send only near-sure things, far above breakeven with 0–1 outs.
- **Consequence for the game (open question for Jacob):** every pool play's P(safe) is 0.95–0.98, above every breakeven, so the reveal's "by the numbers" line calls every play a send. Honest, but the process grade never varies.

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

`PLAYS_META`: `{ demo, seasons, built, ref: { speed: {min,max,avg}, arm: {min,max,avg} }, n_safe, n_out, n_postseason, game_types }`. `ref` drives the scouting meters (2nd/98th percentile of regulars). `MODEL_FIT`: `{ K: { calibIntercept, calibSlope }, n, n_out, seasons, metrics: { base_rate, hand_tuned, fitted_cv: { log_loss, brier, auc } } }`; the About dialog quotes it.

## Pipeline (`Rscript pipeline/run.R`)

Seasons 2024–2026, regular season plus postseason (`config.R`). First run downloads ~170 Savant search chunks (~45 s each), ~6,000 game feeds and ~2,000 Savant video pages; everything is cached, and reruns take a couple of minutes. Chunks ending in the last two days aren't cached, so in-progress postseason games refresh.

1. **Statcast** (`01`): Savant search CSV (`hfGT=R|PO|`), 4-day chunks, split in half and re-pulled if a chunk hits the 25k row cap. Keeps only PA-ending pitches. RE24 from regular-season PAs, skipping the bottom of the 9th and later. Candidates: `events == "single"`, runner on 2nd, 3rd empty, `hit_location` 7/8/9, has `hc_x/hc_y`, no error/interference/obstruction in `des`.
2. **Labels** (`02`): `statsapi.mlb.com/api/v1/game/{pk}/playByPlay` with a `fields=` filter (~100 KB/game). Play = `atBatIndex == at_bat_number − 1`. The runner from 2nd (`on_2b` id) is tracked across all his movement rows: scored → `safe`; out with `outBase == "4B"` and an outfielder credited `f_assist_of`/`f_assist` → `out`; out at home without an OF assist → `out_no_of_assist` (rundowns, excluded); out elsewhere → `out_elsewhere`; ends at 3B → `held`; any error credit → `error`. playId = last pitch event's `playId`. Disagreements with the description-regex label go to `out/label_check.csv` for spot checks.
3. **Players** (`03`): Savant sprint-speed (`player_id`, `sprint_speed`, `competitive_runs`) and arm-strength (`player_id`, `arm_of`, fallback `arm_overall`, `total_throws_of`) leaderboard CSVs per season; postseason plays use that season's numbers. Missing → league average + `*_imputed`. Names from `statsapi.mlb.com/api/v1/people`. Hit coordinates to feet: `x = (hc_x − 125.42) × 2.5`, `y = (198.27 − hc_y) × 2.5`; keeps y > 120 ft.
4. **Fit** (`04`): see the model section. Writes `model_fit.json`, `model_terms.csv`, `model_calibration.csv`, `coach_decisions.csv`, `calibration.png`, `p_safe_by_result.png`, `coaches_vs_breakeven.png`.
5. **Clips** (`05`): pool = every `out` send + up to 1,500 seeded-random `safe` sends with a playId. Clip URL = first `https://sporty-clips.mlb.com/...mp4` on `baseballsavant.mlb.com/sporty-videos?playId=`, cached raw in `cache/clip_urls.csv` and HTML-unescaped on use (base64 padding arrives as `&#x3D;`; 134 of 1,704 URLs were broken before that fix).
6. **Write** (`06`): `data/plays.js`, `out/sends.csv`, `out/re24.csv`, `out/send_summary_by_outs.csv`.

## Visual design

Concept: a painted-steel ballpark **manual scoreboard**. Deep green board with a rivet line, stencil numerals, and foul-pole yellow for the Send button and the streak. Keep this identity.

- Tokens: `--board #1e3a2b`, `--board-deep #142a1e`, `--board-line #2d5240`, `--chalk #eef0e8`, `--chalk-dim #a9bcae`, `--signal #f2c230`, `--out #e0553f`, `--clay #9a6743`.
- Fonts (Google Fonts): Saira Stencil One (display numerals and headings), Barlow Condensed (labels and buttons), Barlow (body).
- Copy is sentence case and plain: "Send him", "Hold him", "Next play", "Right call. Streak: 3." No all-caps labels and no arrows on buttons.
- Phone (≤560px): scout panel becomes a compact two-column card *above* the field, so the read, the field, and both buttons fit on one screen. The ≤980px layout stacks with the panel first.
- The R charts use the same palette (`theme_board()` in `04_fit.R`).

## Verified so far (Oct 2026, Windows, local static server + in-app Chromium)

- Full 2024–2026 pipeline run end to end (first run 39 min with parallel Statcast prefetch; cached reruns ~2 min). All 6 feed-vs-description label disagreements are the case the feed exists for: the runner from 2nd scored and a trailing runner was out at home.
- Game loop at 1440×900 and 375×812: login, approach, decide, send, reveal with the MLB clip over the field, autoplaying; hold with ghost replay; 3-second timeout; timer persists. Desktop fits in 900px with no scroll; on phones the read, field and both buttons fit on one screen and the clip is on screen under the verdict. No console errors; R/JS parity max difference 5e-5. 40 sampled clip URLs (20 random, 20 previously broken) all load cross-origin.
- Fixed in the rebuild: the ≤980px layout collapsed the field to a narrow column; HTML-escaped clip URLs; description-regex labels.
- Testing note: the in-app browser pane must be visible for rAF to run, and screenshots of a large emulated viewport in a narrow pane are unreadable; measure layout in JS or snapshot the canvas with `toBlob`.

## Next steps (priority order)

1. **Publish** to GitHub Pages (GitHub account: `gearity`; gh is signed in); set absolute `og:image` / `og:url` once the URL is known; add the live link to the README.
2. **Decide what the "by the numbers" grade should say** now that the calibrated model calls every pool play a send (see results above).
3. **Model features worth trying:** hang time from launch angle for air balls instead of the flat `ballFactor`; using the per-piece regression (`model_terms.csv`) as the game's model instead of the single margin.
4. **The LinkedIn write-up (Jacob explicitly asked to be reminded).** Lead with `coaches_vs_breakeven.png`: with 0 outs coaches send 48% of the time and those sends score 97.6%, against a 74% breakeven, so they're holding runners who'd usually score (the known "coaches are too conservative" finding, on 2024–26 data). Support with `send_summary_by_outs.csv` and the finding that arm strength doesn't separate safe from out among sends. Match the voice of his "Scottie Effect" post: a punchy, specific question, a clear finding, and a chart.

Nice-to-haves (only if asked): a shared leaderboard (Supabase or Firebase free tier, inside `Store`), daily-challenge mode with a fixed seed, a "coach report" after a streak ends (aggressive vs. conservative tendency), sound effects, and runners going from first to third.

## Conventions

- Vanilla JS in IIFEs that expose `window.WM`, `window.Store`, and `window.Field`. No framework, bundler, or npm.
- Every `localStorage` call goes through `Store` and is wrapped in try/catch.
- Keep model constants in `K` with a comment on each, mirror them in `model.R`, and keep the README and About dialog in sync when the model changes.
- The R code uses tidyverse style with the native pipe `|>` (R ≥ 4.1), and caches every network call.
- Run the pipeline from the repo root; it refuses to run elsewhere.
