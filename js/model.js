// Windmill: the timing model.
// A simple physics estimate, kept readable on purpose. It drives the animation and the
// "chance he scores" grade on the reveal. The streak is always graded on the real outcome.
//
// pipeline/model.R is this file's twin in R. Keep them in lockstep: the pipeline fits
// calibIntercept and calibSlope on real sends and ships them in window.MODEL_FIT, and
// every play carries the p_model R computed, which game.js checks against timeline() on load.

(function () {
  const MPH_TO_FPS = 1.4667;

  // Field geometry, in feet. Home plate is (0, 0), center field is +y.
  const BASES = {
    home: { x: 0, y: 0 },
    first: { x: 63.64, y: 63.64 },
    second: { x: 0, y: 127.28 },
    third: { x: -63.64, y: 63.64 },
  };

  // Standard outfielder starting spots (roughly 290-315 ft deep).
  const OF_START = {
    LF: { x: -145, y: 251 },
    CF: { x: 0, y: 315 },
    RF: { x: 145, y: 251 },
  };

  // Hand-set defaults. calibIntercept and calibSlope are replaced by fitted values when
  // the pipeline has run (see window.MODEL_FIT below); the physical constants stay as set here.
  const K = {
    leadFt: 15,            // secondary lead off second at contact
    twoOutBonusFt: 8,      // extra ground with two outs (running on contact)
    readDelay: 0.15,       // seconds before the runner commits (ball read)
    lineDriveFreeze: 0.20, // extra hesitation on line drives with fewer than two outs
    twoOutStart: 0.05,     // with two outs he goes on contact
    speedFactor: 0.95,     // average speed over the run vs. Statcast sprint speed (top speed)
    turnLoss: 0.20,        // seconds lost rounding third
    exchange: 0.75,        // seconds from fielding the ball to release
    throwCarry: 0.70,      // average throw velocity vs. max-effort arm strength (drag, hop)
    tagTime: 0.12,         // catch-and-tag
    calibIntercept: 0,     // logit P(safe) at a zero margin
    calibSlope: 1 / 0.28,  // logit P(safe) per second of margin
    ballFactor: { ground_ball: 0.42, line_drive: 0.50, fly_ball: 0.45, popup: 0.40 },
    ballFactorOther: 0.55,
  };
  const FIT = window.MODEL_FIT || null;
  if (FIT && FIT.K) Object.assign(K, FIT.K);

  // About 97% of real sends score, but the game deals safe and out plays 50/50. Bayes' rule
  // swaps the real prior for the game's: multiply the odds by (out rate / safe rate).
  // pGame is the chance this play, dealt by this game, is one where he scored.
  const REAL_SAFE_RATE = FIT && FIT.n ? 1 - FIT.n_out / FIT.n : 0.97;
  function gameChance(pReal) {
    const odds = (pReal / (1 - pReal)) * ((1 - REAL_SAFE_RATE) / REAL_SAFE_RATE);
    return odds / (1 + odds);
  }

  function hypot(a, b) { return Math.sqrt(a * a + b * b); }

  function ballTravelTime(bb) {
    const dist = hypot(bb.x, bb.y);
    const ls = (bb.launch_speed > 0 ? bb.launch_speed : 92) * MPH_TO_FPS;
    const f = K.ballFactor[bb.type] || K.ballFactorOther;
    return Math.min(5.0, Math.max(1.6, dist / (ls * f)));
  }

  // Build the full timeline for one play. All times are seconds after contact.
  function timeline(play) {
    const outs = play.outs;
    const lead = K.leadFt + (outs === 2 ? K.twoOutBonusFt : 0);
    const v = play.runner.sprint_speed * K.speedFactor;
    const start = outs === 2 ? K.twoOutStart
      : K.readDelay + (play.batted_ball.type === "line_drive" ? K.lineDriveFreeze : 0);

    const tAt3B = start + (90 - lead) / v;
    const tHome = tAt3B + K.turnLoss + 90 / v;

    const tField = ballTravelTime(play.batted_ball);
    const release = tField + K.exchange;
    const fieldSpot = { x: play.batted_ball.x, y: play.batted_ball.y };
    const throwDist = hypot(fieldSpot.x, fieldSpot.y);
    const vThrow = play.fielder.arm_mph * MPH_TO_FPS * K.throwCarry;
    const throwArrive = release + throwDist / vThrow;
    const margin = throwArrive + K.tagTime - tHome; // > 0 means runner beats the tag
    const pSafe = 1 / (1 + Math.exp(-(K.calibIntercept + K.calibSlope * margin)));

    // The call has to be made as the runner approaches third.
    const decisionT = Math.max(0.9, Math.min(tField + 0.15, tAt3B - 0.2));

    // The animation always shows the real result, so nudge the throw if the model disagrees.
    let throwArriveShown = throwArrive;
    if (play.result === "out") throwArriveShown = Math.min(throwArrive, tHome - 0.35);
    if (play.result === "safe") throwArriveShown = Math.max(throwArrive, tHome + 0.12);
    throwArriveShown = Math.max(throwArriveShown, release + 0.8);

    return {
      lead, v, start, tAt3B, tHome, tField, release, fieldSpot, throwDist, vThrow,
      throwArrive, throwArriveShown, margin, pSafe, decisionT,
      pGame: gameChance(pSafe),
      fielderStart: OF_START[play.fielder.pos] || OF_START.CF,
    };
  }

  window.WM = { BASES, OF_START, K, FIT, timeline, gameChance, MPH_TO_FPS };
})();
