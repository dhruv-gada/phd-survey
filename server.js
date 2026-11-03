const express = require("express");
const path = require("path");
const fs = require("fs");
const QRCode = require("qrcode");
const { QUESTIONS } = require("./questions");

const PORT = process.env.PORT || 3000;
const crypto = require("crypto");
const ADMIN_USER = (process.env.ADMIN_USER || "").trim().toLowerCase();
const ADMIN_PASS = process.env.ADMIN_PASS || "";
const ADMIN_PATH = "/ad-reimagine-bme";
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");
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

// ---------- admin (username + password from ADMIN_USER / ADMIN_PASS) ----------
const safeEq = (a, b) => {
  const x = crypto.createHash("sha256").update(String(a)).digest();
  const y = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
};
const sign = (v) => crypto.createHmac("sha256", SESSION_SECRET).update(v).digest("base64url");
const SESSION_HOURS = 12;
function makeToken() {
  const exp = String(Date.now() + SESSION_HOURS * 3600e3);
  return exp + "." + sign(exp);
}
function isAdmin(req) {
  if (!ADMIN_USER || !ADMIN_PASS) return false;
  const m = /(?:^|;\s*)adm=([^;]+)/.exec(req.get("cookie") || "");
  if (!m) return false;
  const [exp, sig] = decodeURIComponent(m[1]).split(".");
  return !!exp && !!sig && Number(exp) > Date.now() && safeEq(sig, sign(exp));
}
function setCookie(req, res, value, maxAge) {
  const secure = req.secure ? "; Secure" : "";
  res.set("Set-Cookie", `adm=${encodeURIComponent(value)}; Path=${ADMIN_PATH}; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`);
}
// simple brute-force guard: 8 failed logins per IP per 15 minutes
const fails = new Map();
function tooMany(ip) {
  const now = Date.now();
  const list = (fails.get(ip) || []).filter((t) => now - t < 15 * 60e3);
  fails.set(ip, list);
  return list.length >= 8;
}

const adminRouter = express.Router();
adminRouter.use((req, res, next) => { res.set("Cache-Control", "no-store"); res.set("X-Robots-Tag", "noindex"); next(); });
adminRouter.get("/", (req, res) => res.sendFile(path.join(__dirname, "public", "admin.html")));
adminRouter.get("/me", (req, res) => res.json({ admin: isAdmin(req) }));
adminRouter.post("/login", (req, res) => {
  const ip = req.ip || "?";
  if (!ADMIN_USER || !ADMIN_PASS) return res.status(503).json({ ok: false, error: "Admin login is not configured." });
  if (tooMany(ip)) return res.status(429).json({ ok: false, error: "Too many attempts. Try again in 15 minutes." });
  const { username = "", password = "" } = req.body || {};
  const okUser = safeEq(String(username).trim().toLowerCase(), ADMIN_USER);
  const okPass = safeEq(String(password), ADMIN_PASS);
  if (!(okUser && okPass)) {
    fails.get(ip).push(Date.now());
    return res.status(401).json({ ok: false, error: "Incorrect username or password." });
  }
  fails.delete(ip);
  setCookie(req, res, makeToken(), SESSION_HOURS * 3600);
  res.json({ ok: true });
});
adminRouter.post("/logout", (req, res) => { setCookie(req, res, "", 0); res.json({ ok: true }); });
adminRouter.get("/export.csv", async (req, res) => {
  if (!isAdmin(req)) return res.status(403).send("Please sign in first.");
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
adminRouter.post("/reset", async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ ok: false, error: "Please sign in first." });
  await store.clear();
  await broadcast();
  res.json({ ok: true });
});
app.use(ADMIN_PATH, adminRouter);

store.init().then(() => {
  app.listen(PORT, () => console.log(`Survey running on http://localhost:${PORT}`));
});
