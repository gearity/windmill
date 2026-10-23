// Windmill: saved coaches, streaks, and the shared leaderboard.
// Coaches and settings live in this browser's localStorage. Finished streaks also go to
// Supabase when js/config.js has its URL and key. All game code goes through window.Store.
(function () {
  const KEY_USERS = "windmill.users.v1";
  const KEY_LAST = "windmill.lastUser";
  const KEY_TIMER = "windmill.timer";
  const KEY_SOUND = "windmill.sound";
  const KEY_DEVICE = "windmill.device";

  // localStorage can throw (private windows, blocked storage), so every access is wrapped.
  function load(key, fallback) {
    try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); } catch (e) { return fallback; }
  }
  function save(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* fine */ } }

  let users = load(KEY_USERS, {});
  if (!users || typeof users !== "object") users = {};

  // A random id per browser, sent with each streak so spam from one device is easy to delete.
  let device = load(KEY_DEVICE, "");
  if (typeof device !== "string" || device.length < 8) {
    device = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, "0")).join("");
    save(KEY_DEVICE, device);
  }

  function cleanName(raw) { return String(raw || "").trim().replace(/\s+/g, " ").slice(0, 20); }

  // ---------- Supabase (REST, no library) ----------
  const cfg = window.WINDMILL_CONFIG || {};
  const online = !!(cfg.supabaseUrl && cfg.supabaseKey);
  // Accepts the project URL with or without the /rest/v1 suffix the dashboard shows.
  const base = online ? cfg.supabaseUrl.replace(/\/+$/, "").replace(/\/rest\/v1$/, "") + "/rest/v1" : "";
  function headers() {
    const h = { apikey: cfg.supabaseKey, "Content-Type": "application/json" };
    // Older projects use a JWT "anon" key, which also goes in Authorization. New sb_publishable_ keys don't.
    if (!cfg.supabaseKey.startsWith("sb_")) h.Authorization = "Bearer " + cfg.supabaseKey;
    return h;
  }

  window.Store = {
    cleanName,
    online,
    lastUser: () => load(KEY_LAST, "") || "",
    timer: (fallback) => load(KEY_TIMER, fallback),
    setTimer: (sec) => save(KEY_TIMER, sec),
    // Clips start muted until the visitor unmutes one; after that they keep sound on.
    sound: () => load(KEY_SOUND, false) === true,
    setSound: (on) => save(KEY_SOUND, !!on),

    // Returns the coach's record, creating it on first use.
    signIn(name) {
      if (!users[name]) users[name] = { best: 0, right: 0, wrong: 0, created: Date.now() };
      save(KEY_USERS, users);
      save(KEY_LAST, name);
      return users[name];
    },
    get: (name) => users[name] || null,

    // One graded call. streak is the coach's streak after this call.
    record(name, right, streak) {
      const u = users[name];
      if (!u) return;
      if (right) u.right += 1; else u.wrong += 1;
      if (streak > u.best) u.best = streak;
      save(KEY_USERS, users);
    },

    // Best streaks on this device, highest first.
    board(limit) {
      return Object.keys(users)
        .map((name) => ({ name, best: users[name].best || 0 }))
        .sort((a, b) => b.best - a.best)
        .slice(0, limit);
    },

    // Post a finished streak to the shared board. keepalive lets it finish while the page closes.
    // Failures are ignored: the leaderboard is a bonus, the game never waits on it.
    submitStreak(coach, streak, clock, keepalive) {
      if (!online || !coach || streak < 1) return;
      fetch(base + "/streaks", {
        method: "POST",
        headers: Object.assign(headers(), { Prefer: "return=minimal" }),
        body: JSON.stringify({ coach, streak, clock, device }),
        keepalive: !!keepalive,
      }).catch(() => {});
    },

    // Each coach's best streak, all time or the last 7 days.
    async fetchBoard(range, limit) {
      if (!online) throw new Error("offline");
      const view = range === "week" ? "board_week" : "board_all_time";
      const res = await fetch(`${base}/${view}?select=coach,streak,clock,created_at&order=streak.desc,created_at.asc&limit=${limit}`,
        { headers: headers() });
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
    },
  };
})();
