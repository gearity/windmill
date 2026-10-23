# Step 1: Statcast pull, RE24, and candidate plays.
# -----------------------------------------------------------------------------
# Pulls every pitch from Baseball Savant's search CSV in small date chunks, keeps
# only the pitch that ended each plate appearance, and caches each chunk.
# Output objects: pa (all PAs), re24 / re24_tbl, cands (candidate plays).

SC_COLS <- c("game_pk", "game_date", "game_type", "game_year", "at_bat_number", "inning", "inning_topbot",
             "outs_when_up", "on_1b", "on_2b", "on_3b", "events", "des", "hit_location", "bb_type",
             "hc_x", "hc_y", "launch_speed", "launch_angle", "batter", "fielder_7", "fielder_8", "fielder_9",
             "home_team", "away_team", "bat_score", "fld_score", "post_bat_score")
SC_NUM <- setdiff(SC_COLS, c("game_date", "game_type", "inning_topbot", "events", "des", "bb_type",
                             "home_team", "away_team"))

savant_search_url <- function(start, end) {
  paste0("https://baseballsavant.mlb.com/statcast_search/csv?all=true&type=details&player_type=batter",
         "&hfGT=", paste0(SAVANT_GAME_TYPES, "%7C", collapse = ""),
         "&game_date_gt=", start, "&game_date_lt=", end)
}

fetch_statcast <- function(start, end) {
  txt <- http_get(savant_search_url(start, end), timeout = 400)
  if (!nzchar(trimws(txt))) return(tibble())
  d <- read_csv(I(txt), col_types = cols(.default = col_character()), progress = FALSE)
  if (!nrow(d)) return(d)
  missing <- setdiff(SC_COLS, names(d))
  if (length(missing)) stop("Savant CSV is missing columns: ", paste(missing, collapse = ", "))
  d
}

# Pull [start, end]; if Savant hits its row cap, split the range and try again.
pull_chunk <- function(start, end) {
  message(sprintf("  Statcast %s to %s", start, end))
  d <- fetch_statcast(start, end)
  if (nrow(d) >= SAVANT_ROW_CAP) {
    if (end > start) {
      mid <- start + floor(as.numeric(end - start) / 2)
      return(bind_rows(pull_chunk(start, mid), pull_chunk(mid + 1, end)))
    }
    warning("A single day (", start, ") hit Savant's row cap; some pitches are missing.")
  }
  Sys.sleep(1)
  if (!nrow(d)) return(NULL)
  # Only the pitch that ended each PA matters downstream; it's about a quarter of the rows.
  d |> filter(!is.na(events), events != "") |> select(all_of(SC_COLS))
}

pull_season <- function(yr) {
  first <- as.Date(sprintf("%s-%s", yr, SEASON_WINDOW[1]))
  last <- min(as.Date(sprintf("%s-%s", yr, SEASON_WINDOW[2])), Sys.Date() - 1)
  if (last < first) return(tibble())
  starts <- seq(first, last, by = CHUNK_DAYS)
  map_dfr(starts, function(s) {
    e <- min(s + CHUNK_DAYS - 1, last)
    f <- file.path(CACHE, "statcast", sprintf("pa_%s_%s.rds", s, e))
    if (file.exists(f)) return(readRDS(f))
    d <- pull_chunk(s, e)
    # Don't cache a chunk that might still be filling in (games in the last couple of days).
    if (e < Sys.Date() - 2) saveRDS(d, f)
    d
  })
}

dir.create(file.path(CACHE, "statcast"), showWarnings = FALSE, recursive = TRUE)
pa <- map_dfr(SEASONS, pull_season) |>
  mutate(across(all_of(SC_NUM), as.numeric), game_date = as.Date(game_date)) |>
  filter(game_type %in% GAME_TYPES) |>
  distinct(game_pk, at_bat_number, .keep_all = TRUE)
message(sprintf("%s plate appearances (%s), %d games",
                format(nrow(pa), big.mark = ","), paste(range(pa$game_date), collapse = " to "),
                n_distinct(pa$game_pk)))

# --- RE24 ---------------------------------------------------------------------
# Regular season only. Bottom of the 9th and later is skipped: walk-offs end the
# half-inning early and would understate run expectancy.
re24_tbl <- pa |>
  filter(game_type == "R") |>
  group_by(game_pk, inning, inning_topbot) |>
  mutate(half_end_score = max(post_bat_score)) |>
  ungroup() |>
  filter(!(inning >= 9 & inning_topbot == "Bot")) |>
  mutate(state = base_state(on_1b, on_2b, on_3b), runs_rest = half_end_score - bat_score) |>
  group_by(state, outs = outs_when_up) |>
  summarise(re = mean(runs_rest), n = n(), .groups = "drop") |>
  arrange(state, outs)
re24 <- split(round(re24_tbl$re, 3), re24_tbl$state)

# --- Candidates ---------------------------------------------------------------
# Single fielded by an outfielder, runner on 2nd, 3rd base open, no error/interference.
cands <- pa |>
  filter(
    events == "single",
    !is.na(on_2b), is.na(on_3b),
    hit_location %in% 7:9,
    !is.na(hc_x), !is.na(hc_y),
    !str_detect(des, regex("error|interference|obstruction", ignore_case = TRUE))
  ) |>
  mutate(
    season = as.integer(game_year),
    # Description-based label, kept only to cross-check the game-feed label in step 2.
    label_des = case_when(
      str_detect(des, regex("out at home", ignore_case = TRUE)) ~ "out",
      post_bat_score - bat_score >= 1 ~ "safe",
      TRUE ~ "held"
    )
  )
message(sprintf("%s candidate plays", format(nrow(cands), big.mark = ",")))
