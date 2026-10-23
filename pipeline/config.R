# Windmill pipeline settings. Everything tunable lives here.

SEASONS <- 2024:2026
# Savant's season-type filter. "PO" covers every postseason round (F, D, L, W).
SAVANT_GAME_TYPES <- c("R", "PO")
GAME_TYPES <- c("R", "F", "D", "L", "W")
# Wide enough for opening series abroad (mid-March) and a World Series that runs into November.
SEASON_WINDOW <- c("03-15", "11-05")

CHUNK_DAYS <- 4               # Savant caps a search at 25,000 rows; 4 days is ~18k pitches
SAVANT_ROW_CAP <- 25000       # a chunk that hits this gets split in half and re-pulled

# The play pool shipped to the game: every send that ended in an outfield-assist out at home,
# plus a seeded random sample of safe sends. The game draws safe and out 50/50 anyway,
# so the cap only limits file size and clip lookups.
POOL_MAX_SAFE <- 1500
POOL_SEED <- 27
MIN_DEPTH_FT <- 120           # drop balls fielded in front of the outfield grass

CACHE <- "pipeline/cache"
OUT <- "pipeline/out"
UA <- "Windmill third base coach game, data pipeline (R httr2)"
