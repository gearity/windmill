// Windmill: game state, UI, and the play loop.
(function () {
  const $ = (id) => document.getElementById(id);
  const PLAYS = window.PLAYS || [];
  const META = window.PLAYS_META || {};
  const Store = window.Store;
  const TIMER_CHOICES = [3, 5, 8, 12, 0];
  // Everything after the call (throw, dash home, hold, replay) plays this much faster than
  // real time. Runner and ball speed up together, so the safe/out race is unchanged.
  const FINISH_SPEED = 1.3;

  // League reference points for the scouting meters. The pipeline overrides these.
  const REF = Object.assign({
    speed: { min: 23, max: 31, avg: 27.0 },
    arm: { min: 76, max: 100, avg: 87.5 },
  }, META.ref || {});

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

  // ---------- login ----------
  function showLogin() {
    cancelAnimationFrame(state.raf);
    stopVideo();
    state.phase = "login";
    $("login").hidden = false;
    $("username").value = Store.lastUser();
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
    state.streak = 0;
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
        `The physics is hand-set; how the time gap turns into odds was fit by maximum likelihood on ` +
        `${n(fit.n)} real sends from ${span(fit.seasons)}, ${n(fit.n_out)} of them thrown out. ` +
        `Be warned: coaches mostly send sure things, so nearly every send scores and the odds rarely stray far from that. ` +
        `On plays it wasn't fit on, the model ranks a random thrown-out runner below a random safe one ` +
        `${Math.round(m.fitted_cv.auc * 100)}% of the time.`;
    } else {
      $("fitNote").textContent = "The model's constants are hand-set estimates. Running the data pipeline fits them to real sends.";
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
    $("bbType").textContent = BB_WORDS[p.batted_ball.type] || "Base hit";
    $("bbDist").textContent = Math.round(tl.throwDist) + " ft from home";
    $("trailing").textContent = p.runner_on_first ? "Runner from first + batter" : "Just the batter";
    $("demoNote").hidden = !(META.demo || p.demo);

    $("situation").hidden = false;
    const round = roundLabel(p);
    $("sitRound").textContent = round;
    $("sitRound").hidden = !round;
    $("sitInning").textContent = `${p.half} ${ordinal(p.inning)}`;
    $("sitOuts").innerHTML = [0, 1, 2].map((i) => `<i class="${i < p.outs ? "on" : ""}"></i>`).join("") +
      `<span class="sr-only">${p.outs} out</span>`;
    $("sitScore").textContent = `${p.bat_team} ${p.score.bat}, ${p.fld_team} ${p.score.fld}`;
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
    state.streak = right ? state.streak + 1 : 0;
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

    $("pSafe").textContent = pct(tl.pSafe);
    $("beOuts").textContent = p.outs === 1 ? "1 out" : `${p.outs} outs`;
    $("beVal").textContent = pct(tl.breakeven);

    const modelCall = tl.pSafe >= tl.breakeven ? "send" : "hold";
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
    $("situation").hidden = show;
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
    if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT" || $("about").open) return;
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
