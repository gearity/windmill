// Windmill: the leaderboard page. One board per clock setting, all time or the last 7 days.
(function () {
  const $ = (id) => document.getElementById(id);
  const Store = window.Store;
  const say = (key) => String(window.COPY[key] ?? key);   // page text, from js/copy.js
  const me = Store.lastUser().toLowerCase();
  const LIMIT = 50;
  const CLOCKS = [3, 5, 8, 0];

  // Open on the mode the visitor plays.
  const saved = Number(Store.timer(5));
  const view = { range: "all", clock: CLOCKS.includes(saved) ? saved : 5 };

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
      [rank, r.coach, r.streak, whenText(r.created_at)].forEach((v, j) => {
        const td = document.createElement("td");
        td.textContent = v;
        if (j === 2) td.className = "num";
        tr.appendChild(td);
      });
      body.appendChild(tr);
    });
    $("lbTable").hidden = !rows.length;
  }

  async function load() {
    document.querySelectorAll("#rangeTabs .lb-tab").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.range === view.range)));
    document.querySelectorAll("#modeTabs .lb-tab").forEach((b) => b.setAttribute("aria-selected", String(Number(b.dataset.clock) === view.clock)));
    $("lbStatus").hidden = false;
    $("lbStatus").textContent = say("boardLoading");
    try {
      const rows = await Store.fetchBoard(view.range, view.clock, LIMIT);
      render(rows);
      $("lbStatus").hidden = rows.length > 0;
      $("lbStatus").textContent = say("boardEmpty");
    } catch (e) {
      $("lbTable").hidden = true;
      $("lbStatus").textContent = Store.online
        ? say("boardDown")
        : say("boardOffline");
    }
  }

  document.querySelectorAll("#rangeTabs .lb-tab").forEach((b) => b.addEventListener("click", () => { view.range = b.dataset.range; load(); }));
  document.querySelectorAll("#modeTabs .lb-tab").forEach((b) => b.addEventListener("click", () => { view.clock = Number(b.dataset.clock); load(); }));
  load();
})();
