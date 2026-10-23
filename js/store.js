// Windmill: saved coaches and streaks.
// Everything lives in this browser's localStorage. All game code goes through
// window.Store, so a shared online leaderboard can later be added here (send each
// finished streak somewhere, read the board back) without touching game.js.
(function () {
  const KEY_USERS = "windmill.users.v1";
  const KEY_LAST = "windmill.lastUser";
  const KEY_TIMER = "windmill.timer";
  const KEY_SOUND = "windmill.sound";

  // localStorage can throw (private windows, blocked storage), so every access is wrapped.
  function load(key, fallback) {
    try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); } catch (e) { return fallback; }
  }
  function save(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* fine */ } }

  let users = load(KEY_USERS, {});
  if (!users || typeof users !== "object") users = {};

  function cleanName(raw) { return String(raw || "").trim().replace(/\s+/g, " ").slice(0, 20); }

  window.Store = {
    cleanName,
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
  };
})();
