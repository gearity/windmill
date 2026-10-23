# Step 3: sprint speed, arm strength, and names.
# -----------------------------------------------------------------------------
# Sprint speed and arm strength come from the Savant leaderboard CSVs, per season.
# Postseason plays use that season's regular-season numbers. Players missing from
# a leaderboard get the league average and an *_imputed flag, which the game shows.
# Names come from the MLB people endpoint.
# Output objects: speed, arms, ref, sends (labelled sends with features), holds.

read_savant_csv <- function(url, f) {
  cache_rds(f, { d <- read_csv(I(http_get(url)), show_col_types = FALSE); Sys.sleep(1); d })
}

need_col <- function(d, col) {
  if (!col %in% names(d)) stop("Column '", col, "' not in Savant leaderboard. Columns: ", paste(names(d), collapse = ", "))
  d[[col]]
}

speed <- map_dfr(SEASONS, function(yr) {
  d <- read_savant_csv(
    sprintf("https://baseballsavant.mlb.com/leaderboard/sprint_speed?year=%s&position=&team=&min=0&csv=true", yr),
    file.path(CACHE, sprintf("sprint_%s.rds", yr)))
  tibble(season = as.integer(yr), id = as.numeric(need_col(d, "player_id")),
         sprint_speed = as.numeric(need_col(d, "sprint_speed")),
         runs = as.numeric(need_col(d, "competitive_runs")))
})

arms <- map_dfr(SEASONS, function(yr) {
  d <- read_savant_csv(
    sprintf("https://baseballsavant.mlb.com/leaderboard/arm-strength?type=player&year=%s&minThrows=0&pos=&team=&csv=true", yr),
    file.path(CACHE, sprintf("arm_%s.rds", yr)))
  # Outfield max-effort arm strength; overall arm strength if he barely played the outfield.
  tibble(season = as.integer(yr), id = as.numeric(need_col(d, "player_id")),
         arm_mph = coalesce(as.numeric(need_col(d, "arm_of")), as.numeric(need_col(d, "arm_overall"))),
         of_throws = as.numeric(need_col(d, "total_throws_of")))
})

# League reference points for the scouting meters: regulars only, so a handful of
# pinch runners and position-player cameos don't drag the average around.
reg_speed <- speed |> filter(runs >= 10, !is.na(sprint_speed))
reg_arm <- arms |> filter(of_throws >= 10, !is.na(arm_mph))
ref <- list(
  speed = list(min = round(quantile(reg_speed$sprint_speed, 0.02)[[1]], 1),
               max = round(quantile(reg_speed$sprint_speed, 0.98)[[1]], 1),
               avg = round(mean(reg_speed$sprint_speed), 1)),
  arm = list(min = round(quantile(reg_arm$arm_mph, 0.02)[[1]], 1),
             max = round(quantile(reg_arm$arm_mph, 0.98)[[1]], 1),
             avg = round(mean(reg_arm$arm_mph), 1))
)

plays_all <- cands |>
  filter(label %in% c("safe", "out", "held")) |>
  mutate(
    runner_id = on_2b,
    fielder_id = case_when(hit_location == 7 ~ fielder_7, hit_location == 8 ~ fielder_8, TRUE ~ fielder_9),
    pos = c(`7` = "LF", `8` = "CF", `9` = "RF")[as.character(hit_location)],
    outs = outs_when_up,
    runner_on_first = !is.na(on_1b),
    bb_type = coalesce(bb_type, "line_drive"),
    # Savant hit coordinates to feet, home plate at (0, 0), +y toward center field.
    x_ft = round((hc_x - 125.42) * 2.5, 1),
    y_ft = round((198.27 - hc_y) * 2.5, 1),
    ev_imputed = is.na(launch_speed),   # the game shows "n/a" for these instead of the 92 mph stand-in
    launch_speed = round(coalesce(launch_speed, 92), 1)
  ) |>
  filter(y_ft > MIN_DEPTH_FT) |>
  left_join(speed |> select(season, runner_id = id, sprint_speed), by = c("season", "runner_id")) |>
  left_join(arms |> select(season, fielder_id = id, arm_mph), by = c("season", "fielder_id")) |>
  mutate(
    speed_imputed = is.na(sprint_speed), arm_imputed = is.na(arm_mph),
    sprint_speed = round(coalesce(sprint_speed, ref$speed$avg), 1),
    arm_mph = round(coalesce(arm_mph, ref$arm$avg), 1)
  )

sends <- plays_all |> filter(label %in% c("safe", "out")) |> mutate(safe = as.integer(label == "safe"))
holds <- plays_all |> filter(label == "held")

# Reference points for the distance meter: where real sends were fielded.
send_dist <- sqrt(sends$x_ft^2 + sends$y_ft^2)
ref$dist <- list(min = round(quantile(send_dist, 0.02)[[1]]), max = round(quantile(send_dist, 0.98)[[1]]),
                 avg = round(mean(send_dist)))

# --- Names --------------------------------------------------------------------
people_file <- file.path(CACHE, "people.rds")
people <- if (file.exists(people_file)) readRDS(people_file) else tibble(id = numeric(), name = character())
new_ids <- setdiff(unique(na.omit(c(sends$runner_id, sends$batter, sends$fielder_id))), people$id)
if (length(new_ids)) {
  people <- bind_rows(people, map_dfr(split(new_ids, ceiling(seq_along(new_ids) / 150)), function(ids) {
    j <- fromJSON(http_get(sprintf("https://statsapi.mlb.com/api/v1/people?personIds=%s&fields=people,id,fullName",
                                   paste(ids, collapse = ","))))
    Sys.sleep(0.5)
    tibble(id = as.numeric(j$people$id), name = j$people$fullName)
  }))
  saveRDS(people, people_file)
}
name_of <- function(ids) people$name[match(ids, people$id)]

message(sprintf("%d sends (%d safe, %d out) and %d holds with features; speed imputed for %d, arm for %d",
                nrow(sends), sum(sends$safe), sum(1 - sends$safe), nrow(holds),
                sum(sends$speed_imputed), sum(sends$arm_imputed)))
