// Windmill: game state, UI, and the play loop.
(function () {
  const $ = (id) => document.getElementById(id);
  const PLAYS = window.PLAYS || [];
  const META = window.PLAYS_META || {};
  const Store = window.Store;
  const TIMER_CHOICES = [3, 5, 8, 0];   // seconds: hard, regular, easy, no clock
  // Everything after the call (throw, dash home, hold, replay) plays this much faster than
  // real time. Runner and ball speed up together, so the safe/out race is unchanged.
  const FINISH_SPEED = 1.3;

  // League reference points for the scouting meters. The pipeline overrides these.
  const REF = Object.assign({
    speed: { min: 23, max: 31, avg: 27.0 },
    arm: { min: 76, max: 100, avg: 87.5 },
    dist: { min: 160, max: 320, avg: 240 },
  }, META.ref || {});

  // Placeholder for the coach name box: each team's third base coach in 2026.
  const COACHES = [
    "Buck Britton", "Kyle Hudson", "Luis Rojas", "Brady Williams", "Carlos Febles",
    "Justin Jirschele", "Rouglas Odor", "Joey Cora", "Vance Wilson", "Ramon Borrego",
    "Tony Perezchica", "Keith Johnson", "Bobby Crosby", "Carlos Cardoza", "Corey Ragsdale",
    "Tommy Watkins", "Blake Lalli", "Tim Leiper", "Dusty Wathan", "Victor Estevez",
    "Quintin Berry", "Willie Harris", "Matt Erickson", "Tony Beasley", "Ron Warner",
    "J.R. House", "Andy Gonzalez", "Dino Ebel", "Bob Henley", "Gary Pettis",
  ];

  const savedTimer = Number(Store.timer(5));
  const state = {
    user: null,
    streak: 0,
    timer: TIMER_CHOICES.includes(savedTimer) ? savedTimer : 5,
    play: null,
    tl: null,
    phase: "login",
    choice: null,
    seen: new Set(),
    raf: 0,
    clockStart: 0,
    video: null,
    callClock: 5,       // the clock setting for the call in progress
    streakClock: null,  // most lenient clock used during the current streak (shown on the leaderboard)
    posted: 0,          // the current streak's value as last sent to the leaderboard
  };

  const field = new window.Field($("field"));

  // ---------- header ----------
  function setTile(id, text) {
    const el = $(id);
    if (el.textContent === String(text)) return;
    el.textContent = text;
    el.classList.remove("flip"); void el.offsetWidth; el.classList.add("flip");
  }
  function renderHeader() {
    const u = state.user ? Store.get(state.user) : null;
    setTile("streak", state.streak);
    setTile("best", u ? u.best : 0);
    setTile("record", u ? `${u.right}-${u.wrong}` : "0-0");
    $("coachName").textContent = state.user ? `Coach ${state.user}` : "No coach yet";
  }

  function renderLocalBoard() {
    const rows = Store.board(5);
    const box = $("localBoard");
    box.innerHTML = "";
    if (!rows.length) return;
    const h = document.createElement("h3"); h.textContent = "Best streaks on this device"; box.appendChild(h);
    const ol = document.createElement("ol");
    rows.forEach(({ name, best }) => {
      const li = document.createElement("li");
      const b = document.createElement("button"); b.type = "button"; b.textContent = name;
      b.addEventListener("click", () => { $("username").value = name; $("username").focus(); });
      const s = document.createElement("span"); s.textContent = best;
      li.append(b, s); ol.appendChild(li);
    });
    box.appendChild(ol);
  }

  // ---------- leaderboard ----------
  // A streak goes to the board when it ends, when the coach switches, or when the page is
  // hidden mid-streak (the visitor may never come back). The board keeps each coach's best,
  // so posting a run at 5 and again at 8 is harmless.
  const leniency = (sec) => (sec === 0 ? Infinity : sec);
  function postStreak(value, keepalive) {
    if (!state.user || value <= state.posted) return;
    Store.submitStreak(state.user, value, state.streakClock ?? state.timer, keepalive);
    state.posted = value;
  }
  function resetStreak() { state.streak = 0; state.posted = 0; state.streakClock = null; }
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && state.streak > 0) postStreak(state.streak, true);
  });
  if (Store.online) document.querySelectorAll(".online-only").forEach((a) => { a.hidden = false; });

  // ---------- login ----------
  function showLogin() {
    if (state.streak > 0) postStreak(state.streak);
    cancelAnimationFrame(state.raf);
    stopVideo();
    state.phase = "login";
    $("login").hidden = false;
    $("username").value = Store.lastUser();
    $("username").placeholder = "e.g. " + COACHES[Math.floor(Math.random() * COACHES.length)];
    renderLocalBoard();
    setCallsEnabled(false);
    $("username").focus();
  }

  $("login").addEventListener("submit", (e) => {
    e.preventDefault();
    const name = Store.cleanName($("username").value);
    if (!name) return;
    Store.signIn(name);
    state.user = name;
    resetStreak();
    $("login").hidden = true;
    renderHeader();
    nextPlay();
  });
  $("switchBtn").addEventListener("click", showLogin);

  // ---------- settings / about ----------
  $("timerSelect").value = String(state.timer);
  $("timerSelect").addEventListener("change", (e) => { state.timer = Number(e.target.value); Store.setTimer(state.timer); });
  $("aboutBtn").addEventListener("click", () => $("about").showModal());

  function renderAbout() {
    const fit = window.WM.FIT;
    const n = (x) => Number(x).toLocaleString("en-US");
    const span = (s) => String(s || "").replace("-", " to ");
    if (fit && fit.metrics) {
      const m = fit.metrics;
      $("fitNote").textContent =
        `It was fit on ${n(fit.n)} real sends from ${span(fit.seasons)}, ${n(fit.n_out)} of them thrown out at home. ` +
        `On plays it wasn't fit on, it picks the thrown-out runner as the riskier send ${Math.round(m.fitted_cv.auc * 100)}% of the time.`;
    } else {
      $("fitNote").textContent = "Its numbers are hand-set estimates until the data pipeline fits them to real sends.";
    }
    $("poolNote").textContent = META.demo ? "" :
      `The pool has ${n(PLAYS.length)} plays from ${span(META.seasons)}` + (META.n_postseason ? ", postseason included." : ".");
  }

  // ---------- play selection: balanced between real safes and real outs ----------
  function pickPlay() {
    let unseen = PLAYS.filter((p) => !state.seen.has(p.id));
    if (!unseen.length) { state.seen.clear(); unseen = PLAYS; }
    const want = Math.random() < 0.5 ? "safe" : "out";
    let pool = unseen.filter((p) => p.result === want);
    if (!pool.length) pool = unseen;
    const p = pool[Math.floor(Math.random() * pool.length)];
    state.seen.add(p.id);
    return p;
  }

  // ---------- scouting card ----------
  function meter(el, val, ref) {
    const pct = (v) => Math.max(0, Math.min(100, ((v - ref.min) / (ref.max - ref.min)) * 100));
    el.querySelector(".meter-avg").style.left = pct(ref.avg) + "%";
    el.querySelector(".meter-dot").style.left = pct(val) + "%";
  }
  function speedWords(v) {
    const d = v - REF.speed.avg;
    if (d >= 2.5) return "Elite speed. Among the fastest in the league.";
    if (d >= 1) return "Plus runner.";
    if (d >= -0.8) return "About average.";
    if (d >= -2) return "Below average.";
    return "Slow. Station-to-station type.";
  }
  function armWords(v) {
    const d = v - REF.arm.avg;
    if (d >= 6) return "Cannon. Runners know about this arm.";
    if (d >= 2.5) return "Plus arm.";
    if (d >= -2.5) return "About average.";
    if (d >= -5) return "Below average.";
    return "Weak arm. Runners test him.";
  }
  function distWords(v) {
    const d = v - REF.dist.avg;
    if (d >= 40) return "Deep. Long throw home.";
    if (d >= 15) return "A little deep.";
    if (d >= -15) return "Normal depth.";
    if (d >= -40) return "Shallow.";
    return "Very shallow. Short throw home.";
  }
  const BB_WORDS = { ground_ball: "Ground ball", line_drive: "Line drive", fly_ball: "Fly ball", popup: "Bloop" };
  const POS_WORDS = { LF: "Left fielder", CF: "Center fielder", RF: "Right fielder" };
  const NO_DATA = "No Statcast reading, so this is the league average.";
  function ordinal(n) { const s = ["th", "st", "nd", "rd"], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }
  function niceDate(iso) {
    const d = new Date(iso + "T12:00:00");
    return isNaN(d) ? iso : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }
  function roundLabel(p) { return (META.game_types && META.game_types[p.game_type]) || ""; }

  function statVal(el, text, imputed) {
    el.textContent = text;
    if (imputed) { const s = document.createElement("small"); s.textContent = "est."; el.append(" ", s); }
  }

  function renderScout(p, tl) {
    $("reveal").hidden = true;
    $("scout").hidden = false;
    $("runnerName").textContent = p.runner.name;
    statVal($("runnerSpeed"), p.runner.sprint_speed.toFixed(1) + " ft/s", p.runner.imputed);
    meter($("runnerMeter"), p.runner.sprint_speed, REF.speed);
    $("runnerWords").textContent = p.runner.imputed ? NO_DATA : speedWords(p.runner.sprint_speed);
    $("fielderRole").textContent = POS_WORDS[p.fielder.pos] || "Outfielder";
    $("fielderName").textContent = p.fielder.name;
    statVal($("fielderArm"), p.fielder.arm_mph.toFixed(1) + " mph", p.fielder.imputed);
    meter($("armMeter"), p.fielder.arm_mph, REF.arm);
    $("armWords").textContent = p.fielder.imputed ? NO_DATA : armWords(p.fielder.arm_mph);
    statVal($("bbDist"), Math.round(tl.throwDist) + " ft", false);
    meter($("distMeter"), tl.throwDist, REF.dist);
    $("distWords").textContent = distWords(tl.throwDist);
    $("bbType").textContent = BB_WORDS[p.batted_ball.type] || "Base hit";
    $("bbEV").textContent = p.batted_ball.ev_imputed ? "n/a" : p.batted_ball.launch_speed.toFixed(1) + " mph";
    $("trailing").textContent = p.runner_on_first ? "Batter and runner on first" : "Just the batter";
    $("demoNote").hidden = !(META.demo || p.demo);

    $("situation").hidden = false;
    const round = roundLabel(p);
    $("sitRound").textContent = round;
    $("sitRound").hidden = !round;
    $("sitInning").textContent = `${p.half} ${ordinal(p.inning)}`;
    $("sitOuts").innerHTML = [0, 1, 2].map((i) => `<i class="${i < p.outs ? "on" : ""}"></i>`).join("") +
      `<span class="sr-only">${p.outs} ${p.outs === 1 ? "out" : "outs"}</span>`;
    // Away team first, like a TV scorebug.
    const top = p.half === "Top";
    const teams = [[p.bat_team, p.score.bat], [p.fld_team, p.score.fld]];
    if (!top) teams.reverse();
    $("sitScore").replaceChildren(...teams.map(([team, runs]) => {
      const s = document.createElement("span");
      const em = document.createElement("em"); em.textContent = runs;
      s.append(team, em);
      return s;
    }));
  }

  // ---------- animation ----------
  function run(fromT, toT, frameFn, done, speed = 1) {
    cancelAnimationFrame(state.raf);
    const t0 = performance.now();
    const step = (now) => {
      const t = Math.min(toT, fromT + ((now - t0) / 1000) * speed);
      field.draw(frameFn(t));
      if (t < toT) state.raf = requestAnimationFrame(step);
      else if (done) done();
    };
    state.raf = requestAnimationFrame(step);
  }

  function setCallsEnabled(on) {
    $("sendBtn").disabled = !on; $("holdBtn").disabled = !on;
    document.querySelector(".calls").classList.toggle("live", on);
  }
  function setClock(frac, urgent) {
    const f = $("clockFill");
    f.style.transform = `scaleX(${Math.max(0, frac)})`;
    f.classList.toggle("urgent", !!urgent);
  }

  function nextPlay() {
    if (!PLAYS.length) { $("callHint").textContent = "No plays loaded. Check data/plays.js."; return; }
    stopVideo();
    const p = pickPlay();
    const tl = window.WM.timeline(p);
    state.play = p; state.tl = tl; state.choice = null; state.phase = "approach";
    field.setPlay(p, tl);
    renderScout(p, tl);
    state.video = prepareVideo(p);   // start buffering the clip while the play runs
    setCallsEnabled(false);
    setClock(0);
    $("callHint").textContent = "Watch the ball. You'll get the call as he nears third.";
    run(0, tl.decisionT, (t) => ({ t, mode: "approach", call: null }), startDecision);
  }

  function startDecision() {
    state.phase = "decide";
    setCallsEnabled(true);
    $("sendBtn").focus({ preventScroll: true });
    const limit = state.timer;
    state.callClock = limit;
    $("callHint").textContent = limit ? `Your call. ${limit} seconds.` : "Your call. No clock.";
    const tl = state.tl;
    state.clockStart = performance.now();
    const tick = (now) => {
      if (state.phase !== "decide") return;
      const el = (now - state.clockStart) / 1000;
      field.draw({ t: tl.decisionT, mode: "approach", call: null });
      if (limit) {
        const left = limit - el;
        setClock(left / limit, left < 1.5);
        if (left <= 0) return decide("timeout");
      }
      state.raf = requestAnimationFrame(tick);
    };
    setClock(limit ? 1 : 0);
    state.raf = requestAnimationFrame(tick);
  }

  function decide(choice) {
    if (state.phase !== "decide") return;
    state.phase = "resolve";
    state.choice = choice;
    setCallsEnabled(false);
    setClock(0);
    const p = state.play, tl = state.tl;
    const umpAt = Math.max(tl.tHome, tl.throwArriveShown) + 0.15;
    const end = umpAt + 1.3;
    const sendFrame = (ghost, banner) => (t) => ({
      t, mode: "send", call: "send", ghost, banner,
      umpire: t >= umpAt ? p.result : null,
    });

    if (choice === "send") {
      $("callHint").textContent = "You're waving him home.";
      run(tl.decisionT, end, sendFrame(false), finish, FINISH_SPEED);
    } else {
      $("callHint").textContent = choice === "hold" ? "You put the stop sign up." : "No call. He's stuck in no-man's land.";
      const holdEnd = tl.decisionT + 2.0;
      run(tl.decisionT, holdEnd, (t) => ({ t, mode: "hold", call: choice === "hold" ? "hold" : null }), () => {
        run(tl.decisionT, end, sendFrame(true, "Real play: the coach sent him"), finish, FINISH_SPEED);
      }, FINISH_SPEED);
    }
  }

  function finish() {
    const p = state.play, tl = state.tl, choice = state.choice;
    const right = (choice === "send" && p.result === "safe") || (choice === "hold" && p.result === "out");
    const before = state.streak;
    if (right) {
      state.streak += 1;
      if (state.streakClock == null || leniency(state.callClock) > leniency(state.streakClock)) state.streakClock = state.callClock;
    } else {
      if (before > 0) postStreak(before);
      resetStreak();
    }
    Store.record(state.user, right, state.streak);
    renderHeader();
    renderReveal(p, tl, choice, right, before);
    state.phase = "reveal";
  }

  // ---------- reveal ----------
  function pct(x) { return Math.round(x * 100) + "%"; }

  function renderReveal(p, tl, choice, right, before) {
    $("scout").hidden = true;
    $("reveal").hidden = false;
    const v = $("verdict");
    v.className = "verdict " + (right ? "good" : "bad");
    if (right) v.textContent = `Right call. Streak: ${state.streak}.`;
    else if (choice === "timeout") v.textContent = before ? `Clock ran out. Streak over at ${before}.` : "Clock ran out.";
    else v.textContent = before ? `Wrong call. Streak over at ${before}.` : "Wrong call.";

    const safe = p.result === "safe";
    let title;
    if (choice === "send") title = safe ? "Safe at home." : "Out at the plate.";
    else title = safe ? "He'd have scored." : "He'd have been out.";
    $("revealTitle").textContent = title;
    const when = [roundLabel(p), p.date && p.date !== "Demo" ? niceDate(p.date) : ""].filter(Boolean).join(", ");
    $("revealDesc").textContent = p.description + (when ? ` (${when})` : "");

    $("pSafe").textContent = pct(tl.pGame);

    const modelCall = tl.pGame >= 0.5 ? "send" : "hold";
    const modelWord = modelCall === "send" ? "a send" : "a hold";
    let proc;
    if (choice === "timeout") proc = `By the numbers this was ${modelWord}.`;
    else if (choice === modelCall) {
      proc = "By the numbers, that was the right decision.";
      if (!right) proc += " The result just didn't go your way. That's baseball.";
    } else {
      proc = `By the numbers this was ${modelWord}.`;
      if (right) proc += " You got away with one.";
    }
    $("process").textContent = proc;

    showClip(p);
    $("nextBtn").focus({ preventScroll: true });
  }

  // ---------- clip ----------
  function savantLink(p) {
    return p.play_id ? `https://baseballsavant.mlb.com/sporty-videos?playId=${encodeURIComponent(p.play_id)}` : null;
  }
  function linkTo(href, text) {
    const a = document.createElement("a"); a.href = href; a.target = "_blank"; a.rel = "noopener"; a.textContent = text;
    return a;
  }

  // Built when the play starts so the clip is buffered by the time the reveal shows it.
  function prepareVideo(p) {
    if (!p.clip) return null;
    const vid = document.createElement("video");
    vid.preload = "auto"; vid.controls = true; vid.playsInline = true;
    vid.muted = !Store.sound();
    vid.addEventListener("volumechange", () => {
      if (vid.dataset.autoMuted) { delete vid.dataset.autoMuted; return; }  // our change, not the visitor's
      Store.setSound(!vid.muted && vid.volume > 0);
    });
    vid.src = p.clip;
    return vid;
  }
  function stopVideo() {
    $("clipStage").hidden = true;
    $("clipStage").innerHTML = "";
    if (!state.video) return;
    state.video.pause();
    state.video.removeAttribute("src");
    state.video.load();
    state.video = null;
  }

  // Browsers only allow sound without a fresh click if the visitor has already turned it on.
  function playVideo(vid) {
    vid.play().catch(() => {
      if (vid.muted) return;
      vid.dataset.autoMuted = "1"; vid.muted = true;
      vid.play().catch(() => {});
    });
  }

  // After the play, the clip takes over the field area; the toggle flips back to the final frame.
  function setClipView(show) {
    $("clipStage").hidden = !show;
    const btn = $("clipToggle");
    if (btn) btn.textContent = show ? "Show the field" : "Show the clip";
    if (state.video) show ? playVideo(state.video) : state.video.pause();
  }

  function showClip(p) {
    const meta = $("clipMeta"), stage = $("clipStage");
    meta.innerHTML = ""; stage.innerHTML = "";
    const link = savantLink(p);
    const fallback = () => {
      setClipView(false);
      meta.innerHTML = "";
      const para = document.createElement("p");
      para.className = "clip-note";
      if (link) para.append("The clip didn't load. ", linkTo(link, "Watch it on Baseball Savant"));
      else para.textContent = p.demo ? "Demo play, so there's no real footage. Real plays show the clip here." : "No footage for this play.";
      meta.appendChild(para);
    };
    const vid = state.video;
    if (!vid || vid.error) return fallback();
    vid.addEventListener("error", fallback);
    stage.appendChild(vid);

    const toggle = document.createElement("button");
    toggle.type = "button"; toggle.className = "link-btn"; toggle.id = "clipToggle";
    toggle.addEventListener("click", () => setClipView(stage.hidden));
    meta.appendChild(toggle);
    if (link) {
      const credit = document.createElement("span");
      credit.className = "clip-credit";
      credit.append("Video: MLB. ", linkTo(link, "Open on Baseball Savant"));
      meta.appendChild(credit);
    }
    setClipView(true);
  }

  $("nextBtn").addEventListener("click", () => { if (state.phase === "reveal") nextPlay(); });
  $("sendBtn").addEventListener("click", () => decide("send"));
  $("holdBtn").addEventListener("click", () => decide("hold"));

  document.addEventListener("keydown", (e) => {
    if (["INPUT", "SELECT", "TEXTAREA"].includes(e.target.tagName) || $("about").open || $("suggest").open) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (state.phase === "decide") {
      if (k === "s") { e.preventDefault(); decide("send"); }
      if (k === "h") { e.preventDefault(); decide("hold"); }
    } else if (state.phase === "reveal" && (k === "enter" || k === " ")) {
      if ((e.target.tagName === "BUTTON" && e.target !== $("nextBtn")) || e.target.tagName === "VIDEO" || e.target.tagName === "A") return;
      e.preventDefault(); nextPlay();
    }
  });

  // ---------- suggestions ----------
  $("suggestBtn").addEventListener("click", () => {
    $("suggestStatus").textContent = "";
    $("suggest").showModal();
    $("suggestText").focus();
  });
  $("suggestClose").addEventListener("click", () => $("suggest").close());
  $("suggestForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = $("suggestText").value.trim();
    if (!text) return;
    $("suggestSend").disabled = true;
    const ok = await Store.submitSuggestion(text, $("suggestName").value.trim() || state.user || "");
    $("suggestStatus").textContent = ok ? "Sent. Thanks." : "That didn't go through. Try again in a minute.";
    if (ok) $("suggestText").value = "";
    $("suggestSend").disabled = false;
  });

  // ---------- consistency check: the browser model must match the R pipeline ----------
  const drift = PLAYS.filter((p) => typeof p.p_model === "number" && Math.abs(window.WM.timeline(p).pSafe - p.p_model) > 0.002);
  if (drift.length) {
    console.warn(`Windmill: js/model.js disagrees with pipeline/model.R on ${drift.length} of ${PLAYS.length} plays. ` +
      "The two model files have drifted apart.", drift.slice(0, 3).map((p) => p.id));
  }

  // ---------- boot ----------
  renderAbout();
  field.draw({ t: 0, mode: "approach" });
  renderHeader();
  showLogin();
})();
