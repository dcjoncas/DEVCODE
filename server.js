const express = require("express");
const http = require("http");
const { exec } = require("child_process");
const { Server } = require("socket.io");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

let sqlite3 = null;
try { sqlite3 = require("sqlite3").verbose(); } catch (e) { /* ok */ }

// Safe fetch (Node 18+ has global fetch)
let fetchFn = global.fetch;
if (!fetchFn) {
  try { fetchFn = require("node-fetch"); } catch { /* ok */ }
}

const app = express();
const server = http.createServer(app);

const io = new Server(server, { cors: { origin: "*" } });
app.use(express.json({ limit: "6mb" }));

// Serve client UI
app.use(express.static(path.join(__dirname, "client")));

// ✅ Logo support even if stored in /templates
app.get("/dev-ready-logo.svg", (req, res) => {
  const pClient = path.join(__dirname, "client", "dev-ready-logo.svg");
  const pTemplates = path.join(__dirname, "templates", "dev-ready-logo.svg");
  const p = fs.existsSync(pClient) ? pClient : (fs.existsSync(pTemplates) ? pTemplates : null);
  if (!p) return res.status(404).send("Logo not found");
  res.sendFile(p);
});

const RECORD_DIR = path.join(__dirname, "session_records");
if (!fs.existsSync(RECORD_DIR)) fs.mkdirSync(RECORD_DIR);

function recordPath(sessionId) {
  return path.join(RECORD_DIR, `${sessionId}.jsonl`);
}
function metaPath(sessionId) {
  return path.join(RECORD_DIR, `${sessionId}.meta.json`);
}
function recordExists(sessionId) {
  const p = recordPath(sessionId);
  try { return fs.existsSync(p) && fs.statSync(p).size > 0; } catch { return false; }
}

const MAX_SNAPSHOT_CHARS = 220000;

function capText(s) {
  s = String(s ?? "");
  if (s.length <= MAX_SNAPSHOT_CHARS) return { text: s, truncated: false };
  return { text: s.slice(0, MAX_SNAPSHOT_CHARS) + "\n…(truncated)…", truncated: true };
}

function safeWriteMeta(sessionId, first, last) {
  try {
    const meta = {
      sessionId,
      first: String(first || "").trim(),
      last: String(last || "").trim(),
      candidateName: [String(first || "").trim(), String(last || "").trim()].filter(Boolean).join(" ").trim(),
      updatedAt: Date.now()
    };
    fs.writeFileSync(metaPath(sessionId), JSON.stringify(meta, null, 2), "utf8");
  } catch (e) {
    console.log("[META] write failed:", e.message);
  }
}

// NOTE: RecordingActive throttles high-volume events (typing snapshots),
// but we ALWAYS record important events like run outputs + hint responses.
function logEvent(sessionId, type, payload = {}, force = false) {
  const s = sessions[sessionId];

  // If not forced, only record when actively recording
  if (!force && (!s || !s.recordingActive)) return;

  try {
    const line = JSON.stringify({
      ts: Date.now(),
      sessionId,
      type,
      ...payload
    }) + "\n";
    fs.appendFileSync(recordPath(sessionId), line, "utf8");
  } catch (e) {
    console.log("[RECORD] failed:", e.message);
  }
}

function rowsToAsciiTable(rows, maxColWidth = 40) {
  if (!rows || rows.length === 0) return "(no rows)";
  const cols = Object.keys(rows[0]);

  const clamp = (s) => {
    s = String(s ?? "");
    return s.length > maxColWidth ? s.slice(0, maxColWidth - 1) + "…" : s;
  };

  const widths = Object.fromEntries(cols.map(c => [c, c.length]));
  for (const r of rows) for (const c of cols) widths[c] = Math.max(widths[c], clamp(r[c]).length);

  const pad = (s, w) => String(s).padEnd(w, " ");
  const sep = cols.map(c => "-".repeat(widths[c])).join("-+-");
  const header = cols.map(c => pad(c, widths[c])).join(" | ");
  const body = rows.map(r => cols.map(c => pad(clamp(r[c]), widths[c])).join(" | "));
  return [header, sep, ...body].join("\n");
}

// =======================
// Session state (in memory)
// =======================
const SESSION_TTL_MS = 30 * 60 * 1000;
const sessions = {}; // sessionId -> session state

function ensureSession(sessionId) {
  if (!sessions[sessionId]) {
    sessions[sessionId] = {
      expiresAt: Date.now() + SESSION_TTL_MS,
      ended: false,
      hintsLeft: 3,
      candidateMeta: null,
      lastOutput: "",
      lastCode: "",
      lastLang: "python",
      recordingActive: false,
      recordingStartedAt: null,
      recordingStoppedAt: null,
      lastCodeSnapAt: 0,
      lastCodeSnapHash: "",
      hostKey: crypto.randomBytes(16).toString("hex"),
      currentChallenge: null
    };
  }
  return sessions[sessionId];
}

function isSessionActive(sessionId) {
  const s = sessions[sessionId];
  if (!s) return false;
  if (s.ended) return false;
  if (Date.now() > s.expiresAt) return false;
  return true;
}

function endSession(sessionId, reason = "ended_by_host") {
  const s = sessions[sessionId];
  if (!s) return;
  s.ended = true;

  // always record session end
  logEvent(sessionId, "sessionEnded", { reason }, true);

  io.to(sessionId).emit("sessionEnded", { reason: reason === "expired" ? "expired" : "ended" });
  console.log(`[SESSION] Ended: ${sessionId} reason=${reason}`);
}

setInterval(() => {
  for (const [id, s] of Object.entries(sessions)) {
    if (!s.ended && Date.now() > s.expiresAt) endSession(id, "expired");
  }
}, 15000);

function quickHash(str) {
  str = String(str || "");
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return String(h >>> 0);
}

function maybeLogCodeSnapshot(sessionId, code, reason = "typing", force = false) {
  const s = ensureSession(sessionId);

  // typing snapshots are large/high-volume -> only when recording is active (or forced)
  if (!s.recordingActive && !force) return;

  const now = Date.now();
  const hash = quickHash(code);
  const THROTTLE_MS = 650;

  if (!force) {
    if (now - s.lastCodeSnapAt < THROTTLE_MS && hash === s.lastCodeSnapHash) return;
    if (now - s.lastCodeSnapAt < THROTTLE_MS) return;
  }

  const capped = capText(code);
  logEvent(sessionId, "codeSnapshot", {
    reason,
    code: capped.text,
    truncated: capped.truncated
  }, true);

  s.lastCodeSnapAt = now;
  s.lastCodeSnapHash = hash;
}

// =======================
// Candidate name extraction for list/replay
// =======================
function extractCandidateName(sessionId) {
  // Prefer sidecar meta file (fast + reliable)
  try {
    const mp = metaPath(sessionId);
    if (fs.existsSync(mp)) {
      const m = JSON.parse(fs.readFileSync(mp, "utf8"));
      return String(m.candidateName || "").trim();
    }
  } catch {}

  // Fallback: scan jsonl
  try {
    const p = recordPath(sessionId);
    if (!fs.existsSync(p)) return "";
    const lines = fs.readFileSync(p, "utf8").split("\n").filter(Boolean);
    let first = "", last = "";
    for (const ln of lines) {
      try {
        const e = JSON.parse(ln);
        if (e.type === "candidateMetaUpdate") {
          if (typeof e.first === "string") first = e.first.trim();
          if (typeof e.last === "string") last = e.last.trim();
        }
      } catch {}
    }
    return [first, last].filter(Boolean).join(" ").trim();
  } catch {
    return "";
  }
}

// =======================
// Challenge Library (V2)
// =======================
const CHALLENGES_DIR = path.join(__dirname, "challenges");

function normalizeLang(lang) {
  const s = String(lang || "").toLowerCase().trim();
  if (s === "js") return "javascript";
  if (s === "cs") return "csharp";
  return s;
}

function safeReadJson(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  const obj = JSON.parse(raw);
  return obj;
}

function listChallengeFiles(lang) {
  const d = path.join(CHALLENGES_DIR, lang);
  if (!fs.existsSync(d)) return [];
  return fs.readdirSync(d)
    .filter(f => f.toLowerCase().endsWith(".json"))
    .map(f => path.join(d, f));
}

function pickRandom(arr) {
  if (!arr || !arr.length) return null;
  return arr[Math.floor(Math.random() * arr.length)];
}

function loadRandomLibraryChallenge(lang, level) {
  lang = normalizeLang(lang);
  level = parseInt(level, 10);

  const files = listChallengeFiles(lang);
  const candidates = [];

  for (const fp of files) {
    try {
      const c = safeReadJson(fp);
      const cLang = normalizeLang(c.language);
      if (cLang !== lang) continue;
      if (Number(c.level) !== level) continue;
      candidates.push(c);
    } catch {}
  }

  return pickRandom(candidates);
}

function requireHostKey(req, sessionId) {
  const key = String(req.query.k || req.headers["x-host-key"] || "").trim();
  const s = ensureSession(sessionId);
  if (!key || key !== s.hostKey) return false;
  return true;
}

function extractResponsesText(json) {
  // Most reliable in current Responses API: output_text
  if (json && typeof json.output_text === "string" && json.output_text.trim()) {
    return json.output_text.trim();
  }

  // Fallback: older content-walk
  let text = "";
  if (json && Array.isArray(json.output)) {
    for (const item of json.output) {
      if (item && Array.isArray(item.content)) {
        for (const c of item.content) {
          if (c?.type === "output_text" && c.text) text += c.text;
        }
      }
    }
  }
  return String(text || "").trim();
}

// =======================
// Pages
// =======================
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "client", "index.html")));
app.get("/session/:id", (req, res) => res.sendFile(path.join(__dirname, "client", "index.html")));

app.get("/solve/:id", (req, res) => {
  // reduce caching surprises
  res.setHeader("Cache-Control", "no-store");
  res.sendFile(path.join(__dirname, "client", "solve.html"));
});

app.get("/session/:id/record", (req, res) => {
  const sessionId = req.params.id;
  const p = recordPath(sessionId);
  if (!fs.existsSync(p)) return res.status(404).send("No record found");
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${sessionId}.jsonl"`);
  res.send(fs.readFileSync(p, "utf8"));
});

app.get("/records", (req, res) => res.sendFile(path.join(__dirname, "client", "records.html")));
app.get("/replay/:id", (req, res) => res.sendFile(path.join(__dirname, "client", "replay.html")));

app.get("/api/health", (req, res) => res.json({ ok: true, ts: Date.now() }));

app.get("/api/records", (req, res) => {
  const files = fs.readdirSync(RECORD_DIR).filter(f => f.endsWith(".jsonl"));

  const list = files.map(f => {
    const p = path.join(RECORD_DIR, f);
    const st = fs.statSync(p);
    const sessionId = f.replace(".jsonl", "");
    const candidateName = extractCandidateName(sessionId);

    return {
      sessionId,
      candidateName,
      size: st.size,
      modifiedAt: st.mtimeMs
    };
  }).sort((a, b) => b.modifiedAt - a.modifiedAt);

  res.json({ records: list });
});

app.get("/api/record/:id", (req, res) => {
  const sessionId = req.params.id;
  const p = recordPath(sessionId);
  if (!fs.existsSync(p)) return res.status(404).json({ error: "No record found" });

  const lines = fs.readFileSync(p, "utf8").split("\n").filter(Boolean);
  const events = [];
  for (const ln of lines) { try { events.push(JSON.parse(ln)); } catch {} }
  events.sort((a, b) => (a.ts || 0) - (b.ts || 0));

  const candidateName = extractCandidateName(sessionId);
  res.json({ sessionId, candidateName, events });
});

// OPTIONAL: Delete a record file (dev-friendly)
// DELETE /api/record/:id?admin=YOUR_ADMIN_KEY
app.delete("/api/record/:id", (req, res) => {
  const adminKey = process.env.ADMIN_KEY;
  if (adminKey) {
    const got = String(req.query.admin || "").trim();
    if (!got || got !== adminKey) return res.status(403).json({ error: "Forbidden" });
  }

  const sessionId = req.params.id;
  const p = recordPath(sessionId);
  const mp = metaPath(sessionId);

  try {
    if (fs.existsSync(p)) fs.unlinkSync(p);
    if (fs.existsSync(mp)) fs.unlinkSync(mp);
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// =======================
// Challenge APIs
// =======================

// ✅ Random from library: /api/challenge/random?sessionId=abc&lang=python&level=1&k=<hostKey>
app.get("/api/challenge/random", (req, res) => {
  const sessionId = String(req.query.sessionId || "").trim();
  const lang = normalizeLang(req.query.lang);
  const level = parseInt(req.query.level, 10);

  if (!sessionId) return res.status(400).json({ error: "Missing sessionId" });
  if (!isSessionActive(sessionId)) return res.status(400).json({ error: "Session not active" });
  if (!requireHostKey(req, sessionId)) return res.status(403).json({ error: "Forbidden" });

  if (!lang || ![1,2,3].includes(level)) return res.status(400).json({ error: "Invalid lang/level" });
  if (!fs.existsSync(CHALLENGES_DIR)) return res.status(400).json({ error: "Missing challenges/ folder" });

  const ch = loadRandomLibraryChallenge(lang, level);
  if (!ch) return res.status(404).json({ error: `No library challenges found for ${lang} level ${level}` });

  const s = ensureSession(sessionId);
  s.currentChallenge = { ...ch, source: "library" };

  logEvent(sessionId, "challengeLoaded", { source: "library", id: ch.id, language: lang, level }, true);

  // broadcast prompt/title to both
  io.to(sessionId).emit("challengeUpdate", {
    id: ch.id,
    source: "library",
    title: ch.title || "",
    prompt: ch.prompt || "",
    language: ch.language,
    level: ch.level
  });

  res.json({ challenge: ch });
});

// ✅ AI challenge: /api/challenge/ai?k=<hostKey>  (POST)
// body: { sessionId, lang, level }
app.post("/api/challenge/ai", async (req, res) => {
  const sessionId = String(req.body?.sessionId || "").trim();
  const lang = normalizeLang(req.body?.lang);
  const level = parseInt(req.body?.level, 10);

  if (!sessionId) return res.status(400).json({ error: "Missing sessionId" });
  if (!isSessionActive(sessionId)) return res.status(400).json({ error: "Session not active" });
  if (!requireHostKey(req, sessionId)) return res.status(403).json({ error: "Forbidden" });

  if (!lang || ![1,2,3].includes(level)) return res.status(400).json({ error: "Invalid lang/level" });

  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || "gpt-5";
  if (!apiKey) return res.status(400).json({ error: "OPENAI_API_KEY not set on server" });
  if (!fetchFn) return res.status(400).json({ error: "fetch not available. Use Node 18+ or install node-fetch." });

  const theme = "fibonacci";

  const system = [
    "You generate short coding interview challenges.",
    "Return ONLY valid JSON (no markdown, no commentary).",
    "Schema:",
    "{ id, title, language, level, prompt, starterCode, solutionCode }",
    "- id: short string unique-ish",
    "- language: one of: sql, python, javascript, csharp, java",
    "- level: 1|2|3",
    "- starterCode MUST be intentionally flawed/broken for the level",
    "- solutionCode MUST be correct and runnable",
    "",
    "Theme requirements:",
    "- For code languages (python/javascript/csharp/java): Fibonacci-themed.",
    "  L1: broken base case or small bug fix",
    "  L2: memoization required",
    "  L3: fast approach (iterative DP or fast doubling) and/or modulo 1_000_000_007",
    "",
    "- For SQL (SQLite): use Customers / Invoices / Projects tables.",
    "  L1: simple broken SELECT (typo like form->from or bad quotes)",
    "  L2: GROUP BY with filter and sort",
    "  L3: CTE + join / aggregation",
    "",
    "Keep prompts concise."
  ].join("\n");

  const user = JSON.stringify({ language: lang, level, theme }, null, 0);

  try {
    const resp = await fetchFn("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        input: [
          { role: "system", content: system },
          { role: "user", content: user }
        ]
      })
    });

    const json = await resp.json();
    if (!resp.ok) {
      return res.status(500).json({ error: `OpenAI error ${resp.status}`, detail: json });
    }

    const text = extractResponsesText(json);

    let challenge = null;
    try {
      challenge = JSON.parse(text);
    } catch (e) {
      return res.status(500).json({
        error: "AI did not return valid JSON.",
        raw: text.slice(0, 4000)
      });
    }

    if (!challenge || !challenge.starterCode || !challenge.prompt) {
      return res.status(500).json({ error: "AI JSON missing required fields.", raw: challenge });
    }

    challenge.language = lang;
    challenge.level = level;

    const s = ensureSession(sessionId);
    s.currentChallenge = { ...challenge, source: "ai" };

    logEvent(sessionId, "challengeLoaded", { source: "ai", id: challenge.id, language: lang, level }, true);

    io.to(sessionId).emit("challengeUpdate", {
      id: challenge.id,
      source: "ai",
      title: challenge.title || "",
      prompt: challenge.prompt || "",
      language: challenge.language,
      level: challenge.level
    });

    res.json({ challenge });
  } catch (e) {
    res.status(500).json({ error: "AI challenge error", detail: e.message });
  }
});

// ✅ Solve: /api/challenge/solve?sessionId=abc&k=<hostKey>
app.get("/api/challenge/solve", async (req, res) => {
  const sessionId = String(req.query.sessionId || "").trim();
  if (!sessionId) return res.status(400).json({ error: "Missing sessionId" });
  if (!isSessionActive(sessionId)) return res.status(400).json({ error: "Session not active" });
  if (!requireHostKey(req, sessionId)) return res.status(403).json({ error: "Forbidden" });

  const s = ensureSession(sessionId);
  const ch = s.currentChallenge;
  if (!ch) return res.status(400).json({ error: "No challenge loaded for this session yet." });

  // If challenge includes solutionCode, use it (fast + reliable + avoids blank).
  if (ch.solutionCode && String(ch.solutionCode).trim()) {
    return res.json({
      ok: true,
      source: ch.source || "library",
      language: ch.language,
      title: ch.title || "Solution",
      level: ch.level,
      prompt: String(ch.prompt || ""),
      solutionCode: String(ch.solutionCode)
    });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || "gpt-5";
  if (!apiKey || !fetchFn) {
    return res.json({
      ok: true,
      source: ch.source || "library",
      language: ch.language,
      title: ch.title || "Solution",
      level: ch.level,
      prompt: String(ch.prompt || ""),
      solutionCode:
        "No solutionCode available for this library challenge.\n\n" +
        "Option A: add `solutionCode` into the JSON file.\n" +
        "Option B: set OPENAI_API_KEY so the server can generate a solution."
    });
  }

  const prompt = [
    "Solve this coding interview challenge.",
    "Return ONLY the corrected final code (no markdown, no commentary).",
    "",
    `Language: ${ch.language}`,
    `Level: ${ch.level}`,
    "Prompt:",
    ch.prompt || "",
    "",
    "Starter code:",
    ch.starterCode || ""
  ].join("\n");

  try {
    const resp = await fetchFn("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body: JSON.stringify({ model, input: prompt })
    });

    const json = await resp.json();
    if (!resp.ok) {
      return res.json({
        ok: false,
        error: `Solve failed (${resp.status})`,
        detail: json
      });
    }

    const out = extractResponsesText(json) || "(no solution returned)";
    res.json({
      ok: true,
      source: ch.source || "library",
      language: ch.language,
      title: ch.title || "Solution",
      level: ch.level,
      prompt: String(ch.prompt || ""),
      solutionCode: out
    });
  } catch (e) {
    res.json({
      ok: false,
      error: "Solve error",
      detail: e.message
    });
  }
});

// =======================
// Socket.IO
// =======================
io.on("connection", (socket) => {
  console.log("[SOCKET] User connected:", socket.id);

  socket.on("joinSession", ({ sessionId, role, candidateMeta }) => {
    if (!sessionId) return;

    const s = ensureSession(sessionId);

    socket.data.sessionId = sessionId;
    socket.data.role = role || "candidate";
    socket.join(sessionId);

    // Candidate name
    if (socket.data.role === "candidate" && candidateMeta) {
      const first = String(candidateMeta.first || "").trim();
      const last = String(candidateMeta.last || "").trim();
      if (first || last) {
        s.candidateMeta = { first, last };
        safeWriteMeta(sessionId, first, last);

        io.to(sessionId).emit("candidateMetaUpdate", s.candidateMeta);
        logEvent(sessionId, "candidateMetaUpdate", { first, last, source: "candidate_join" }, true);
      }
    }

    // IMPORTANT: host gets hostKey; candidate does not
    socket.emit("sessionJoined", {
      expiresAt: s.expiresAt,
      candidateMeta: s.candidateMeta,
      recordingActive: s.recordingActive,
      recordExists: recordExists(sessionId),
      hostKey: (socket.data.role === "host") ? s.hostKey : null,
      currentChallenge: s.currentChallenge
        ? { id: s.currentChallenge.id, title: s.currentChallenge.title, prompt: s.currentChallenge.prompt, language: s.currentChallenge.language, level: s.currentChallenge.level, source: s.currentChallenge.source }
        : null
    });

    if (s.lastCode) socket.emit("codeUpdate", s.lastCode);
    if (s.lastLang) socket.emit("languageUpdate", s.lastLang);
    if (s.lastOutput) socket.emit("outputUpdate", s.lastOutput);

    if (s.currentChallenge) {
      socket.emit("challengeUpdate", {
        id: s.currentChallenge.id,
        source: s.currentChallenge.source || "",
        title: s.currentChallenge.title || "",
        prompt: s.currentChallenge.prompt || "",
        language: s.currentChallenge.language,
        level: s.currentChallenge.level
      });
    }

    socket.emit("recordingStatus", { active: s.recordingActive, recordExists: recordExists(sessionId) });

    console.log(`[SOCKET] joinSession: ${socket.id} -> ${sessionId} role: ${socket.data.role}`);
  });

  // host-only: broadcast challenge text manually (optional)
  socket.on("challengeUpdate", (payload) => {
    const sessionId = socket.data.sessionId;
    if (!sessionId || !isSessionActive(sessionId)) return;
    if (socket.data.role !== "host") return;

    const safe = {
      id: String(payload?.id || ""),
      source: String(payload?.source || ""),
      title: String(payload?.title || ""),
      prompt: String(payload?.prompt || ""),
      language: normalizeLang(payload?.language),
      level: Number(payload?.level || 0)
    };
    io.to(sessionId).emit("challengeUpdate", safe);
    logEvent(sessionId, "challengeUpdate", safe, true);
  });

  socket.on("startRecording", () => {
    const sessionId = socket.data.sessionId;
    if (!sessionId) return;
    if (socket.data.role !== "host") return;

    const s = ensureSession(sessionId);
    if (s.recordingActive) return;

    s.recordingActive = true;
    s.recordingStartedAt = Date.now();
    s.recordingStoppedAt = null;

    logEvent(sessionId, "recordingStarted", { startedAt: s.recordingStartedAt }, true);

    // Snapshot state at start
    maybeLogCodeSnapshot(sessionId, s.lastCode || "", "recording_start", true);
    logEvent(sessionId, "languageUpdate", { lang: s.lastLang || "python" }, true);

    const cappedOut = capText(s.lastOutput || "");
    logEvent(sessionId, "outputSnapshot", { text: cappedOut.text, truncated: cappedOut.truncated, reason: "recording_start" }, true);

    io.to(sessionId).emit("recordingStatus", { active: true, recordExists: recordExists(sessionId) });
    console.log(`[RECORD] Started: ${sessionId}`);
  });

  socket.on("stopRecording", () => {
    const sessionId = socket.data.sessionId;
    if (!sessionId) return;
    if (socket.data.role !== "host") return;

    const s = ensureSession(sessionId);
    if (!s.recordingActive) return;

    maybeLogCodeSnapshot(sessionId, s.lastCode || "", "recording_stop", true);

    const cappedOut = capText(s.lastOutput || "");
    logEvent(sessionId, "outputSnapshot", { text: cappedOut.text, truncated: cappedOut.truncated, reason: "recording_stop" }, true);

    s.recordingActive = false;
    s.recordingStoppedAt = Date.now();

    logEvent(sessionId, "recordingStopped", { stoppedAt: s.recordingStoppedAt }, true);

    io.to(sessionId).emit("recordingStatus", { active: false, recordExists: recordExists(sessionId) });
    console.log(`[RECORD] Stopped: ${sessionId}`);
  });

  socket.on("codeUpdate", (code) => {
    const sessionId = socket.data.sessionId;
    if (!sessionId || !isSessionActive(sessionId)) return;

    const s = ensureSession(sessionId);
    s.lastCode = String(code || "");

    // Only record typing snapshots when recording is active (handled inside)
    maybeLogCodeSnapshot(sessionId, s.lastCode, "typing", false);

    socket.to(sessionId).emit("codeUpdate", s.lastCode);
  });

  socket.on("languageUpdate", (lang) => {
    const sessionId = socket.data.sessionId;
    if (!sessionId || !isSessionActive(sessionId)) return;

    const s = ensureSession(sessionId);
    s.lastLang = String(lang || "python");

    // language is important -> always record
    logEvent(sessionId, "languageUpdate", { lang: s.lastLang }, true);

    socket.to(sessionId).emit("languageUpdate", s.lastLang);
  });

  socket.on("outputUpdate", (text) => {
    const sessionId = socket.data.sessionId;
    if (!sessionId || !isSessionActive(sessionId)) return;

    const s = ensureSession(sessionId);
    s.lastOutput = String(text || "");

    // output is important -> always record
    const capped = capText(s.lastOutput);
    logEvent(sessionId, "outputSnapshot", { text: capped.text, truncated: capped.truncated, reason: "client_outputUpdate" }, true);

    io.to(sessionId).emit("outputUpdate", s.lastOutput);
  });

  socket.on("endSession", () => {
    const sessionId = socket.data.sessionId;
    if (!sessionId) return;
    if (socket.data.role !== "host") return;
    endSession(sessionId, "ended_by_host");
  });

  socket.on("candidateMetaUpdate", (meta) => {
    const sessionId = socket.data.sessionId;
    if (!sessionId || !isSessionActive(sessionId)) return;

    const first = String(meta?.first || "").trim();
    const last = String(meta?.last || "").trim();

    const s = ensureSession(sessionId);
    s.candidateMeta = { first, last };
    safeWriteMeta(sessionId, first, last);

    io.to(sessionId).emit("candidateMetaUpdate", s.candidateMeta);
    logEvent(sessionId, "candidateMetaUpdate", { first, last, source: socket.data.role }, true);
  });

  socket.on("requestHint", async () => {
    const sessionId = socket.data.sessionId;
    if (!sessionId || !isSessionActive(sessionId)) return;

    const s = ensureSession(sessionId);
    if (s.hintsLeft <= 0) {
      io.to(sessionId).emit("hintResponse", { hint: "No hints left.", hintsLeft: 0, broadcast: true });
      logEvent(sessionId, "hintResponse", { hint: "No hints left.", truncated: false, hintsLeft: 0 }, true);
      return;
    }

    s.hintsLeft -= 1;
    logEvent(sessionId, "hintRequested", { hintsLeft: s.hintsLeft }, true);

    const apiKey = process.env.OPENAI_API_KEY;
    const model = process.env.OPENAI_MODEL || "gpt-5";

    if (!apiKey) {
      const msg = "AI hints are not configured. Set OPENAI_API_KEY in your server environment and restart node.";
      io.to(sessionId).emit("hintResponse", { hint: msg, hintsLeft: s.hintsLeft, broadcast: true });
      logEvent(sessionId, "hintResponse", { hint: msg, truncated: false, hintsLeft: s.hintsLeft }, true);
      return;
    }
    if (!fetchFn) {
      const msg = "fetch not available on server. Use Node 18+ or install node-fetch.";
      io.to(sessionId).emit("hintResponse", { hint: msg, hintsLeft: s.hintsLeft, broadcast: true });
      logEvent(sessionId, "hintResponse", { hint: msg, truncated: false, hintsLeft: s.hintsLeft }, true);
      return;
    }

    try {
      const code = s.lastCode || "";
      const lang = s.lastLang || "python";
      const out = s.lastOutput || "";

      const prompt = [
        "You are a coding interview assistant.",
        "Given the candidate's code and the current output/error, provide ONE helpful hint.",
        "Do NOT give a full solution. Keep it short and actionable (3-6 sentences).",
        "",
        `Language: ${lang}`,
        "Code:",
        code,
        "",
        "Output/Error:",
        out
      ].join("\n");

      const resp = await fetchFn("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`
        },
        body: JSON.stringify({ model, input: prompt })
      });

      const json = await resp.json();
      if (!resp.ok) {
        const msg = `AI hint request failed (${resp.status}). ${JSON.stringify(json, null, 2)}`;
        io.to(sessionId).emit("hintResponse", { hint: msg, hintsLeft: s.hintsLeft, broadcast: true });
        logEvent(sessionId, "hintResponse", { hint: capText(msg).text, truncated: capText(msg).truncated, hintsLeft: s.hintsLeft }, true);
        return;
      }

      const hintText = extractResponsesText(json) || "No hint returned. Try again after running code.";

      const capped = capText(hintText);
      logEvent(sessionId, "hintResponse", { hint: capped.text, truncated: capped.truncated, hintsLeft: s.hintsLeft }, true);

      // ✅ broadcast to BOTH candidate + interviewer
      io.to(sessionId).emit("hintResponse", { hint: hintText, hintsLeft: s.hintsLeft, broadcast: true });
    } catch (e) {
      const msg = `AI hint error: ${e.message}`;
      io.to(sessionId).emit("hintResponse", { hint: msg, hintsLeft: s.hintsLeft, broadcast: true });
      logEvent(sessionId, "hintResponse", { hint: msg, truncated: false, hintsLeft: s.hintsLeft }, true);
    }
  });

  socket.on("disconnect", (reason) => {
    const sessionId = socket.data.sessionId;
    if (sessionId) logEvent(sessionId, "disconnect", { socketId: socket.id, reason }, true);
  });
});

// =======================
// Runner (/run)
// =======================
app.post("/run", (req, res) => {
  const { sessionId, code, language } = req.body || {};

  if (!sessionId) return res.json({ output: "No sessionId provided" });
  if (!isSessionActive(sessionId)) return res.json({ output: "Session is not active (ended or expired)." });
  if (!code) return res.json({ output: "No code received" });

  const s = ensureSession(sessionId);
  s.lastCode = String(code || "");
  s.lastLang = String(language || "python");

  // ✅ always record run metadata + a snapshot before run
  maybeLogCodeSnapshot(sessionId, s.lastCode, "run", true);
  logEvent(sessionId, "run", { language: s.lastLang, codeLength: s.lastCode.length }, true);

  const finish = (out) => {
    const text = String(out || "");
    s.lastOutput = text;

    // ✅ always record output for replay
    const capped = capText(text);
    logEvent(sessionId, "runResult", { output: capped.text, truncated: capped.truncated }, true);
    logEvent(sessionId, "outputSnapshot", { text: capped.text, truncated: capped.truncated, reason: "run_finish" }, true);

    // ✅ server broadcasts output -> both screens always update
    io.to(sessionId).emit("outputUpdate", text);

    return res.json({ output: text });
  };

  try {
    if (language === "python") {
      fs.writeFileSync(path.join(__dirname, "script.py"), code, "utf8");
      exec(`python "${path.join(__dirname, "script.py")}"`, { timeout: 8000 }, (err, stdout, stderr) => {
        if (err) return finish(stderr || stdout || err.message);
        return finish(stdout || "(no output)");
      });
      return;
    }

    if (language === "javascript") {
      fs.writeFileSync(path.join(__dirname, "script.js"), code, "utf8");
      exec(`node "${path.join(__dirname, "script.js")}"`, { timeout: 8000 }, (err, stdout, stderr) => {
        if (err) return finish(stderr || stdout || err.message);
        return finish(stdout || "(no output)");
      });
      return;
    }

    if (language === "sql") {
      if (!sqlite3) return finish("sqlite3 module not installed. Run: npm i sqlite3");

      const DB_PATH = path.join(__dirname, "lineage.db");
      const raw = String(code || "");
      const stmt = raw.trim().replace(/;+\s*$/, "");

      const allow = /^(select|with|pragma|explain)\b/i.test(stmt);
      if (!allow) return finish("Only read queries are allowed (SELECT/WITH/PRAGMA/EXPLAIN) in this mode.");

      const db = new sqlite3.Database(DB_PATH, sqlite3.OPEN_READONLY, (err) => {
        if (err) return finish("SQL open error: " + err.message);

        db.all(stmt, [], (err2, rows) => {
          if (err2) {
            db.close();
            return finish("SQL error: " + err2.message);
          }
          db.close();
          return finish(rowsToAsciiTable(rows));
        });
      });
      return;
    }

    if (language === "csharp") {
      const runnerDir = path.join(__dirname, "csharp_runner");
      if (!fs.existsSync(runnerDir)) fs.mkdirSync(runnerDir);

      const csproj = path.join(runnerDir, "DevReadyRunner.csproj");
      const program = path.join(runnerDir, "Program.cs");

      if (!fs.existsSync(csproj)) {
        fs.writeFileSync(csproj, `
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net7.0</TargetFramework>
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>enable</Nullable>
  </PropertyGroup>
</Project>
`.trim(), "utf8");
      }

      fs.writeFileSync(program, code, "utf8");

      exec(`dotnet restore "${csproj}"`, { timeout: 30000 }, (rErr, rOut, rErrOut) => {
        if (rErr) return finish(rErrOut || rOut || rErr.message);

        exec(`dotnet run --project "${csproj}"`, { timeout: 15000 }, (err, stdout, stderr) => {
          if (err) return finish(stderr || stdout || err.message);
          return finish(stdout || "(no output)");
        });
      });
      return;
    }

    if (language === "java") {
      const tmpDir = path.join(__dirname, "java_runner");
      if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir);

      const mainJava = path.join(tmpDir, "Main.java");
      fs.writeFileSync(mainJava, code, "utf8");

      const javacGuess = `"C:\\Program Files\\Java\\jdk1.8.0_361\\bin\\javac.exe"`;
      const javaGuess = `"C:\\Program Files\\Java\\jdk1.8.0_361\\bin\\java.exe"`;

      const cmd = `${javacGuess} "${mainJava}" && ${javaGuess} -cp "${tmpDir}" Main`;
      exec(cmd, { timeout: 20000 }, (err, stdout, stderr) => {
        if (err) return finish((stderr || stdout || err.message) + "\n\n(Install a JDK or add javac to PATH.)");
        return finish(stdout || "(no output)");
      });
      return;
    }

    return finish("Unsupported language: " + language);
  } catch (err) {
    return finish("Internal error: " + err.message);
  }
});

// Bind to all IPv4 interfaces for ngrok
server.listen(3001, "0.0.0.0", () => {
  console.log("[SERVER] Running on http://0.0.0.0:3001");
});
