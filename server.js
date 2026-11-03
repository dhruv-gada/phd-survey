const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const QRCode = require("qrcode");
const { QUESTIONS } = require("./questions");

const PORT = process.env.PORT || 3000;
const PUBLIC_URL = process.env.PUBLIC_URL || ""; // optional override for the QR code
const ADMIN_USER = (process.env.ADMIN_USER || "").trim().toLowerCase();
const ADMIN_PASS = process.env.ADMIN_PASS || "";
const ADMIN_PATH = "/ad-reimagine-bme";
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");
const GRACE_MS = 1500; // answers sent just as the clock hits zero still count

/*
  Poll state, persisted so a restart (or Render waking from sleep) resumes where it was.
  phase: "lobby"  waiting for the presenter to start
         "open"   question `q` is accepting answers until `endsAt`
         "closed" question `q` is over and its results are shown
         "ended"  all results are shown
*/
const newSessionId = () => "s" + Date.now().toString(36);
const freshState = () => ({ session: newSessionId(), phase: "lobby", q: 0, endsAt: null, duration: 60, startedAt: null });

// ---------- storage: Postgres when DATABASE_URL is set, else a local JSON file ----------
let store;
if (process.env.DATABASE_URL) {
  const { Pool } = require("pg");
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL) ? false : { rejectUnauthorized: false },
  });
  store = {
    kind: "postgres",
    async init() {
      await pool.query("CREATE TABLE IF NOT EXISTS poll_state (id INT PRIMARY KEY, data JSONB NOT NULL)");
      await pool.query(`CREATE TABLE IF NOT EXISTS answers (
        session TEXT NOT NULL, q TEXT NOT NULL, device TEXT NOT NULL, answer JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (session, q, device))`);
      await pool.query("CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now())");
    },
    async addSession(id, name) {
      await pool.query("INSERT INTO sessions (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING", [id, name]);
    },
    async renameSession(id, name) {
      await pool.query("UPDATE sessions SET name = $2 WHERE id = $1", [id, name]);
    },
    async sessions() {
      const r = await pool.query("SELECT id, name, created_at FROM sessions ORDER BY created_at DESC");
      return r.rows.map((x) => ({ id: x.id, name: x.name, createdAt: x.created_at }));
    },
    async deleteSession(id) {
      await pool.query("DELETE FROM answers WHERE session = $1", [id]);
      await pool.query("DELETE FROM sessions WHERE id = $1", [id]);
    },
    async getState() {
      const r = await pool.query("SELECT data FROM poll_state WHERE id = 1");
      return r.rows[0] ? r.rows[0].data : null;
    },
    async setState(s) {
      await pool.query("INSERT INTO poll_state (id, data) VALUES (1, $1) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data", [s]);
    },
    // Returns false when this device already answered this question.
    async addAnswer(session, q, device, answer) {
      const r = await pool.query(
        "INSERT INTO answers (session, q, device, answer) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING",
        [session, q, device, answer]
      );
      return r.rowCount === 1;
    },
    async answers(session) {
      const r = session
        ? await pool.query("SELECT session, q, device, answer, created_at FROM answers WHERE session = $1", [session])
        : await pool.query("SELECT session, q, device, answer, created_at FROM answers ORDER BY created_at");
      return r.rows.map((x) => ({ session: x.session, q: x.q, device: x.device, answer: x.answer, at: x.created_at }));
    },
    async wipe() {
      await pool.query("DELETE FROM answers");
      await pool.query("DELETE FROM sessions");
    },
  };
} else {
  const file = path.join(__dirname, "data", "store.json");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let db = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : { state: null, answers: [] };
  db.sessions = db.sessions || [];
  const save = () => fs.writeFileSync(file, JSON.stringify(db));
  store = {
    kind: "file",
    async init() {},
    async getState() { return db.state; },
    async setState(s) { db.state = s; save(); },
    async addAnswer(session, q, device, answer) {
      if (db.answers.some((a) => a.session === session && a.q === q && a.device === device)) return false;
      db.answers.push({ session, q, device, answer, at: new Date().toISOString() });
      save();
      return true;
    },
    async answers(session) { return session ? db.answers.filter((a) => a.session === session) : db.answers; },
    async wipe() { db.answers = []; db.sessions = []; save(); },
    async addSession(id, name) {
      if (!db.sessions.some((x) => x.id === id)) { db.sessions.push({ id, name, createdAt: new Date().toISOString() }); save(); }
    },
    async renameSession(id, name) { const x = db.sessions.find((x) => x.id === id); if (x) { x.name = name; save(); } },
    async sessions() { return [...db.sessions].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)); },
    async deleteSession(id) {
      db.answers = db.answers.filter((a) => a.session !== id);
      db.sessions = db.sessions.filter((x) => x.id !== id);
      save();
    },
  };
}

// ---------- answer validation: only known option ids are kept ----------
function cleanAnswer(q, v) {
  const ids = new Set(q.options.map((o) => o.id));
  if (q.type === "single") {
    if (!v || !ids.has(v.choice)) return null;
    const out = { choice: v.choice };
    if (v.choice === q.otherId && typeof v.other === "string") {
      const t = v.other.replace(/\s+/g, " ").trim().slice(0, 200);
      if (t) out.other = t;
    }
    return out;
  }
  if (q.type === "multi") {
    if (!v || !Array.isArray(v.choices)) return null;
    const picked = [...new Set(v.choices.filter((x) => ids.has(x)))];
    return picked.length ? { choices: picked } : null;
  }
  if (q.type === "matrix") {
    if (!v || typeof v.rows !== "object" || !v.rows) return null;
    const rows = {};
    for (const r of q.rows) if (ids.has(v.rows[r.id])) rows[r.id] = v.rows[r.id];
    return Object.keys(rows).length === q.rows.length ? { rows } : null;
  }
  return null;
}

// ---------- aggregation for one session ----------
function summarize(answers) {
  const out = {};
  for (const q of QUESTIONS) {
    const list = answers.filter((a) => a.q === q.id).map((a) => a.answer);
    if (q.type === "matrix") {
      const rows = {};
      for (const r of q.rows) {
        const counts = Object.fromEntries(q.options.map((o) => [o.id, 0]));
        for (const a of list) if (a.rows && a.rows[r.id] in counts) counts[a.rows[r.id]]++;
        rows[r.id] = counts;
      }
      out[q.id] = { n: list.length, rows };
    } else {
      const counts = Object.fromEntries(q.options.map((o) => [o.id, 0]));
      for (const a of list) for (const c of [].concat(a.choice ?? a.choices ?? [])) if (c in counts) counts[c]++;
      const entry = { n: list.length, counts };
      if (q.otherId) entry.other = list.map((a) => a.other).filter(Boolean).slice(-24);
      out[q.id] = entry;
    }
  }
  return out;
}

// ---------- live state + realtime push (Server-Sent Events) ----------
let state = null;
let results = {};
const clients = new Set(); // { res, role }
let closeTimer = null;
let pushTimer = null;

async function refreshResults() {
  results = summarize(await store.answers(state.session));
}
function payload() {
  const phones = [...clients].filter((c) => c.role === "phone").length;
  const q = QUESTIONS[state.q];
  return {
    state,
    now: Date.now(),
    phones,
    answered: q ? results[q.id].n : 0,
    // Results of the current question stay hidden until it closes, so early answers don't sway later ones.
    results: state.phase === "open" ? null : results,
  };
}
function push() {
  // Coalesce bursts (many answers arriving at once) into one update every 250 ms.
  if (pushTimer) return;
  pushTimer = setTimeout(() => {
    pushTimer = null;
    const msg = `data: ${JSON.stringify(payload())}\n\n`;
    for (const c of clients) c.res.write(msg);
  }, 250);
}
function scheduleClose() {
  clearTimeout(closeTimer);
  if (state.phase !== "open" || !state.endsAt) return;
  closeTimer = setTimeout(() => setPhase({ phase: "closed" }).catch(console.error), Math.max(0, state.endsAt - Date.now() + GRACE_MS));
}
const cleanName = (n) => (typeof n === "string" ? n.replace(/\s+/g, " ").trim().slice(0, 80) : "");
async function defaultSessionName() {
  return "Session " + ((await store.sessions()).length + 1);
}
async function startSession(name) {
  const fresh = { ...freshState(), duration: state ? state.duration : 60 };
  await store.addSession(fresh.session, cleanName(name) || (await defaultSessionName()));
  await setPhase(fresh);
}
async function setPhase(patch) {
  state = { ...state, ...patch };
  if (state.phase !== "open") state.endsAt = null;
  await store.setState(state);
  await refreshResults();
  scheduleClose();
  push();
}

// ---------- app ----------
const app = express();
app.set("trust proxy", true);
app.disable("x-powered-by");
app.use(express.json({ limit: "10kb" }));

// Anonymous device cookie: a random id used only to stop the same phone answering a question twice.
function deviceId(req, res) {
  const m = /(?:^|;\s*)dev=([A-Za-z0-9_-]{16,64})/.exec(req.get("cookie") || "");
  if (m) return m[1];
  const id = crypto.randomBytes(16).toString("base64url");
  res.append("Set-Cookie", `dev=${id}; Path=/; Max-Age=31536000; SameSite=Lax; HttpOnly${req.secure ? "; Secure" : ""}`);
  return id;
}

const page = (name) => (req, res) => {
  if (name === "index.html") deviceId(req, res);
  res.set("Cache-Control", "no-cache");
  res.sendFile(path.join(__dirname, "public", name));
};
app.get("/", page("index.html"));
app.get(["/screen", "/results"], page("screen.html"));
app.get("/questions.js", (req, res) => res.sendFile(path.join(__dirname, "questions.js")));
app.use("/static", express.static(path.join(__dirname, "public", "static"), { maxAge: "5m" }));

app.get("/events", (req, res) => {
  const role = req.query.role === "phone" ? "phone" : "screen";
  res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive", "X-Accel-Buffering": "no" });
  res.flushHeaders();
  res.write("retry: 2000\n\n");
  res.write(`data: ${JSON.stringify(payload())}\n\n`);
  const client = { res, role };
  clients.add(client);
  push(); // phone count changed
  const ping = setInterval(() => res.write(": ping\n\n"), 20000);
  req.on("close", () => { clearInterval(ping); clients.delete(client); push(); });
});

// Which questions in the current session this phone has already answered.
app.get("/api/me", async (req, res) => {
  const dev = deviceId(req, res);
  const mine = (await store.answers(state.session)).filter((a) => a.device === dev).map((a) => a.q);
  res.set("Cache-Control", "no-store").json({ session: state.session, answered: mine });
});

app.post("/api/answer", async (req, res) => {
  const dev = deviceId(req, res);
  const q = QUESTIONS[state.q];
  const { question, answer } = req.body || {};
  if (state.phase !== "open" || !q || question !== q.id) {
    return res.status(409).json({ ok: false, error: "This question is closed." });
  }
  if (state.endsAt && Date.now() > state.endsAt + GRACE_MS) {
    return res.status(409).json({ ok: false, error: "Time is up for this question." });
  }
  const clean = cleanAnswer(q, answer);
  if (!clean) return res.status(400).json({ ok: false, error: "Choose an answer first." });
  try {
    const added = await store.addAnswer(state.session, q.id, dev, clean);
    if (!added) return res.json({ ok: true, duplicate: true });
    results[q.id] = summarize(await store.answers(state.session))[q.id];
    res.json({ ok: true });
    push();
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: "Your answer was not saved. Try again." });
  }
});

function surveyUrl(req) {
  return PUBLIC_URL || `${req.protocol}://${req.get("host")}/`;
}
app.get("/qr.svg", async (req, res) => {
  const svg = await QRCode.toString(surveyUrl(req), { type: "svg", margin: 0, errorCorrectionLevel: "M", color: { dark: "#0f2a2e", light: "#ffffff" } });
  res.type("image/svg+xml").set("Cache-Control", "no-cache").send(svg);
});
app.get("/api/url", (req, res) => res.json({ url: surveyUrl(req) }));

// ---------- presenter / admin (username + password from ADMIN_USER / ADMIN_PASS) ----------
const safeEq = (a, b) =>
  crypto.timingSafeEqual(crypto.createHash("sha256").update(String(a)).digest(), crypto.createHash("sha256").update(String(b)).digest());
const sign = (v) => crypto.createHmac("sha256", SESSION_SECRET).update(v).digest("base64url");
const LOGIN_HOURS = 12;
function isAdmin(req) {
  if (!ADMIN_USER || !ADMIN_PASS) return false;
  const m = /(?:^|;\s*)adm=([^;]+)/.exec(req.get("cookie") || "");
  if (!m) return false;
  const [exp, sig] = decodeURIComponent(m[1]).split(".");
  return !!exp && !!sig && Number(exp) > Date.now() && safeEq(sig, sign(exp));
}
function setAdminCookie(req, res, value, maxAge) {
  res.append("Set-Cookie", `adm=${encodeURIComponent(value)}; Path=${ADMIN_PATH}; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${req.secure ? "; Secure" : ""}`);
}
const fails = new Map(); // brute-force guard: 8 failed sign-ins per IP per 15 minutes
function tooMany(ip) {
  const now = Date.now();
  const list = (fails.get(ip) || []).filter((t) => now - t < 15 * 60e3);
  fails.set(ip, list);
  return list.length >= 8;
}
const needAdmin = (req, res, next) => (isAdmin(req) ? next() : res.status(403).json({ ok: false, error: "Sign in again to continue." }));

const admin = express.Router();
admin.use((req, res, next) => { res.set("Cache-Control", "no-store"); res.set("X-Robots-Tag", "noindex"); next(); });
admin.get("/", (req, res) => res.sendFile(path.join(__dirname, "public", "admin.html")));
admin.get("/me", (req, res) => res.json({ admin: isAdmin(req) }));
admin.post("/login", (req, res) => {
  const ip = req.ip || "?";
  if (!ADMIN_USER || !ADMIN_PASS) return res.status(503).json({ ok: false, error: "Admin sign-in is not set up on the server." });
  if (tooMany(ip)) return res.status(429).json({ ok: false, error: "Too many attempts. Wait 15 minutes and try again." });
  const { username = "", password = "" } = req.body || {};
  const ok = safeEq(String(username).trim().toLowerCase(), ADMIN_USER) & safeEq(String(password), ADMIN_PASS);
  if (!ok) {
    fails.get(ip).push(Date.now());
    return res.status(401).json({ ok: false, error: "That username and password don't match." });
  }
  fails.delete(ip);
  const exp = String(Date.now() + LOGIN_HOURS * 3600e3);
  setAdminCookie(req, res, `${exp}.${sign(exp)}`, LOGIN_HOURS * 3600);
  res.json({ ok: true });
});
admin.post("/logout", (req, res) => { setAdminCookie(req, res, "", 0); res.json({ ok: true }); });

admin.get("/status", needAdmin, async (req, res) => {
  const all = await store.answers();
  const sessions = [...new Set(all.map((a) => a.session))];
  const meta = (await store.sessions()).find((x) => x.id === state.session);
  res.json({ ...payload(), results, storage: store.kind, sessionName: meta ? meta.name : "", sessions: sessions.length, totalAnswers: all.length });
});

admin.post("/control", needAdmin, async (req, res) => {
  const body = req.body || {};
  const { action } = body;
  const dur = Math.min(600, Math.max(10, Number(body.duration) || state.duration || 60));
  switch (action) {
    case "start": {
      const qi = Number.isInteger(body.q) ? body.q : state.q;
      if (!QUESTIONS[qi]) return res.status(400).json({ ok: false, error: "Unknown question." });
      await setPhase({ phase: "open", q: qi, duration: dur, startedAt: Date.now(), endsAt: Date.now() + dur * 1000 });
      break;
    }
    case "extend":
      if (state.phase !== "open") return res.status(409).json({ ok: false, error: "No question is open." });
      await setPhase({ endsAt: state.endsAt + 15000, duration: state.duration + 15 });
      break;
    case "close":
      await setPhase({ phase: "closed" });
      break;
    case "summary":
      await setPhase({ phase: "ended" });
      break;
    case "lobby":
      await setPhase({ phase: "lobby" });
      break;
    case "duration":
      await setPhase({ duration: dur });
      break;
    case "new-session":
      await startSession(body.name);
      break;
    case "rename-session": {
      const n = cleanName(body.name);
      if (!n) return res.status(400).json({ ok: false, error: "Type a name for the session." });
      await store.renameSession(body.session || state.session, n);
      break;
    }
    case "delete-session": {
      if (!body.session) return res.status(400).json({ ok: false, error: "Choose a session to delete." });
      await store.deleteSession(body.session);
      if (body.session === state.session) await startSession();
      else await refreshResults();
      break;
    }
    case "delete-all":
      await store.wipe();
      await startSession();
      break;
    default:
      return res.status(400).json({ ok: false, error: "Unknown action." });
  }
  res.json({ ok: true, ...payload(), results });
});

// Every session with how many phones answered, newest first.
admin.get("/sessions", needAdmin, async (req, res) => {
  const [list, all] = await Promise.all([store.sessions(), store.answers()]);
  const people = {}, answers = {};
  for (const a of all) {
    (people[a.session] = people[a.session] || new Set()).add(a.device);
    answers[a.session] = (answers[a.session] || 0) + 1;
  }
  res.json({
    current: state.session,
    sessions: list.map((x) => ({ ...x, respondents: people[x.id] ? people[x.id].size : 0, answers: answers[x.id] || 0 })),
  });
});

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || "session";

// One row per phone. ?session=<id> downloads one session; without it, every session in one file.
admin.get("/export.csv", async (req, res) => {
  if (!isAdmin(req)) return res.status(403).send("Sign in at " + ADMIN_PATH + " to download responses.");
  const only = typeof req.query.session === "string" ? req.query.session : "";
  const sessionList = await store.sessions();
  const names = Object.fromEntries(sessionList.map((x) => [x.id, x]));
  if (only && !names[only]) return res.status(404).send("That session doesn't exist.");
  const all = await store.answers(only || undefined);
  const cols = ["session", "session_started_at", "respondent", "first_answer_at"];
  for (const q of QUESTIONS) {
    if (q.type === "matrix") q.rows.forEach((r) => cols.push(`${q.id}_${r.id}`));
    else { cols.push(q.id); if (q.otherId) cols.push(q.id + "_other"); }
  }
  const people = new Map();
  for (const a of all) {
    const key = a.session + "|" + a.device;
    if (!people.has(key)) people.set(key, { session: a.session, at: a.at, ans: {} });
    const p = people.get(key);
    if (new Date(a.at) < new Date(p.at)) p.at = a.at;
    p.ans[a.q] = a.answer;
  }
  const counters = {};
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = [cols.join(",")];
  for (const p of people.values()) {
    counters[p.session] = (counters[p.session] || 0) + 1;
    const meta = names[p.session];
    const vals = [meta ? meta.name : p.session, meta ? new Date(meta.createdAt).toISOString() : "", counters[p.session], new Date(p.at).toISOString()];
    for (const q of QUESTIONS) {
      const a = p.ans[q.id];
      if (q.type === "matrix") q.rows.forEach((r) => vals.push(a?.rows?.[r.id] ?? ""));
      else {
        vals.push([].concat(a?.choice ?? a?.choices ?? []).join("; "));
        if (q.otherId) vals.push(a?.other ?? "");
      }
    }
    lines.push(vals.map(esc).join(","));
  }
  let filename = "phd-survey-all-sessions.csv";
  if (only) {
    const m = names[only];
    filename = `phd-survey-${slug(m.name)}-${new Date(m.createdAt).toISOString().slice(0, 10)}.csv`;
  }
  // Byte-order mark so Excel reads accents and quotes correctly.
  res.type("text/csv").set("Content-Disposition", `attachment; filename="${filename}"`).send("\ufeff" + lines.join("\n"));
});
app.use(ADMIN_PATH, admin);

(async () => {
  await store.init();
  state = { ...freshState(), ...((await store.getState()) || {}) };
  if (state.phase === "open" && state.endsAt && Date.now() > state.endsAt + GRACE_MS) state.phase = "closed";
  if (state.phase !== "open") state.endsAt = null;
  await store.setState(state);
  if (!(await store.sessions()).some((x) => x.id === state.session)) await store.addSession(state.session, await defaultSessionName());
  await refreshResults();
  scheduleClose();
  app.listen(PORT, () => console.log(`Poll running on port ${PORT} (storage: ${store.kind})`));
})();
