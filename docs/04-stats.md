# 04 — Statistics

Two tiers. **Classical** stats need only scores, so they work in a fully manual
game and are directly comparable with what every other app and every TV
broadcast shows. **Positional** stats need `pos` on each dart, which is what the
autoscorer produces — these are the ones worth building this project for.

Everything is computed in `packages/core/src/stats/` from the event log, with no
stored aggregates, so a fixed bug retroactively fixes history.

## Tier 1 — classical

### Scoring power

| Stat | Definition |
|---|---|
| **3-dart average** (PPR, points per round) | `points scored ÷ darts thrown × 3`, over whole legs. Darts thrown in a busted visit count, and the bust scores 0 — this is the standard definition and it is why a bust hurts the average twice. |
| **Points per dart (PPD)** | The same number ÷ 3. Shown for players who prefer it. |
| **First 9 average** | 3-dart average over the first three visits of each leg. Separates scoring power from finishing; the classic diagnostic for "great average, never wins". |
| **Scoring average** | Average over visits thrown while the remaining score is above the checkout range (> 170 by default, configurable). Excludes the setup/finishing phase entirely. |
| **Best / worst visit**, **best leg average** | |
| **Ton counts** | 60+, 80+, 100+ (tons), 133+ (ton-plus tiers), 140+, 170+ (ton-eighty is 180). Counted per visit, reported per leg and per session. |
| **180s** | Its own counter, and 180s per leg. |
| **High score rate** | % of visits ≥ 100 and ≥ 140. More stable than counting on short samples. |

### Finishing

| Stat | Definition |
|---|---|
| **Checkout %** | `doubles hit ÷ darts thrown at a double`. A dart counts as *thrown at a double* when, at the moment it was thrown, the remaining score was finishable with that single dart under the out rule (≤ 40 and even, or 50, for double-out). This is the standard definition; it is not "legs won ÷ legs where you had a shot". |
| **Darts at double per leg** | How many finishing darts a leg costs. Pairs with checkout % to separate "I never get a shot" from "I get shots and miss". |
| **First-dart-at-double %** | Hit rate on the *first* dart of a finishing visit, which is the one thrown without pressure of running out of darts. |
| **Per-double hit rate** | D20, D16, D12, D10, D8, D4, D2, D1, bull, … each tracked separately, with attempts, so "favourite double" and "danger double" are evidence, not folklore. |
| **Checkout distribution** | Finishes bucketed 2–40, 41–60, 61–80, 81–100, 101–120, 121–140, 141–170, with the hit rate of each. |
| **Highest checkout**, **finishes over 100** | |
| **Bogey / bust stats** | Busts per leg, and which scores caused them. Busting from 50 twice a night is a rules-knowledge problem, not a throwing problem. |

### Legs and matches

| Stat | Definition |
|---|---|
| **Darts per leg** | Mean and best. The single most complete measure of a player, because it folds scoring and finishing together. |
| **Legs won %**, **first-9 leg win correlation** | |
| **Throw-first advantage** | Win rate when throwing first vs second, i.e. how often you hold and how often you break. |
| **Leg-by-leg timeline** | A match is drawn as a race chart of remaining scores, so you can see where it was lost. |

### Form over time

- Session average, with a rolling 5/10-session trend.
- Average by leg index within a session (fatigue), and by visit index within a
  leg (starts fast, finishes slow?).
- Average by hour of day, if there is enough data to be meaningful.
- **Pressure split**: average and checkout % when the opponent is on a finish,
  versus not. Requires nothing extra — it comes from the event log.

## Tier 2 — positional

These need `pos` (millimetres from board centre). Manual taps supply a coarse
version; the camera supplies the real thing. Stats that would be misleading from
tapped positions are marked ⚑ and are only computed over camera-sourced darts.

| Stat | What it says |
|---|---|
| **Heatmap** | Kernel-density map of where darts land, for a leg, a session, all time, or filtered to one intended target. Drawn over the board, not next to it. |
| **Grouping (σ)** ⚑ | Standard deviation in mm of darts around their own centroid, split into `σ_along` (up/down the sector) and `σ_across` (left/right), because those have different causes — release timing versus alignment. |
| **Bias vector** ⚑ | Offset of the centroid from the intended target: "your T20 attempts land on average 6 mm low and 3 mm left". Actionable in a way that "checkout % 38" is not. |
| **Visit group size** ⚑ | Largest pairwise distance between the three darts of a visit. The stat that improves when your rhythm is right. |
| **T20 sector breakdown** | Of darts aimed at T20: % in the treble, % in the 20 bed, % in 5, % in 1, % elsewhere. The single most useful practice stat for a scorer. |
| **Double miss direction** ⚑ | When a double is missed, where did it go: inside (the single bed), outside (off the board), or into a neighbouring segment. Missing D20 *high* and missing it *left* need opposite fixes. |
| **Wire rate** ⚑ | Fraction of darts landing within 1.5 mm of a wire. High wire rate with a good bias means you are closer than the scoreboard suggests. |
| **Skill σ and optimal aim map** ⚑ | See below. |
| **Rhythm** | Seconds between darts and per visit, from event timestamps, correlated with score. Camera mode gets this for free. |

### Skill σ and the personalised aim map

From Tibshirani, Price & Taylor, *A statistician plays darts* (JRSS-A, 2011): a
throw is modelled as a 2-D Gaussian around the intended aim point, the
covariance is estimated by EM from observed landing positions, and the expected
score of aiming at each point on the board is then computed by convolving the
board's score function with that Gaussian.

The output is a heatmap of *expected points per dart for every aim point*, with
your own spread — and its maximum is where you should actually aim. The paper's
headline result is that T20 is only optimal for players with a tight group;
recreational players score more by aiming at T19, and beginners by aiming at the
centre of the board, because the neighbours of 19 (7 and 3) are kinder than the
neighbours of 20 (1 and 5).

Nothing else in a darts app can tell a player this, and it needs exactly what
the autoscorer produces. It is the flagship statistic of this project.

Implementation notes: estimate a full 2×2 covariance (not an isotropic σ) per
player over a rolling window of camera-scored darts; require a minimum sample
(~100 darts) before showing a map; recompute lazily in a Worker; render the map
at 2 mm resolution over the board SVG.

## Presentation rules

- Every stat shows its sample size. "Checkout 100%" from two darts is noise and
  must look like noise.
- Classical stats are comparable to other apps; where a definition is contested
  (checkout %, ton counting), the definition used is written next to the number.
- Positional stats explain themselves in one sentence of plain language: not
  `σ_across = 11.2 mm` alone, but "your darts spread about a thumb's width
  left-to-right".
- Everything is filterable by: player, date range, game mode, and
  `source` (manual / voice / camera), so nobody is comparing tapped positions
  with camera ones by accident.
