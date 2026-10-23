# Windmill data pipeline
# -----------------------------------------------------------------------------
# Builds data/plays.js from real MLB data, fits the timing model, and writes
# analysis tables and charts to pipeline/out/.
#
#   1. Statcast pull (Baseball Savant), RE24, candidate plays     01_statcast.R
#   2. Label each play from the MLB game feed (send/hold, safe/out) 02_feeds.R
#   3. Sprint speed, arm strength, names                           03_players.R
#   4. Fit the timing model; grade real coaches against it          04_fit.R
#   5. Choose the play pool; find each play's broadcast clip        05_clips.R
#   6. Write data/plays.js and pipeline/out/*.csv                   06_write.R
#
# Run from the repo root:   Rscript pipeline/run.R
# Or in RStudio:            source("pipeline/run.R")
# The first run downloads a lot (about an hour). Everything is cached in
# pipeline/cache/, so reruns take a minute or two.
# -----------------------------------------------------------------------------

suppressPackageStartupMessages({
  library(dplyr)
  library(purrr)
  library(stringr)
  library(readr)
  library(tidyr)
  library(jsonlite)
  library(httr2)
  library(ggplot2)
})

if (!file.exists("index.html") || !dir.exists("pipeline")) stop("Run this from the repo root (the folder with index.html).")

for (f in c("config.R", "helpers.R", "model.R")) source(file.path("pipeline", f))
dir.create(CACHE, showWarnings = FALSE, recursive = TRUE)
dir.create(OUT, showWarnings = FALSE, recursive = TRUE)

t0 <- Sys.time()
step("1. Statcast");             source("pipeline/01_statcast.R")
step("2. Game feeds");           source("pipeline/02_feeds.R")
step("3. Players");              source("pipeline/03_players.R")
step("4. Model fit");            source("pipeline/04_fit.R")
step("5. Pool and clips");       source("pipeline/05_clips.R")
step("6. Write");                source("pipeline/06_write.R")
message(sprintf("\nDone in %.1f minutes.", as.numeric(difftime(Sys.time(), t0, units = "mins"))))
