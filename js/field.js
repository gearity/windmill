// Windmill: top-down field renderer + play animation.
(function () {
  const { BASES } = window.WM;

  const C = {
    grassA: "#3d7a39",
    grassB: "#44853f",
    foul: "#356c32",
    clay: "#9a6743",
    chalk: "#f3f2ea",
    wall: "#1e3a2b",
    warning: "#7c5a3e",
    runner: "#f2c230",
    fielder: "#d8e1ef",
    fielderRing: "#1b2c4a",
    coach: "#f2c230",
    ball: "#ffffff",
    out: "#e0553f",
    ghost: "rgba(242, 194, 48, 0.7)",
  };

  // World view window (feet).
  const VIEW = { xMin: -255, xMax: 255, yMin: -38, yMax: 395 };

  function lerp(a, b, t) { return a + (b - a) * t; }
  function clamp01(t) { return Math.max(0, Math.min(1, t)); }
  function easeOut(t) { return 1 - Math.pow(1 - t, 2); }
  function easeInOut(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }
  function wallDist(theta) { return 330 + 70 * Math.cos(2 * theta); } // theta from CF line

  class Field {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext("2d");
      this.play = null;
      this.tl = null;
      this.resize();
      // The canvas resizes with the layout (panel stacking, phone rotation) as well as the window.
      const redraw = () => { this.resize(); if (this.lastFrame) this.draw(this.lastFrame); };
      if (window.ResizeObserver) new ResizeObserver(redraw).observe(canvas);
      else window.addEventListener("resize", redraw);
    }

    resize() {
      const r = this.canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      if (r.width === this.w && r.height === this.h && dpr === this.dpr) return;
      this.canvas.width = Math.round(r.width * dpr);
      this.canvas.height = Math.round(r.height * dpr);
      this.w = r.width; this.h = r.height; this.dpr = dpr;
      const sx = this.w / (VIEW.xMax - VIEW.xMin);
      const sy = this.h / (VIEW.yMax - VIEW.yMin);
      this.scale = Math.min(sx, sy);
      this.ox = this.w / 2;
      this.oy = this.h - (-VIEW.yMin) * this.scale - (this.h - (VIEW.yMax - VIEW.yMin) * this.scale) / 2;
      this.bg = null; // re-render static layer
    }

    P(p) { return { x: this.ox + p.x * this.scale, y: this.oy - p.y * this.scale }; }

    setPlay(play, tl) { this.play = play; this.tl = tl; }

    // ---------- static field ----------
    drawStatic(ctx) {
      const s = this.scale;
      ctx.fillStyle = C.foul;
      ctx.fillRect(0, 0, this.w, this.h);

      // Fair territory + mowing stripes, clipped to the outfield fan.
      ctx.save();
      ctx.beginPath();
      const h0 = this.P({ x: 0, y: 0 });
      ctx.moveTo(h0.x, h0.y);
      for (let a = -45; a <= 45; a += 1) {
        const th = (a * Math.PI) / 180;
        const d = wallDist(th);
        const p = this.P({ x: d * Math.sin(th), y: d * Math.cos(th) });
        ctx.lineTo(p.x, p.y);
      }
      ctx.closePath();
      ctx.fillStyle = C.grassA;
      ctx.fill();
      ctx.clip();
      ctx.fillStyle = C.grassB;
      const stripe = 18 * s;
      ctx.save();
      ctx.translate(h0.x, h0.y);
      ctx.rotate(Math.PI / 4);
      for (let i = -40; i < 40; i += 2) ctx.fillRect(i * stripe, -2000, stripe, 4000);
      ctx.restore();
      ctx.restore();

      // Warning track.
      ctx.beginPath();
      for (let a = -45; a <= 45; a += 1) {
        const th = (a * Math.PI) / 180, d = wallDist(th) - 6;
        const p = this.P({ x: d * Math.sin(th), y: d * Math.cos(th) });
        a === -45 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y);
      }
      ctx.strokeStyle = C.warning; ctx.lineWidth = 12 * s; ctx.stroke();

      // Wall.
      ctx.beginPath();
      for (let a = -45; a <= 45; a += 1) {
        const th = (a * Math.PI) / 180, d = wallDist(th) + 2;
        const p = this.P({ x: d * Math.sin(th), y: d * Math.cos(th) });
        a === -45 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y);
      }
      ctx.strokeStyle = C.wall; ctx.lineWidth = Math.max(4, 7 * s); ctx.stroke();

      // Foul poles.
      [-45, 45].forEach((a) => {
        const th = (a * Math.PI) / 180, d = wallDist(th) + 2;
        const p = this.P({ x: d * Math.sin(th), y: d * Math.cos(th) });
        ctx.fillStyle = C.runner; ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(3, 4 * s), 0, Math.PI * 2); ctx.fill();
      });

      // Infield dirt arc (95 ft from the rubber) and baselines.
      const rubber = this.P({ x: 0, y: 60.5 });
      const hp = this.P(BASES.home);
      ctx.beginPath();
      ctx.moveTo(hp.x, hp.y);
      const f1 = this.P({ x: 90, y: 90 }), f3 = this.P({ x: -90, y: 90 });
      ctx.lineTo(f1.x, f1.y);
      ctx.arc(rubber.x, rubber.y, 95 * s, -Math.PI / 4 - 0.06, -Math.PI * 3 / 4 + 0.06, true);
      ctx.lineTo(f3.x, f3.y);
      ctx.closePath();
      ctx.fillStyle = C.clay; ctx.fill();

      // Infield grass diamond.
      const inset = 9;
      const g = [
        { x: 0, y: inset * 1.4 }, { x: 63.64 - inset, y: 63.64 }, { x: 0, y: 127.28 - inset * 1.4 }, { x: -63.64 + inset, y: 63.64 },
      ].map((p) => this.P(p));
      ctx.beginPath(); g.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.closePath();
      ctx.fillStyle = C.grassB; ctx.fill();

      // Mound + home plate circle.
      ctx.fillStyle = C.clay;
      ctx.beginPath(); ctx.arc(rubber.x, rubber.y, 9 * s, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(hp.x, hp.y, 13 * s, 0, Math.PI * 2); ctx.fill();

      // Foul lines.
      ctx.strokeStyle = C.chalk; ctx.lineWidth = Math.max(1, 1.8 * s);
      [-1, 1].forEach((dir) => {
        const d = wallDist(Math.PI / 4) + 2;
        const e = this.P({ x: (dir * d) / Math.SQRT2, y: d / Math.SQRT2 });
        ctx.beginPath(); ctx.moveTo(hp.x, hp.y); ctx.lineTo(e.x, e.y); ctx.stroke();
      });

      // Third base coach's box.
      const box = [{ x: -73, y: 50 }, { x: -81, y: 42 }, { x: -67, y: 28 }, { x: -59, y: 36 }].map((p) => this.P(p));
      ctx.setLineDash([2, 2]);
      ctx.beginPath(); box.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.closePath(); ctx.stroke();
      ctx.setLineDash([]);

      // Bases (drawn oversized so they read at a glance; real bases would be specks).
      const bs = Math.max(8, 7.5 * s);
      [BASES.first, BASES.second, BASES.third].forEach((b) => {
        const p = this.P(b);
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(Math.PI / 4);
        ctx.fillStyle = C.chalk; ctx.fillRect(-bs / 2, -bs / 2, bs, bs); ctx.restore();
      });
      const hs = Math.max(1.3, s) * 3.6;
      ctx.fillStyle = C.chalk;
      ctx.beginPath();
      ctx.moveTo(hp.x, hp.y + 0.6 * hs); ctx.lineTo(hp.x - hs, hp.y - 0.2 * hs); ctx.lineTo(hp.x - hs, hp.y - 1.1 * hs);
      ctx.lineTo(hp.x + hs, hp.y - 1.1 * hs); ctx.lineTo(hp.x + hs, hp.y - 0.2 * hs); ctx.closePath(); ctx.fill();
    }

    // ---------- positions over time ----------
    runnerS(t, mode) {
      const tl = this.tl;
      const sAt = (tt) => {
        if (tt <= tl.start) return tl.lead;
        if (tt <= tl.tAt3B) return tl.lead + (tt - tl.start) * tl.v;
        const dt = tt - tl.tAt3B;
        const turnDur = 2 * window.WM.K.turnLoss;
        return 90 + 0.5 * tl.v * Math.min(dt, turnDur) + tl.v * Math.max(0, dt - turnDur);
      };
      if (mode === "hold" && t > tl.decisionT) {
        const s0 = sAt(tl.decisionT);
        const peak = Math.max(s0 + 8, 96);
        const dt = t - tl.decisionT;
        if (dt < 0.7) return lerp(s0, peak, easeOut(dt / 0.7));
        return lerp(peak, 90, easeInOut(clamp01((dt - 0.7) / 0.9)));
      }
      return Math.min(180, sAt(t));
    }

    runnerPos(s) {
      const bow = Math.max(0, Math.sin(clamp01((s - 62) / 56) * Math.PI)) * 7; // drift wide around the bag
      if (s <= 90) {
        const u = s / 90;
        return { x: lerp(BASES.second.x, BASES.third.x, u) - bow, y: lerp(BASES.second.y, BASES.third.y, u) };
      }
      const u = Math.min(1, (s - 90) / 90);
      return { x: lerp(BASES.third.x, BASES.home.x, u) - bow, y: lerp(BASES.third.y, BASES.home.y, u) };
    }

    fielderPos(t) {
      const tl = this.tl;
      const u = easeOut(clamp01(t / tl.tField));
      const p = { x: lerp(tl.fielderStart.x, tl.fieldSpot.x, u), y: lerp(tl.fielderStart.y, tl.fieldSpot.y, u) };
      if (t > tl.tField) { // crow hop toward the target
        const k = clamp01((t - tl.tField) / (tl.release - tl.tField)) * 6;
        const d = Math.hypot(p.x, p.y);
        p.x -= (p.x / d) * k; p.y -= (p.y / d) * k;
      }
      return p;
    }

    ballState(t, mode) {
      const tl = this.tl, bb = this.play.batted_ball;
      if (t <= tl.tField) {
        const u = clamp01(t / tl.tField);
        const pu = bb.type === "ground_ball" ? easeOut(u) : u;
        const pos = { x: bb.x * pu, y: bb.y * pu };
        let h = 0;
        if (bb.type === "line_drive") h = Math.sin(Math.min(1, u / 0.85) * Math.PI) * 16 * (u < 0.85 ? 1 : 0);
        if (bb.type === "fly_ball" || bb.type === "popup") h = Math.sin(u * Math.PI) * 55;
        return { pos, h };
      }
      if (t <= tl.release) return { pos: this.fielderPos(t), h: 3, held: true };
      const target = mode === "hold" ? { x: -6, y: 72 } : { x: 0, y: 2 }; // cutoff man vs. plate
      const arrive = mode === "hold" ? tl.release + Math.hypot(tl.fieldSpot.x - target.x, tl.fieldSpot.y - target.y) / tl.vThrow
                                     : tl.throwArriveShown;
      const from = this.fielderPos(tl.release);
      const u = clamp01((t - tl.release) / (arrive - tl.release));
      const pos = { x: lerp(from.x, target.x, u), y: lerp(from.y, target.y, u) };
      const h = Math.sin(u * Math.PI) * 14;
      return { pos, h, thrown: true, arrived: u >= 1, from, target };
    }

    batterPos(t) {
      const s = Math.max(0, (t - 0.25) * 25.5);
      if (s <= 90) return { x: (BASES.first.x * s) / 90, y: (BASES.first.y * s) / 90 };
      const over = Math.min(14, (s - 90) * 0.5);
      const back = t > 6 ? Math.min(over, (t - 6) * 10) : 0;
      return { x: BASES.first.x + (over - back) * 0.6, y: BASES.first.y + (over - back) * 0.8 };
    }

    // ---------- drawing ----------
    label(text, x, y) {
      const ctx = this.ctx;
      ctx.font = `700 ${Math.max(16, Math.round(this.scale * 12.5))}px "Barlow Condensed", "Arial Narrow", sans-serif`;
      ctx.fillStyle = C.chalk; ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
      ctx.lineWidth = 4; ctx.lineJoin = "round"; ctx.strokeStyle = "rgba(20,40,28,0.9)";
      ctx.strokeText(text, x, y); ctx.fillText(text, x, y);
    }

    dot(p, r, fill, ring, label) {
      const ctx = this.ctx, q = this.P(p);
      ctx.beginPath(); ctx.arc(q.x, q.y, r, 0, Math.PI * 2);
      ctx.fillStyle = fill; ctx.fill();
      if (ring) { ctx.lineWidth = Math.max(2, r * 0.28); ctx.strokeStyle = ring; ctx.stroke(); }
      if (label) this.label(label, q.x, q.y - r - 6);
      return q;
    }

    drawCoach(t, mode, call) {
      const ctx = this.ctx;
      const q = this.P({ x: -70, y: 39 });
      const r = Math.max(8.5, this.scale * 4.6);
      ctx.strokeStyle = C.coach; ctx.lineWidth = Math.max(2, r * 0.45); ctx.lineCap = "round";
      const arm = r * 2.6;
      const arms = [];
      if (call === "send") {
        const a = t * 11; // windmill
        arms.push([Math.cos(a) * arm, Math.sin(a) * arm]);
        arms.push([-arm * 0.6, arm * 0.3]);
      } else if (call === "hold") {
        arms.push([-arm * 0.55, -arm]); arms.push([arm * 0.55, -arm]);
      } else {
        arms.push([-arm * 0.8, arm * 0.35]); arms.push([arm * 0.8, arm * 0.35]);
      }
      arms.forEach(([dx, dy]) => { ctx.beginPath(); ctx.moveTo(q.x, q.y); ctx.lineTo(q.x + dx, q.y + dy); ctx.stroke(); });
      ctx.beginPath(); ctx.arc(q.x, q.y, r, 0, Math.PI * 2); ctx.fillStyle = C.wall; ctx.fill(); ctx.stroke();
      this.label("You", q.x, q.y + r + arm + Math.max(16, this.scale * 12.5));  // below the arms' full reach
    }

    draw(frame) {
      // frame: { t, mode: 'approach'|'send'|'hold', call, ghost, umpire, banner }
      this.lastFrame = frame;
      if (!this.w || !this.h) return;
      const ctx = this.ctx;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      if (!this.bg) {
        this.bg = document.createElement("canvas");
        this.bg.width = this.canvas.width; this.bg.height = this.canvas.height;
        const b = this.bg.getContext("2d"); b.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        this.drawStatic(b);
      }
      ctx.drawImage(this.bg, 0, 0, this.w, this.h);
      if (!this.play) return;

      const { t, mode } = frame;
      const tl = this.tl;
      const s = this.scale;
      const r = Math.max(9, s * 6);

      // Runner trail.
      const sNow = this.runnerS(t, mode);
      ctx.beginPath();
      for (let x = tl.lead; x <= Math.min(sNow, 180); x += 3) {
        const q = this.P(this.runnerPos(x)); x === tl.lead ? ctx.moveTo(q.x, q.y) : ctx.lineTo(q.x, q.y);
      }
      ctx.strokeStyle = frame.ghost ? C.ghost : "rgba(242,194,48,0.6)"; ctx.lineWidth = 3; ctx.setLineDash([5, 5]); ctx.stroke(); ctx.setLineDash([]);

      // Throw trail.
      const ball = this.ballState(t, mode);
      if (ball.thrown) {
        const a = this.P(ball.from), b = this.P(ball.pos);
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
        ctx.strokeStyle = "rgba(255,255,255,0.45)"; ctx.lineWidth = 2.5; ctx.stroke();
      }

      // Fielders.
      this.dot({ x: 0, y: -5 + (ball.thrown && mode !== "hold" ? 4 : 0) }, r * 0.85, C.fielder, C.fielderRing, "C");
      this.dot(this.fielderPos(t), r, C.fielder, C.fielderRing, this.play.fielder.pos);
      this.dot({ x: 0, y: 60.5 + (t > 1 ? -12 * clamp01((t - 1) / 2) : 0) }, r * 0.75, C.fielder, C.fielderRing); // pitcher backing up
      this.dot(this.batterPos(t), r * 0.8, "rgba(242,194,48,0.65)", null);

      // Runner.
      this.dot(this.runnerPos(sNow), r, frame.ghost ? C.ghost : C.runner, C.wall, "R");

      // Ball + shadow.
      const bq = this.P(ball.pos);
      ctx.beginPath(); ctx.arc(bq.x + ball.h * s * 0.25, bq.y + ball.h * s * 0.15, Math.max(4, s * 2.6), 0, Math.PI * 2);
      ctx.fillStyle = "rgba(0,0,0,0.3)"; ctx.fill();
      ctx.beginPath(); ctx.arc(bq.x, bq.y - ball.h * s * 0.35, Math.max(5.5, s * 3.2 + ball.h * s * 0.04), 0, Math.PI * 2);
      ctx.fillStyle = C.ball; ctx.fill();
      ctx.lineWidth = 1.5; ctx.strokeStyle = "rgba(20,40,28,0.6)"; ctx.stroke();

      this.drawCoach(t, mode, frame.call);

      // Umpire call at the plate.
      if (frame.umpire) {
        const hp = this.P({ x: 0, y: 0 });
        ctx.font = `${Math.max(36, Math.round(s * 30))}px "Saira Stencil One", Impact, sans-serif`;
        ctx.textAlign = "left"; ctx.textBaseline = "middle";
        ctx.lineWidth = 9; ctx.lineJoin = "round"; ctx.strokeStyle = "rgba(20,40,28,0.92)";
        const txt = frame.umpire === "safe" ? "SAFE" : "OUT";
        const x = hp.x + Math.max(22, 16 * s), y = hp.y - Math.max(24, 16 * s);
        ctx.strokeText(txt, x, y);
        ctx.fillStyle = frame.umpire === "safe" ? C.chalk : C.out;
        ctx.fillText(txt, x, y);
        ctx.textBaseline = "alphabetic";
      }
      if (frame.banner) {
        const size = Math.max(17, Math.round(s * 13));
        ctx.font = `700 ${size}px "Barlow Condensed", "Arial Narrow", sans-serif`;
        const pad = size * 0.55, w = ctx.measureText(frame.banner).width + pad * 2, h = size * 1.7;
        const bx = 12, by = this.h - 12 - h;
        ctx.fillStyle = "rgba(20,42,30,0.92)"; ctx.fillRect(bx, by, w, h);
        ctx.fillStyle = C.runner; ctx.fillRect(bx, by, 4, h);
        ctx.fillStyle = C.chalk; ctx.textAlign = "left"; ctx.textBaseline = "middle";
        ctx.fillText(frame.banner, bx + pad, by + h / 2 + 1);
        ctx.textBaseline = "alphabetic";
      }
    }
  }

  window.Field = Field;
})();
