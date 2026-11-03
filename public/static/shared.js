// Helpers shared by the phone, projector and presenter pages.
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);

// Server clock offset, so every screen shows the same countdown.
let clockOffset = 0;
const serverNow = () => Date.now() + clockOffset;

function connectLive(role, onData, onStatus) {
  let es;
  const open = () => {
    es = new EventSource("/events?role=" + role);
    es.onopen = () => onStatus && onStatus(true);
    es.onmessage = (m) => {
      const d = JSON.parse(m.data);
      clockOffset = d.now - Date.now();
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

// Drives a .clock element from the poll state. Returns a stop function.
function runClock(el, state) {
  const fill = el.querySelector(".clock-fill");
  const num = el.querySelector(".clock-num");
  let raf;
  const tick = () => {
    const total = Math.max(1, state.duration * 1000);
    const left = Math.max(0, state.endsAt - serverNow());
    fill.style.transform = `scaleX(${left / total})`;
    const s = Math.ceil(left / 1000);
    num.textContent = s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` : String(s);
    el.classList.toggle("low", s <= 10);
    if (left > 0) raf = requestAnimationFrame(tick);
    else el.dispatchEvent(new Event("timeup"));
  };
  tick();
  return () => cancelAnimationFrame(raf);
}

const MATRIX_COLORS = { yes: "var(--teal)", somewhat: "var(--mid)", no: "var(--brick)" };

// Markup for one question's results. Bars start at zero; call growBars() after inserting to animate.
function resultsHTML(q, d) {
  if (!d || !d.n) return `<p class="empty-note">No answers to this question yet.</p>`;
  if (q.type === "matrix") {
    let h = `<div class="legend">${q.options.map((o) => `<span><i style="background:${MATRIX_COLORS[o.id]}"></i>${esc(o.label)}</span>`).join("")}</div>`;
    for (const r of q.rows) {
      const c = d.rows[r.id];
      h += `<div class="res-row"><div class="res-head"><span class="res-label">${esc(r.label)}</span></div><div class="stack">`;
      for (const o of q.options) {
        const p = pct(c[o.id], d.n);
        h += `<div class="${o.id}" data-grow="${c[o.id]}" title="${esc(o.label)}: ${c[o.id]} of ${d.n} (${p}%)">${p >= 10 ? p + "%" : ""}</div>`;
      }
      h += `</div></div>`;
    }
    return h;
  }
  const max = Math.max(...q.options.map((o) => d.counts[o.id]));
  let h = "";
  for (const o of q.options) {
    const c = d.counts[o.id], p = pct(c, d.n);
    h += `<div class="res-row${c === max && c > 0 ? " top" : ""}"><div class="res-head"><span class="res-label">${esc(o.label)}</span>` +
      `<span class="res-pct">${p}%<small>${c}</small></span></div>` +
      `<div class="res-track"><div class="res-fill" data-width="${p}"></div></div></div>`;
  }
  if (q.otherId && d.other && d.other.length) {
    h += `<div class="others"><p>Written in under “Other”</p><ul>${d.other.map((t) => `<li>${esc(t)}</li>`).join("")}</ul></div>`;
  }
  return h;
}

function growBars(root) {
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      root.querySelectorAll(".res-fill[data-width]").forEach((el) => (el.style.width = el.dataset.width + "%"));
      root.querySelectorAll(".stack [data-grow]").forEach((el) => {
        el.style.flexGrow = el.dataset.grow;
        if (el.dataset.grow === "0") el.style.display = "none";
      });
    })
  );
}

function answerNoun(n) {
  return n === 1 ? "1 answer" : `${n} answers`;
}
