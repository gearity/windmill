# Step 2: what the runner from second actually did, from the MLB game feed.
# -----------------------------------------------------------------------------
# Statcast's description text is easy to misread (a runner from FIRST thrown out
# at home, a rundown, a run that scored on a later throw). The game feed records
# each runner's movement and the fielders credited on it, so labels come from there:
#   safe              runner from 2nd scored on the play
#   out               thrown out at home, with an outfielder credited with the assist
#   out_no_of_assist  out at home with no outfield assist (rundowns, infield cutoffs)
#   out_elsewhere     out somewhere other than home (e.g. overran third)
#   held              stopped at third
#   error / unclear   an error on his advance, or the feed didn't say
# Only "safe" and "out" are sends the game and the model use. It also gives each
# play's Savant playId, which Statcast's CSV doesn't carry.
# Output object: cands, now with label, of_assist, play_id.

FEED_FIELDS <- paste(c("allPlays", "about", "atBatIndex", "runners", "movement", "end", "isOut", "outBase",
                       "details", "runner", "id", "credits", "position", "abbreviation", "credit",
                       "playEvents", "playId", "isPitch"), collapse = ",")
feed_url <- function(pk) sprintf("https://statsapi.mlb.com/api/v1/game/%s/playByPlay?fields=%s", pk, FEED_FIELDS)
feed_path <- function(pk) file.path(CACHE, "feeds", paste0(pk, ".json"))
OF_POS <- c("LF", "CF", "RF")

label_runner <- function(play, runner_id) {
  moves <- keep(play$runners, \(r) identical(as.numeric(r$details$runner$id), runner_id))
  if (!length(moves)) return("unclear")
  ends <- map_chr(moves, \(r) r$movement$end %||% NA_character_)
  out_base <- map_chr(moves, \(r) r$movement$outBase %||% NA_character_)
  is_out <- any(map_lgl(moves, \(r) isTRUE(r$movement$isOut)))
  credits <- list_flatten(map(moves, "credits"))
  codes <- map_chr(credits, \(c) c$credit %||% NA_character_)
  pos <- map_chr(credits, \(c) c$position$abbreviation %||% NA_character_)
  of_assist <- any(codes == "f_assist_of" | (codes == "f_assist" & pos %in% OF_POS), na.rm = TRUE)

  if (any(str_detect(codes, "error"), na.rm = TRUE)) return("error")
  if (is_out && "4B" %in% out_base) return(if (of_assist) "out" else "out_no_of_assist")
  if (is_out) return("out_elsewhere")
  if ("score" %in% ends) return("safe")
  if (identical(tail(na.omit(ends), 1), "3B")) return("held")
  "unclear"
}

parse_game <- function(pk, rows) {
  f <- feed_path(pk)
  feed <- tryCatch(fromJSON(f, simplifyVector = FALSE), error = function(e) NULL)
  if (is.null(feed$allPlays)) { unlink(f); return(NULL) }   # bad download: refetched next run
  idx <- map_dbl(feed$allPlays, \(p) as.numeric(p$about$atBatIndex %||% NA))
  map_dfr(seq_len(nrow(rows)), function(i) {
    j <- match(rows$at_bat_number[i] - 1, idx)   # Statcast at_bat_number is 1-based
    if (is.na(j)) return(tibble(at_bat_number = rows$at_bat_number[i], label = "unclear", play_id = NA_character_))
    play <- feed$allPlays[[j]]
    pitches <- keep(play$playEvents, \(e) isTRUE(e$isPitch))
    tibble(
      at_bat_number = rows$at_bat_number[i],
      label = label_runner(play, rows$on_2b[i]),
      play_id = if (length(pitches)) pitches[[length(pitches)]]$playId %||% NA_character_ else NA_character_
    )
  }) |> mutate(game_pk = pk)
}

dir.create(file.path(CACHE, "feeds"), showWarnings = FALSE, recursive = TRUE)
pks <- unique(cands$game_pk)
todo <- pks[!file.exists(feed_path(pks))]
message(sprintf("Game feeds: %d games, %d to download", length(pks), length(todo)))
for (batch in split(todo, ceiling(seq_along(todo) / 250))) {
  fetch_parallel(feed_url(batch), max_active = 6, paths = feed_path(batch))
  message(sprintf("  %d of %d feeds cached", sum(file.exists(feed_path(pks))), length(pks)))
}

labels <- cands |>
  select(game_pk, at_bat_number, on_2b) |>
  group_by(game_pk) |>
  group_modify(\(rows, key) parse_game(key$game_pk, rows) |> select(-game_pk)) |>
  ungroup()

cands <- cands |>
  left_join(labels, by = c("game_pk", "at_bat_number")) |>
  mutate(label = coalesce(label, "unclear"))

message("Labels from the game feed:")
print(count(cands, label, sort = TRUE))

# Cross-check against the description-based label. Disagreements are worth a look on video.
label_check <- cands |>
  mutate(agree = label == label_des | (label == "out_no_of_assist" & label_des == "out")) |>
  filter(!agree, label %in% c("safe", "out", "held")) |>
  transmute(game_date, label_feed = label, label_des, des,
            video = ifelse(is.na(play_id), NA, paste0("https://baseballsavant.mlb.com/sporty-videos?playId=", play_id)))
write_csv(label_check, file.path(OUT, "label_check.csv"))
message(sprintf("%d plays where the feed and the description disagree (pipeline/out/label_check.csv)",
                nrow(label_check)))
