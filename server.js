const express = require("express");
const path = require("path");
const fs = require("fs");
const QRCode = require("qrcode");
const { QUESTIONS } = require("./questions");

const PORT = process.env.PORT || 3000;
const ADMIN_KEY = process.env.ADMIN_KEY || "";
const PUBLIC_URL = process.env.PUBLIC_URL || ""; // optional override for the QR code

// ---------- storage: Postgres when DATABASE_URL is set, else a local JSON file ----------
let store;
if (process.env.DATABASE_URL) {
  const { Pool } = require("pg");
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL.includes("localhost") ? false : { rejectUnauthorized: false },
  });
  store = {
    async init() {
      await pool.query(
        "CREATE TABLE IF NOT EXISTS responses (id SERIAL PRIMARY KEY, created_at TIMESTAMPTZ DEFAULT now(), data JSONB NOT NULL)"
      );
    },
    async all() {
      const r = await pool.query("SELECT created_at, data FROM responses ORDER BY id");
      return r.rows.map((x) => ({ at: x.created_at, ...x.data }));
    },
    async add(d) {
      await pool.query("INSERT INTO responses (data) VALUES ($1)", [d]);
    },
    async clear() {
      await pool.query("DELETE FROM responses");
    },
  };
} else {
  const file = path.join(__dirname, "data", "responses.json");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let rows = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : [];
  const save = () => fs.writeFileSync(file, JSON.stringify(rows));
  store = {
    async init() {},
    async all() { return rows; },
    async add(d) { rows.push({ at: new Date().toISOString(), ...d }); save(); },
    async clear() { rows = []; save(); },
  };
}

// ---------- validation: only accept known option ids; nothing identifying is stored ----------
function clean(body) {
  const out = {};
  let answered = 0;
  for (const q of QUESTIONS) {
    const v = body[q.id];
    const ids = new Set(q.options.map((o) => o.id));
    if (q.type === "single") {
      if (ids.has(v)) {
        out[q.id] = v;
        answered++;
        if (v === q.otherId && typeof body[q.id + "_other"] === "string") {
          const t = body[q.id + "_other"].replace(/\s+/g, " ").trim().slice(0, 200);
          if (t) out[q.id + "_other"] = t;
        }
      }
    } else if (q.type === "multi") {
      if (Array.isArray(v)) {
        const picked = [...new Set(v.filter((x) => ids.has(x)))];
        if (picked.length) { out[q.id] = picked; answered++; }
      }
    } else if (q.type === "matrix") {
      if (v && typeof v === "object") {
        const m = {};
        for (const r of q.rows) if (ids.has(v[r.id])) m[r.id] = v[r.id];
        if (Object.keys(m).length) { out[q.id] = m; answered++; }
      }
    }
  }
  return answered ? out : null;
}

// ---------- aggregation ----------
function summarize(rows) {
  const s = { total: rows.length, questions: {} };
  for (const q of QUESTIONS) {
    if (q.type === "matrix") {
      const rowsOut = {};
      for (const r of q.rows) {
        const c = Object.fromEntries(q.options.map((o) => [o.id, 0]));
        let n = 0;
        for (const row of rows) {
          const a = row[q.id] && row[q.id][r.id];
          if (a && a in c) { c[a]++; n++; }
        }
        rowsOut[r.id] = { counts: c, n };
      }
      s.questions[q.id] = { rows: rowsOut };
    } else {
      const c = Object.fromEntries(q.options.map((o) => [o.id, 0]));
      let n = 0;
      for (const row of rows) {
        const a = row[q.id];
        if (a == null) continue;
        n++;
        for (const x of [].concat(a)) if (x in c) c[x]++;
      }
      const entry = { counts: c, n };
      if (q.otherId) {
        entry.otherText = rows.map((r) => r[q.id + "_other"]).filter(Boolean).slice(-30).reverse();
      }
      s.questions[q.id] = entry;
    }
  }
  return s;
}

// ---------- realtime: Server-Sent Events ----------
const clients = new Set();
let cached = null;
async function broadcast() {
  cached = summarize(await store.all());
  const msg = `data: ${JSON.stringify(cached)}\n\n`;
  for (const res of clients) res.write(msg);
}

// ---------- app ----------
const app = express();
app.set("trust proxy", true);
app.use(express.json({ limit: "10kb" }));

app.get("/questions.js", (req, res) => res.sendFile(path.join(__dirname, "questions.js")));
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
app.get("/results", (req, res) => res.sendFile(path.join(__dirname, "public", "results.html")));

app.post("/api/submit", async (req, res) => {
  const data = clean(req.body || {});
  if (!data) return res.status(400).json({ ok: false, error: "Please answer at least one question." });
  try {
    await store.add(data);
    res.json({ ok: true });
    broadcast().catch(console.error);
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: "Could not save. Please try again." });
  }
});

app.get("/api/summary", async (req, res) => {
  if (!cached) cached = summarize(await store.all());
  res.json(cached);
});

app.get("/events", async (req, res) => {
  res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive", "X-Accel-Buffering": "no" });
  res.flushHeaders();
  if (!cached) cached = summarize(await store.all());
  res.write(`data: ${JSON.stringify(cached)}\n\n`);
  clients.add(res);
  const ping = setInterval(() => res.write(": ping\n\n"), 25000);
  req.on("close", () => { clearInterval(ping); clients.delete(res); });
});

function surveyUrl(req) {
  return PUBLIC_URL || `${req.protocol}://${req.get("host")}/`;
}
app.get("/qr.svg", async (req, res) => {
  const svg = await QRCode.toString(surveyUrl(req), { type: "svg", margin: 1, errorCorrectionLevel: "M" });
  res.type("image/svg+xml").send(svg);
});
app.get("/api/url", (req, res) => res.json({ url: surveyUrl(req) }));

// ---------- admin (needs ADMIN_KEY) ----------
function isAdmin(req) {
  return ADMIN_KEY && (req.query.key === ADMIN_KEY || req.get("x-admin-key") === ADMIN_KEY);
}
app.get("/export.csv", async (req, res) => {
  if (!isAdmin(req)) return res.status(403).send("Forbidden");
  const rows = await store.all();
  const cols = ["submitted_at"];
  for (const q of QUESTIONS) {
    if (q.type === "matrix") q.rows.forEach((r) => cols.push(`${q.id}_${r.id}`));
    else { cols.push(q.id); if (q.otherId) cols.push(q.id + "_other"); }
  }
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = [cols.join(",")];
  for (const r of rows) {
    const vals = [new Date(r.at).toISOString()];
    for (const q of QUESTIONS) {
      if (q.type === "matrix") q.rows.forEach((x) => vals.push(r[q.id]?.[x.id] ?? ""));
      else {
        vals.push([].concat(r[q.id] ?? []).join("; "));
        if (q.otherId) vals.push(r[q.id + "_other"] ?? "");
      }
    }
    lines.push(vals.map(esc).join(","));
  }
  res.type("text/csv").set("Content-Disposition", 'attachment; filename="survey-responses.csv"').send(lines.join("\n"));
});
app.post("/api/reset", async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ ok: false });
  await store.clear();
  await broadcast();
  res.json({ ok: true });
});
app.get("/admin", (req, res) => res.sendFile(path.join(__dirname, "public", "admin.html")));

store.init().then(() => {
  app.listen(PORT, () => console.log(`Survey running on http://localhost:${PORT}`));
});
