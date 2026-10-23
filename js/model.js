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

  // Approximate MLB run expectancy (RE24), outs 0/1/2. The pipeline replaces this with
  // a table computed from the same seasons as the plays by defining window.RE24.
  const DEFAULT_RE24 = {
    "___": [0.481, 0.254, 0.098],
    "1__": [0.859, 0.509, 0.224],
    "_2_": [1.100, 0.664, 0.319],
    "__3": [1.353, 0.950, 0.353],
    "12_": [1.437, 0.884, 0.429],
    "1_3": [1.784, 1.130, 0.478],
    "_23": [1.920, 1.352, 0.570],
    "123": [2.282, 1.520, 0.736],
  };

  function re(state, outs) {
    if (outs >= 3) return 0;
    const row = (window.RE24 && window.RE24[state]) || DEFAULT_RE24[state];
    const v = row[outs];
    return typeof v === "number" ? v : DEFAULT_RE24[state][outs];
  }

  // Breakeven P(safe) for sending the runner from second on a base hit.
  // Assumption: on the throw home, every trailing runner (including the batter) takes one extra base.
  //   Hold:     runners end on 1st & 3rd (or loaded if a runner started on 1st)
  //   Safe:     +1 run, trailing runners on 2nd (and 3rd)
  //   Out:      +1 out, trailing runners on 2nd (and 3rd)
  function breakeven(outs, runnerOnFirst) {
    const hold = re(runnerOnFirst ? "123" : "1_3", outs);
    const after = runnerOnFirst ? "_23" : "_2_";
    const safe = 1 + re(after, outs);
    const out = re(after, outs + 1);
    const p = (hold - out) / (safe - out);
    return Math.min(0.99, Math.max(0.01, p));
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
      fielderStart: OF_START[play.fielder.pos] || OF_START.CF,
      breakeven: breakeven(outs, !!play.runner_on_first),
    };
  }

  window.WM = { BASES, OF_START, K, FIT, timeline, breakeven, MPH_TO_FPS };
})();
