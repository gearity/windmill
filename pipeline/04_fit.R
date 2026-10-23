# Step 4: calibrate the timing model on real sends, and compare coaches with breakeven.
# -----------------------------------------------------------------------------
# logit P(safe) = calibIntercept + calibSlope * margin, where margin = throw arrival
# + tag minus the runner's arrival in seconds (model.R). The two coefficients are a
# logistic regression on every real send (see FIT_PARAMS in model.R for why only
# those two). A second regression on the margin's pieces shows which ones carry
# signal.
#
# These are sends only. Coaches send when they like the odds, so this estimates
# P(safe | the coach sent him), which is the call the game asks you to make. It says
# nothing reliable about holds, so the coach table below compares coaches with
# breakeven directly.
#
# Output objects: K_FIT, model_fit, sends$p_model, holds$p_model, coach_tbl.
# Files: pipeline/out/model_fit.json, model_terms.csv, model_calibration.csv,
#        coach_decisions.csv, calibration.png, p_safe_by_result.png, coaches_vs_breakeven.png

sends <- sends |> mutate(margin = model_times(sends)$margin)   # physics only, before calibration
fit_model <- function(d) glm(safe ~ margin, family = binomial, data = d)

fit <- fit_model(sends)
coefs <- unname(coef(fit)); se <- unname(sqrt(diag(vcov(fit))))
K_FIT <- with_params(round(coefs, 4))   # rounded: these exact values ship to the game

fit_tbl <- tibble(param = FIT_PARAMS, hand_tuned = round(unlist(K_DEFAULT[FIT_PARAMS]), 4),
                  fitted = round(coefs, 4), se = round(se, 4))
message("Fitted calibration:"); print(fit_tbl)

# --- Out-of-sample check: 5-fold CV, stratified by outcome ---------------------
set.seed(POOL_SEED)
sends <- sends |>
  group_by(safe) |> mutate(fold = sample(rep(1:5, length.out = n()))) |> ungroup()
oof <- oof_base <- numeric(nrow(sends))
for (k in 1:5) {
  tr <- sends$fold != k
  oof[!tr] <- predict(fit_model(sends[tr, ]), sends[!tr, ], type = "response")
  oof_base[!tr] <- mean(sends$safe[tr])
}
p_hand <- model_times(sends)$p_safe
score <- function(p) list(log_loss = round(log_loss(sends$safe, p), 4), brier = round(brier(sends$safe, p), 4),
                          auc = round(auc(sends$safe, p), 3))
metrics <- list(base_rate = score(oof_base), hand_tuned = score(p_hand), fitted_cv = score(oof))
message("Out-of-sample scores:"); print(bind_rows(metrics, .id = "model"))

# --- Signal in each piece of the margin ---------------------------------------------
# Same physics, but each piece gets its own coefficient. If the model is right, ball
# and throw time push toward safe (+) and run time toward out (-).
terms_df <- sends |>
  mutate(t_ball = model_times(sends)$t_field,
         t_throw = sqrt(x_ft^2 + y_ft^2) / (arm_mph * MPH_TO_FPS),
         t_run = (180 - K_DEFAULT$leadFt - ifelse(outs == 2, K_DEFAULT$twoOutBonusFt, 0)) / sprint_speed,
         two_outs = outs == 2)
terms_fit <- glm(safe ~ t_ball + t_throw + t_run + two_outs + runner_on_first, family = binomial, data = terms_df)
model_terms <- as_tibble(summary(terms_fit)$coefficients, rownames = "term") |>
  setNames(c("term", "estimate", "se", "z", "p")) |>
  mutate(across(where(is.double), \(x) signif(x, 3)))
write_csv(model_terms, file.path(OUT, "model_terms.csv"))
message("Logistic regression on the margin's pieces:"); print(model_terms)

sends <- sends |>
  mutate(p_model = model_times(sends, K_FIT)$p_safe, p_oof = oof,
         breakeven = breakeven(outs, runner_on_first, re24))
holds <- holds |>
  mutate(p_model = model_times(holds, K_FIT)$p_safe, breakeven = breakeven(outs, runner_on_first, re24))

calib <- sends |>
  mutate(bin = ntile(p_oof, 10)) |>
  group_by(bin) |>
  summarise(predicted = mean(p_oof), observed = mean(safe), n = n(), .groups = "drop")
write_csv(calib, file.path(OUT, "model_calibration.csv"))

model_fit <- list(
  K = as.list(setNames(round(coefs, 4), FIT_PARAMS)),
  se = as.list(setNames(round(se, 4), FIT_PARAMS)),
  n = nrow(sends), n_out = sum(sends$safe == 0),
  seasons = paste(unique(range(SEASONS)), collapse = "-"),
  metrics = metrics
)
write_json(model_fit, file.path(OUT, "model_fit.json"), auto_unbox = TRUE, pretty = TRUE, digits = NA)

# --- Real coaches vs. breakeven ------------------------------------------------------
# This part needs no model. If sends succeed far more often than breakeven requires,
# coaches are holding runners who would usually have scored.
coach <- bind_rows(sends |> mutate(call = "send"), holds |> mutate(call = "hold"))
coach_tbl <- bind_rows(coach |> mutate(outs = as.character(outs)), coach |> mutate(outs = "all")) |>
  group_by(outs) |>
  summarise(
    decisions = n(),
    send_rate = mean(call == "send"),
    safe_rate_on_sends = mean(safe[call == "send"]),
    breakeven = mean(breakeven),
    .groups = "drop"
  ) |>
  mutate(cushion = safe_rate_on_sends - breakeven,
         across(where(is.double), \(x) round(x, 3)))
write_csv(coach_tbl, file.path(OUT, "coach_decisions.csv"))
message("Real coaches vs. breakeven:"); print(coach_tbl)

# --- Charts -----------------------------------------------------------------------
theme_board <- function() {
  theme_minimal(base_size = 13) +
    theme(plot.background = element_rect(fill = "#1e3a2b", colour = NA),
          panel.grid = element_line(colour = "#2d5240"), panel.grid.minor = element_blank(),
          text = element_text(colour = "#eef0e8"), axis.text = element_text(colour = "#a9bcae"),
          plot.title = element_text(face = "bold", size = 16), plot.subtitle = element_text(colour = "#a9bcae"),
          plot.caption = element_text(colour = "#a9bcae", size = 9), legend.position = "top",
          plot.margin = margin(16, 20, 12, 16))
}
caption <- sprintf("%d real MLB sends from second on outfield singles, %s. Data: MLB Statcast via Baseball Savant.",
                   nrow(sends), model_fit$seasons)

g1 <- ggplot(calib, aes(predicted, observed)) +
  geom_abline(colour = "#a9bcae", linetype = "dashed") +
  geom_point(aes(size = n), colour = "#f2c230") +
  scale_x_continuous(labels = scales::percent, limits = c(min(calib$predicted, calib$observed) - 0.03, 1)) +
  scale_y_continuous(labels = scales::percent, limits = c(min(calib$predicted, calib$observed) - 0.03, 1)) +
  scale_size_area(max_size = 6, guide = "none") +
  coord_equal() +
  labs(title = "Timing model: predicted vs. actual chance he scores",
       subtitle = sprintf("Out-of-sample deciles. Brier %.3f vs. %.3f for a flat rate; AUC %.2f.",
                          metrics$fitted_cv$brier, metrics$base_rate$brier, metrics$fitted_cv$auc),
       x = "Model: chance he scores", y = "Actually scored", caption = caption) +
  theme_board()
ggsave(file.path(OUT, "calibration.png"), g1, width = 7, height = 7, dpi = 150)

g2 <- ggplot(sends, aes(p_model, fill = ifelse(safe == 1, "Safe", "Out at home"))) +
  geom_histogram(aes(y = after_stat(density)), position = "identity", alpha = 0.7, bins = 30, colour = NA) +
  scale_fill_manual(values = c(Safe = "#f2c230", `Out at home` = "#e0553f"), name = NULL) +
  scale_x_continuous(labels = scales::percent) +
  labs(title = "Model P(safe) for runners who scored vs. runners thrown out",
       x = "Model: chance he scores", y = NULL, caption = caption) +
  theme_board() + theme(axis.text.y = element_blank())
ggsave(file.path(OUT, "p_safe_by_result.png"), g2, width = 8, height = 5, dpi = 150)

by_outs <- coach_tbl |> filter(outs != "all") |>
  mutate(outs = factor(paste(outs, ifelse(outs == "1", "out", "outs")), levels = c("0 outs", "1 out", "2 outs")))
g3 <- ggplot(by_outs, aes(y = outs)) +
  geom_segment(aes(x = breakeven, xend = safe_rate_on_sends, yend = outs), colour = "#2d5240", linewidth = 6) +
  geom_point(aes(x = breakeven), colour = "#a9bcae", size = 5) +
  geom_point(aes(x = safe_rate_on_sends), colour = "#f2c230", size = 6) +
  geom_text(aes(x = breakeven, label = paste0("Needed ", scales::percent(breakeven, 1))),
            colour = "#a9bcae", vjust = -1.4, size = 3.8) +
  geom_text(aes(x = safe_rate_on_sends, label = paste0("Sends scored ", scales::percent(safe_rate_on_sends, 1))),
            colour = "#f2c230", vjust = -1.4, hjust = 0.8, size = 3.8) +
  geom_text(aes(x = 0.3, label = paste0("Sent ", scales::percent(send_rate, 1), " of the time")),
            colour = "#eef0e8", hjust = 0, vjust = 2.2, size = 3.6) +
  scale_x_continuous(labels = scales::percent, limits = c(0.3, 1.02)) +
  scale_y_discrete(limits = rev) +
  labs(title = "Third base coaches only send near-sure things",
       subtitle = "Runner on second, single to the outfield: how often sends scored vs. the success rate that breaks even",
       x = NULL, y = NULL,
       caption = sprintf("%s decisions (%s sends, %s holds), %s. Breakeven from RE24 on the same seasons.",
                         format(nrow(coach), big.mark = ","), format(nrow(sends), big.mark = ","),
                         format(nrow(holds), big.mark = ","), model_fit$seasons)) +
  theme_board()
ggsave(file.path(OUT, "coaches_vs_breakeven.png"), g3, width = 9, height = 5, dpi = 150)
