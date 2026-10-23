# Step 5: pick the play pool and find each play's broadcast clip.
# -----------------------------------------------------------------------------
# Savant's video page for a play (sporty-videos?playId=...) embeds a direct mp4 URL
# on MLB's clip server. The game plays that URL straight from MLB in the visitor's
# browser. MLB's clip server blocks scripted downloads, so nothing is rehosted;
# if you save a clip by hand as clips/<play_id>.mp4, that local file wins.
# Output object: pool (sends that go in the game, with clip = URL or local path).

SAVANT_VIDEO <- "https://baseballsavant.mlb.com/sporty-videos?playId=%s"
CLIP_RE <- "https://sporty-clips\\.mlb\\.com/[^\"'\\s<>]+\\.mp4"

# The URL comes out of HTML, so its base64 padding arrives escaped: "&#x3D;&#x3D;" for "==".
html_unescape <- function(x) {
  x <- str_replace_all(x, "&#x([0-9A-Fa-f]+);", \(m) intToUtf8(strtoi(str_sub(m, 4, -2), 16L), multiple = TRUE))
  x <- str_replace_all(x, "&#([0-9]+);", \(m) intToUtf8(as.integer(str_sub(m, 3, -2)), multiple = TRUE))
  str_replace_all(x, "&amp;", "&")
}

set.seed(POOL_SEED)
pool <- sends |>
  filter(!is.na(play_id)) |>
  group_by(safe) |>
  slice_sample(n = POOL_MAX_SAFE) |>   # caps safes; outs are far fewer than the cap
  ungroup()

clip_file <- file.path(CACHE, "clip_urls.csv")
clip_urls <- if (file.exists(clip_file)) read_csv(clip_file, col_types = "cc") else
  tibble(play_id = character(), clip_url = character())
todo <- setdiff(pool$play_id, clip_urls$play_id)
message(sprintf("Clip URLs: %d plays in the pool, %d to look up", nrow(pool), length(todo)))
for (batch in split(todo, ceiling(seq_along(todo) / 100))) {
  resps <- fetch_parallel(sprintf(SAVANT_VIDEO, batch), max_active = 3)
  found <- map_chr(resps, \(r) if (is.null(r)) NA_character_ else str_extract(resp_body_string(r), CLIP_RE))
  # A page that loaded but had no clip is recorded as "" so it isn't re-requested every run.
  got <- tibble(play_id = batch, clip_url = ifelse(map_lgl(resps, is.null), NA, coalesce(found, "")))
  clip_urls <- bind_rows(clip_urls, filter(got, !is.na(clip_url)))
  write_csv(clip_urls, clip_file)
  message(sprintf("  %d of %d looked up", sum(pool$play_id %in% clip_urls$play_id), nrow(pool)))
  Sys.sleep(1)
}

local_clips <- sub("\\.mp4$", "", list.files("clips", pattern = "\\.mp4$"))
pool <- pool |>
  left_join(clip_urls, by = "play_id") |>
  mutate(clip_url = html_unescape(clip_url),
         clip = case_when(play_id %in% local_clips ~ sprintf("clips/%s.mp4", play_id),
                          !is.na(clip_url) & clip_url != "" ~ clip_url,
                          TRUE ~ NA_character_))
message(sprintf("%d of %d pool plays have a clip; the rest show the Savant link instead",
                sum(!is.na(pool$clip)), nrow(pool)))
