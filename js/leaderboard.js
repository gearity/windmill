// Windmill: the leaderboard page.
(function () {
  const $ = (id) => document.getElementById(id);
  const Store = window.Store;
  const me = Store.lastUser().toLowerCase();
  const LIMIT = 50;

  function clockText(sec) { return sec === 0 ? "Off" : `${sec} sec`; }
  function whenText(iso) {
    const d = new Date(iso);
    return isNaN(d) ? "" : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }

  function render(rows) {
    const body = $("lbBody");
    body.replaceChildren();
    let rank = 0, prev = null;
    rows.forEach((r, i) => {
      if (r.streak !== prev) { rank = i + 1; prev = r.streak; }   // ties share a rank
      const tr = document.createElement("tr");
      if (r.coach.toLowerCase() === me) tr.className = "me";
      [rank, r.coach, r.streak, clockText(r.clock), whenText(r.created_at)].forEach((v, j) => {
        const td = document.createElement("td");
        td.textContent = v;
        if (j === 2) td.className = "num";
        tr.appendChild(td);
      });
      body.appendChild(tr);
    });
    $("lbTable").hidden = !rows.length;
  }

  async function load(range) {
    document.querySelectorAll(".lb-tab").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.range === range)));
    $("lbStatus").hidden = false;
    $("lbStatus").textContent = "Loading the board.";
    try {
      const rows = await Store.fetchBoard(range, LIMIT);
      render(rows);
      $("lbStatus").hidden = rows.length > 0;
      $("lbStatus").textContent = range === "week" ? "No streaks in the last 7 days yet. Go set one." : "No streaks yet. Go set one.";
    } catch (e) {
      $("lbTable").hidden = true;
      $("lbStatus").textContent = Store.online
        ? "Couldn't reach the leaderboard. Try again in a minute."
        : "The leaderboard isn't connected yet.";
    }
  }

  document.querySelectorAll(".lb-tab").forEach((b) => b.addEventListener("click", () => load(b.dataset.range)));
  load("all");
})();
