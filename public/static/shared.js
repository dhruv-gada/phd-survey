// Helpers shared by the phone, projector and presenter pages.
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);

function connectLive(role, onData, onStatus) {
  let es;
  const open = () => {
    es = new EventSource("/events?role=" + role);
    es.onopen = () => onStatus && onStatus(true);
    es.onmessage = (m) => {
      const d = JSON.parse(m.data);
      onStatus && onStatus(true);
      onData(d);
    };
    es.onerror = () => onStatus && onStatus(false);
  };
  open();
  // Phones lock and sleep; reconnect straight away when the page is visible again.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && es.readyState === EventSource.CLOSED) open();
  });
}

const MATRIX_COLORS = { yes: "var(--teal)", somewhat: "var(--mid)", no: "var(--brick)" };

// Markup for one question's results. Bars start at zero; showResults() animates them in
// and moves them to new values as answers arrive.
function resultsHTML(q, d) {
  if (!d || !d.n) return `<p class="empty-note">No answers yet.</p>`;
  if (q.type === "matrix") {
    let h = `<div class="legend">${q.options.map((o) => `<span><i style="background:${MATRIX_COLORS[o.id]}"></i>${esc(o.label)}</span>`).join("")}</div>`;
    for (const r of q.rows) {
      h += `<div class="res-row"><div class="res-head"><span class="res-label">${esc(r.label)}</span></div><div class="stack">`;
      for (const o of q.options) h += `<div class="${o.id}" data-r="${r.id}" data-o="${o.id}"></div>`;
      h += `</div></div>`;
    }
    return h;
  }
  let h = "";
  for (const o of q.options) {
    h += `<div class="res-row" data-o="${o.id}"><div class="res-head"><span class="res-label">${esc(o.label)}</span>` +
      `<span class="res-pct"><b>0%</b><small>0</small></span></div><div class="res-track"><div class="res-fill"></div></div></div>`;
  }
  if (q.otherId) h += `<div class="others" hidden><p>Written in under “Other”</p><ul></ul></div>`;
  return h;
}

function updateResults(root, q, d) {
  if (!d || !d.n) return;
  if (q.type === "matrix") {
    for (const r of q.rows) {
      const c = d.rows[r.id];
      for (const o of q.options) {
        const el = root.querySelector(`[data-r="${r.id}"][data-o="${o.id}"]`);
        if (!el) continue;
        const p = pct(c[o.id], d.n);
        el.style.flexGrow = c[o.id];
        el.style.display = c[o.id] ? "flex" : "none";
        el.textContent = p >= 10 ? p + "%" : "";
        el.title = `${o.label}: ${c[o.id]} of ${d.n} (${p}%)`;
      }
    }
    return;
  }
  const max = Math.max(...q.options.map((o) => d.counts[o.id]));
  for (const o of q.options) {
    const row = root.querySelector(`.res-row[data-o="${o.id}"]`);
    if (!row) continue;
    const c = d.counts[o.id], p = pct(c, d.n);
    row.querySelector(".res-pct b").textContent = p + "%";
    row.querySelector(".res-pct small").textContent = c;
    row.querySelector(".res-fill").style.width = p + "%";
    row.classList.toggle("top", c === max && c > 0);
  }
  const others = root.querySelector(".others");
  if (others && d.other) {
    others.hidden = !d.other.length;
    others.querySelector("ul").innerHTML = d.other.map((t) => `<li>${esc(t)}</li>`).join("");
  }
}

// Render a question's results into `root`, animating on first draw and gliding on later updates.
function showResults(root, q, d) {
  const hasData = !!(d && d.n);
  if (root.dataset.drawn !== String(hasData)) {
    root.innerHTML = resultsHTML(q, d);
    root.dataset.drawn = String(hasData);
    requestAnimationFrame(() => requestAnimationFrame(() => updateResults(root, q, d)));
  } else updateResults(root, q, d);
}

function answerNoun(n) {
  return n === 1 ? "1 answer" : `${n} answers`;
}
