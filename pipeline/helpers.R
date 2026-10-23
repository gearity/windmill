# HTTP and caching helpers. Every network call in the pipeline goes through these.

windmill_req <- function(url, timeout = 120) {
  request(url) |>
    req_user_agent(UA) |>
    req_timeout(timeout) |>
    req_retry(max_tries = 4, retry_on_failure = TRUE, backoff = \(i) 5 * i)
}

http_get <- function(url, timeout = 120) {
  windmill_req(url, timeout) |> req_perform() |> resp_body_string()
}

# Evaluate `expr` once and keep the result in an .rds file.
cache_rds <- function(file, expr) {
  if (file.exists(file)) return(readRDS(file))
  val <- force(expr)
  saveRDS(val, file)
  val
}

# Run many GET requests a few at a time. Responses that fail come back as NULL.
fetch_parallel <- function(urls, max_active = 4, paths = NULL, timeout = 60) {
  if (!length(urls)) return(list())
  reqs <- lapply(urls, windmill_req, timeout = timeout)
  resps <- req_perform_parallel(reqs, paths = paths, on_error = "continue",
                                max_active = max_active, progress = interactive())
  lapply(resps, \(r) if (inherits(r, "httr2_response") && resp_status(r) < 400) r else NULL)
}

base_state <- function(on1, on2, on3) {
  paste0(ifelse(is.na(on1), "_", "1"), ifelse(is.na(on2), "_", "2"), ifelse(is.na(on3), "_", "3"))
}

step <- function(msg) message("\n== ", msg, " ", strrep("=", max(0, 60 - nchar(msg))))
