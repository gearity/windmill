// Every line of text the scripts put on the page. A word in braces, like {streak}, is filled in
// by the game, so keep it when rewording. Text written straight into the HTML stays there.
// Edit mode (?edit on the live site) rewrites the values here, so keep one entry per line
// with the value in double quotes.
window.COPY = {
  // Header
  coachName: "Coach {name}",
  noCoach: "No coach yet",

  // Login
  namePlaceholder: "e.g. {coach}",
  localBoard: "Best streaks on this device",

  // About dialog
  fitNote: "It was fit on {sends} real sends from {seasons}, {outs} of them thrown out at home. On plays it wasn't fit on, it picks the thrown-out runner as the riskier send {auc} of the time.",
  fitNoteDemo: "Its numbers are hand-set estimates until the data pipeline fits them to real sends.",
  poolNote: "The pool has {plays} plays from {seasons}.",
  poolNotePostseason: "The pool has {plays} plays from {seasons}, postseason included.",

  // The situation: runner
  speedElite: "Elite speed. Among the fastest in the league.",
  speedPlus: "Plus runner.",
  speedAverage: "About average.",
  speedBelow: "Below average.",
  speedSlow: "Slow. Station-to-station type.",

  // The situation: outfielder
  posLF: "Left fielder",
  posCF: "Center fielder",
  posRF: "Right fielder",
  posOF: "Outfielder",
  armCannon: "Cannon. Runners know about this arm.",
  armPlus: "Plus arm.",
  armAverage: "About average.",
  armBelow: "Below average.",
  armWeak: "Weak arm. Runners test him.",
  noStatcast: "No Statcast reading, so this is the league average.",
  estimated: "est.",

  // The situation: where it was fielded
  distDeep: "Deep. Long throw home.",
  distLittleDeep: "A little deep.",
  distNormal: "Normal depth.",
  distShallow: "Shallow.",
  distVeryShallow: "Very shallow. Short throw home.",

  // The situation: facts
  ballGround: "Ground ball",
  ballLine: "Line drive",
  ballFly: "Fly ball",
  ballPopup: "Bloop",
  ballOther: "Base hit",
  evMissing: "n/a",
  trailingFirst: "Batter and runner on first",
  trailingNone: "Just the batter",

  // Call bar
  hintWatch: "Watch the ball. You'll get the call as he nears third.",
  hintClock: "Your call. {seconds} seconds.",
  hintNoClock: "Your call. No clock.",
  hintSend: "You're waving him home.",
  hintHold: "You put the stop sign up.",
  hintTimeout: "No call. He's stuck in no-man's land.",
  noPlays: "No plays loaded. Check data/plays.js.",

  // Field
  fieldCoach: "You",
  fieldRunner: "R",
  fieldCatcher: "C",
  umpSafe: "SAFE",
  umpOut: "OUT",
  replayBanner: "Real play: the coach sent him",

  // Reveal
  verdictRight: "Right call. Streak: {streak}.",
  verdictWrong: "Wrong call.",
  verdictWrongEnded: "Wrong call. Streak over at {streak}.",
  verdictTimeout: "Clock ran out.",
  verdictTimeoutEnded: "Clock ran out. Streak over at {streak}.",
  titleSafe: "Safe at home.",
  titleOut: "Out at the plate.",
  titleHeldSafe: "He'd have scored.",
  titleHeldOut: "He'd have been out.",
  modelSend: "By the numbers this was a send.",
  modelHold: "By the numbers this was a hold.",
  modelAgreed: "By the numbers, that was the right decision.",
  modelUnlucky: "The result just didn't go your way. That's baseball.",
  modelGotAway: "You got away with one.",

  // Clip
  showField: "Show the field",
  showClip: "Show the clip",
  clipCredit: "Video: MLB.",
  clipCreditLink: "Open on Baseball Savant",
  clipFailed: "The clip didn't load.",
  clipFailedLink: "Watch it on Baseball Savant",
  clipNone: "No footage for this play.",
  clipDemo: "Demo play, so there's no real footage. Real plays show the clip here.",

  // Suggestions
  suggestSent: "Sent. Thanks.",
  suggestFailed: "That didn't go through. Try again in a minute.",

  // Leaderboard page
  boardLoading: "Loading the board.",
  boardEmpty: "No streaks yet.",
  boardDown: "Couldn't reach the leaderboard. Try again in a minute.",
  boardOffline: "The leaderboard isn't connected yet.",
};
