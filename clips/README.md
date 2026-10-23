# Optional local clips

The game streams each play's broadcast clip straight from MLB's clip server; nothing needs to live here.

If a clip stops loading, or you want one to work offline, save it here as `<play_id>.mp4` and rerun `Rscript pipeline/run.R`. A local file always wins over the streamed one. MLB's clip server blocks scripted downloads, so this is a by-hand step.

`*.mp4` files here are git-ignored by default. Remove that line from `.gitignore` if you want them published.
