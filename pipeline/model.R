# The timing model: R twin of js/model.js.
# -----------------------------------------------------------------------------
# Keep this file and js/model.js in lockstep. Every play written to data/plays.js
# carries the p_model computed here, and the game warns in the console if its own
# number drifts from it by more than 0.002.
#
# Times are seconds after contact. Distances are feet, home plate at (0, 0).

MPH_TO_FPS <- 1.4667

K_DEFAULT <- list(
  leadFt = 15,            # secondary lead off second at contact
  twoOutBonusFt = 8,      # extra ground with two outs (running on contact)
  readDelay = 0.15,       # seconds before the runner commits (ball read)
  lineDriveFreeze = 0.20, # extra hesitation on line drives with fewer than two outs
  twoOutStart = 0.05,     # with two outs he goes on contact
  speedFactor = 0.95,     # average speed over the run vs. Statcast sprint speed (top speed)
  turnLoss = 0.20,        # seconds lost rounding third
  exchange = 0.75,        # seconds from fielding the ball to release
  throwCarry = 0.70,      # average throw velocity vs. max-effort arm strength (drag, hop)
  tagTime = 0.12,         # catch-and-tag
  calibIntercept = 0,     # logit P(safe) at a zero margin
  calibSlope = 1 / 0.28,  # logit P(safe) per second of margin
  ballFactor = c(ground_ball = 0.42, line_drive = 0.50, fly_ball = 0.45, popup = 0.40),
  ballFactorOther = 0.55
)

# The constants fit on real sends (04_fit.R): only the calibration, a logistic
# regression of safe on the physics margin. The physical constants stay hand-set.
# On 2024-26 sends a fit that also freed throwCarry and speedFactor drifted to the
# edges of their ranges with huge standard errors and scored worse out of sample:
# 97% of sends score, so the data can't pin them down, and they drive the animation.
FIT_PARAMS <- c("calibIntercept", "calibSlope")

# d needs: outs, bb_type, x_ft, y_ft, launch_speed, sprint_speed, arm_mph
model_times <- function(d, K = K_DEFAULT) {
  lead <- K$leadFt + ifelse(d$outs == 2, K$twoOutBonusFt, 0)
  v <- d$sprint_speed * K$speedFactor
  start <- ifelse(d$outs == 2, K$twoOutStart,
                  K$readDelay + ifelse(d$bb_type == "line_drive", K$lineDriveFreeze, 0))
  t_at3b <- start + (90 - lead) / v
  t_home <- t_at3b + K$turnLoss + 90 / v

  dist <- sqrt(d$x_ft^2 + d$y_ft^2)
  ls <- ifelse(is.na(d$launch_speed) | d$launch_speed <= 0, 92, d$launch_speed) * MPH_TO_FPS
  bf <- unname(K$ballFactor[d$bb_type])
  bf[is.na(bf)] <- K$ballFactorOther
  t_field <- pmin(5, pmax(1.6, dist / (ls * bf)))
  release <- t_field + K$exchange
  throw_arrive <- release + dist / (d$arm_mph * MPH_TO_FPS * K$throwCarry)

  margin <- throw_arrive + K$tagTime - t_home   # > 0: runner beats the tag
  tibble(t_home = t_home, t_field = t_field, throw_arrive = throw_arrive,
         margin = margin, p_safe = plogis(K$calibIntercept + K$calibSlope * margin))
}

with_params <- function(par, K = K_DEFAULT) modifyList(K, as.list(setNames(par, FIT_PARAMS)))

# Run expectancy lookup. re24 is a named list: state -> c(outs0, outs1, outs2).
re_value <- function(re24, state, outs) {
  vapply(seq_along(state), \(i) if (outs[i] >= 3) 0 else re24[[state[i]]][outs[i] + 1], numeric(1))
}

# Breakeven P(safe) for sending the runner from second on a base hit. Each real hold or
# send is worth its runs plus the RE24 of the bases and outs it left, so trailing runners
# count where they actually ended up. (On safe sends the batter stays at first about 9
# times in 10; assuming everyone takes an extra base on the throw overstates what a send
# is worth.) Within each outs and runner-on-first cell, with V the average value of holds,
# safe sends and outs at home:
#   breakeven = (V_hold - V_out) / (V_safe - V_out)
# d needs: outs, runner_on_first, label ("held", "safe", "out"), runs_on_play, outs_on_play, bases_after
breakeven_table <- function(d, re24) {
  d |>
    mutate(value = runs_on_play + re_value(re24, bases_after, outs + outs_on_play)) |>
    group_by(outs, runner_on_first) |>
    summarise(n = n(), v_hold = mean(value[label == "held"]), v_safe = mean(value[label == "safe"]),
              v_out = mean(value[label == "out"]), .groups = "drop") |>
    mutate(breakeven = pmin(0.99, pmax(0.01, (v_hold - v_out) / (v_safe - v_out))))
}

# Scoring rules
log_loss <- function(y, p) { p <- pmin(pmax(p, 1e-9), 1 - 1e-9); -mean(y * log(p) + (1 - y) * log(1 - p)) }
brier <- function(y, p) mean((p - y)^2)
auc <- function(y, p) {   # Mann-Whitney
  r <- rank(p); n1 <- sum(y == 1); n0 <- sum(y == 0)
  (sum(r[y == 1]) - n1 * (n1 + 1) / 2) / (n1 * n0)
}
