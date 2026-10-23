# Windmill: a third base coach simulator

A runner is rounding third on a base hit. You have five seconds. Send him or hold him.

Every play is a real MLB play from 2024–2026 (postseason included) where the third base coach waved the runner home from second on a single to the outfield. You watch it develop on an animated field, make the call as the runner nears third, and then see what actually happened, including the broadcast clip. Build a streak of correct calls.

![Windmill](og-image.png)

## How a play is graded

| Your call | What really happened | Streak |
|---|---|---|
| Send | Safe | Continues |
| Hold | Out at the plate | Continues |
| Send | Out at the plate | Over |
| Hold | Safe | Over |
| Clock runs out | Either | Over |

Coaches send mostly when it's safe, so the game draws safe and out plays 50/50. Otherwise sending every time would win.

After each call the game also grades the *decision*. A timing model compares the runner's time to the plate (Statcast sprint speed) with the ball's time to the plate (where it was fielded, and the outfielder's Statcast arm strength), and turns the gap into a probability he scores. That probability is compared with the breakeven for the number of outs, computed from a run expectancy (RE24) table. The streak is graded on the result; the model grades the process.

## What the data says

From 8,982 real decisions in 2024–2026 (runner on second, third base open, single to the outfield):

![Coaches vs. breakeven](pipeline/out/coaches_vs_breakeven.png)

- **Coaches only send sure things.** With nobody out they send 48% of the time, and those sends score 97.6%, against a breakeven of 74%. With two outs they send 94% of the time and still score 96.7%, against a breakeven of 43%. Sends that clear breakeven by that much mean coaches are holding runners who would usually have scored.
- **What separates the 3% thrown out:** in a logistic regression on the pieces of the timing model, the runner's time to the plate and how fast the ball reached the outfielder matter; the outfielder's arm strength and throw distance don't, once coaches have already chosen whom to send. Two-out sends are riskier.
- **The model is honest about its limits.** Calibrated on 6,472 sends (204 outs), it ranks a thrown-out runner below a safe one 66% of the time out of sample, and its probabilities stay calibrated, but because nearly every send scores it barely beats guessing the league rate (Brier 0.0304 vs. 0.0305). Charts and tables are in `pipeline/out/`.

## Running it

It's a static site with no build step. Double-click `index.html`, or serve the folder with any static server. Online, it runs on GitHub Pages straight from the repo root.

## Rebuilding the data

Requires R ≥ 4.1 with:

```r
install.packages(c("dplyr", "purrr", "stringr", "readr", "tidyr", "jsonlite", "httr2", "ggplot2"))
```

From the repo root:

```bash
Rscript pipeline/run.R
```

The first run downloads Statcast, the MLB game feeds, and the leaderboards (over an hour); everything is cached in `pipeline/cache/`, so reruns take a couple of minutes. Settings (seasons, pool size) are in `pipeline/config.R`.

| Step | File | What it does |
|---|---|---|
| 1 | `01_statcast.R` | Pulls every plate appearance from Baseball Savant in 4-day chunks; computes RE24; finds singles to the outfield with a runner on second and third base open |
| 2 | `02_feeds.R` | Reads the MLB game feed for each play to see what the runner from second actually did: scored, thrown out at home by the outfielder, or held at third |
| 3 | `03_players.R` | Joins Statcast sprint speed and outfield arm strength for that season |
| 4 | `04_fit.R` | Calibrates the timing model with a logistic regression, cross-validates it, and compares real coaches with breakeven |
| 5 | `05_clips.R` | Picks the play pool and finds each play's broadcast clip on Baseball Savant |
| 6 | `06_write.R` | Writes `data/plays.js` and the CSVs in `pipeline/out/` |

Labels come from the game feed's runner movements rather than the play description, which can't tell a runner from second apart from a runner from first, or a rundown from a throw home. `pipeline/out/label_check.csv` lists the plays where the two disagree.

Clips stream from MLB's servers in the visitor's browser; nothing is rehosted. A clip saved by hand as `clips/<play_id>.mp4` takes priority.

## Files

```
index.html, css/, js/    the game (model.js, store.js, field.js, game.js)
data/plays.js            generated play data, RE24, and fitted model constants
pipeline/                R data pipeline; out/ holds the analysis tables and charts
clips/                   optional hand-saved clips
```

Built by Jacob Gearity. Data from MLB Statcast via Baseball Savant and the MLB Stats API. Not affiliated with MLB.
