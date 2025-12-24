const socket = io();

const language = document.getElementById("language");
const output = document.getElementById("output");
const runBtn = document.getElementById("run");
const clearBtn = document.getElementById("clear");
const hintBtn = document.getElementById("hint");
const endSessionBtn = document.getElementById("end-session");
const newSessionBtn = document.getElementById("new-session");
const loadScriptBtn = document.getElementById("load-script");
const fileInput = document.getElementById("file-input");

const sessionLinkInput = document.getElementById("session-link");
const sessionStatus = document.getElementById("session-status");
const roleBadge = document.getElementById("role-badge");
const sessionLinkBlock = document.querySelector(".dr-session-link-block");

const recordingStatusEl = document.getElementById("recording-status");
const startRecBtn = document.getElementById("start-recording");
const stopRecBtn = document.getElementById("stop-recording");
const downloadRecordLink = document.getElementById("download-record");
const replayThisLink = document.getElementById("replay-this");
const openRecordingsLink = document.getElementById("open-recordings");

const processingEl = document.getElementById("processing");
const processingText = document.getElementById("processing-text");

const nameModal = document.getElementById("name-modal");
const candFirst = document.getElementById("cand-first");
const candLast = document.getElementById("cand-last");
const candJoin = document.getElementById("cand-join");
const candNameHint = document.getElementById("cand-name-hint");

const candidateDisplay = document.getElementById("candidate-display");

const challengeSource = document.getElementById("challenge-source");
const challengeLevel = document.getElementById("challenge-level");
const loadChallengeBtn = document.getElementById("load-challenge");
const solveBtn = document.getElementById("solve-challenge");
const challengeBox = document.getElementById("challenge-box");

/** Monaco DOM + fallback */
const monacoHostEl = document.getElementById("editor");
const fallbackTextarea = document.getElementById("editor-textarea");

/** Solve modal */
const solveModal = document.getElementById("solve-modal");
const solveFrame = document.getElementById("solve-frame");
const closeSolveBtn = document.getElementById("close-solve");

let sessionId = null;
let role = "host";
let expiresAt = null;
let joinedOnce = false;
let localCandidateMeta = { first: "", last: "" };

let hostKey = null;

let hintInFlight = false;
let runInFlight = false;
let challengeInFlight = false;

/** Monaco state */
let useMonaco = true;
let monacoEditor = null;
let monacoModel = null;
let suppressEmit = false;
let emitTimer = null;

function setProcessing(on, label) {
  if (!processingEl) return;
  if (on) {
    processingText.textContent = label || "Processing…";
    processingEl.style.display = "inline-flex";
  } else {
    processingEl.style.display = "none";
    processingText.textContent = "Processing…";
  }
}

function syncButtons() {
  const busy = hintInFlight || runInFlight || challengeInFlight;

  runBtn.disabled = busy || isEditorDisabled();
  clearBtn.disabled = busy || isEditorDisabled();

  if (hintBtn) hintBtn.disabled = busy || isEditorDisabled() || hintBtn.textContent.includes("(0)");

  if (role === "host") {
    if (loadChallengeBtn) loadChallengeBtn.disabled = busy || !hostKey;
    if (solveBtn) solveBtn.disabled = busy || !hostKey;
    if (challengeSource) challengeSource.disabled = busy || !hostKey;
    if (challengeLevel) challengeLevel.disabled = busy || !hostKey;
  }
}

function guessLanguageFromFileName(name) {
  const lower = (name || "").toLowerCase();
  if (lower.endsWith(".py")) return "python";
  if (lower.endsWith(".js") || lower.endsWith(".jsx")) return "javascript";
  if (lower.endsWith(".ts") || lower.endsWith(".tsx")) return "javascript";
  if (lower.endsWith(".java")) return "java";
  if (lower.endsWith(".cs")) return "csharp";
  if (lower.endsWith(".sql")) return "sql";
  return null;
}

function renderCandidateDisplay(first, last) {
  const name = [first, last].filter(Boolean).join(" ").trim();
  candidateDisplay.textContent = name ? `Candidate: ${name}` : "";
}

function showNameModal() {
  if (!nameModal) return;
  nameModal.classList.add("show");
  nameModal.setAttribute("aria-hidden", "false");
}

function hideNameModal() {
  if (!nameModal) return;
  nameModal.classList.remove("show");
  nameModal.setAttribute("aria-hidden", "true");
  candNameHint.textContent = "";
}

function getCandidateMetaFromInputs() {
  return {
    first: (candFirst?.value || "").trim(),
    last: (candLast?.value || "").trim()
  };
}

function validateCandidateName(meta) {
  if (!meta.first && !meta.last) return "Please enter at least a first or last name.";
  if ((meta.first + meta.last).length > 80) return "Name is too long.";
  return null;
}

function setRecordingUI(active) {
  if (!recordingStatusEl) return;

  if (active) {
    recordingStatusEl.textContent = "Recording: ON";
    recordingStatusEl.classList.add("on");
    if (startRecBtn) startRecBtn.disabled = true;
    if (stopRecBtn) stopRecBtn.disabled = false;
  } else {
    recordingStatusEl.textContent = "Recording: OFF";
    recordingStatusEl.classList.remove("on");
    if (startRecBtn) startRecBtn.disabled = false;
    if (stopRecBtn) stopRecBtn.disabled = true;
  }
}

function normalizeLang(l) {
  const s = String(l || "").toLowerCase().trim();
  if (s === "js") return "javascript";
  if (s === "cs") return "csharp";
  return s;
}

/** Map app language -> monaco language id */
function toMonacoLang(appLang) {
  const l = normalizeLang(appLang);
  if (l === "python") return "python";
  if (l === "javascript") return "javascript";
  if (l === "sql") return "sql";
  if (l === "csharp") return "csharp";
  if (l === "java") return "java";
  return "plaintext";
}

function renderChallengeBox(payload) {
  if (!challengeBox) return;
  if (!payload) {
    challengeBox.textContent = "(no challenge loaded)";
    return;
  }

  const title = payload.title ? `${payload.title}` : "Challenge";
  const meta = `${String(payload.language || "").toUpperCase()} · L${payload.level || ""} · ${payload.source || ""}`.trim();
  const prompt = payload.prompt || "";

  challengeBox.textContent = `${title}\n${meta}\n\n${prompt}`.trim();
}

/** Editor abstraction (Monaco primary, textarea fallback) */
function isEditorDisabled() {
  if (useMonaco && monacoEditor) return monacoEditor.getOption(monaco.editor.EditorOption.readOnly);
  return !!fallbackTextarea?.disabled;
}

function setEditorDisabled(disabled) {
  if (useMonaco && monacoEditor) {
    monacoEditor.updateOptions({ readOnly: !!disabled });
    return;
  }
  if (fallbackTextarea) fallbackTextarea.disabled = !!disabled;
}

function getCode() {
  if (useMonaco && monacoModel) return monacoModel.getValue();
  return String(fallbackTextarea?.value || "");
}

function setCode(code, fromRemote = false) {
  const text = String(code ?? "");
  if (useMonaco && monacoModel) {
    suppressEmit = !!fromRemote;
    monacoModel.setValue(text);
    if (fromRemote) {
      // release suppression after microtask
      setTimeout(() => { suppressEmit = false; }, 0);
    }
    return;
  }
  if (fallbackTextarea) {
    fallbackTextarea.value = text;
    if (!fromRemote) emitCodeUpdate(text);
  }
}

function setEditorLanguage(appLang) {
  const l = normalizeLang(appLang);
  if (language) language.value = l;

  if (useMonaco && monacoModel && window.monaco) {
    monaco.editor.setModelLanguage(monacoModel, toMonacoLang(l));
  }
}

function emitCodeUpdate(text) {
  socket.emit("codeUpdate", text);
}

/** Debounced emit for Monaco typing */
function onMonacoChange() {
  if (suppressEmit) return;
  if (emitTimer) clearTimeout(emitTimer);
  emitTimer = setTimeout(() => {
    emitCodeUpdate(getCode());
  }, 80);
}

/** Monaco init */
function initMonaco() {
  // loader.js defines AMD `require`
  if (!window.require || !monacoHostEl) {
    useMonaco = false;
    if (fallbackTextarea) fallbackTextarea.style.display = "block";
    if (monacoHostEl) monacoHostEl.style.display = "none";
    console.log("[MONACO] loader not available; using textarea fallback.");
    return;
  }

  try {
    window.require.config({ paths: { vs: "/monaco/vs" } });

    window.require(["vs/editor/editor.main"], () => {
      try {
        useMonaco = true;

        monacoModel = monaco.editor.createModel("", toMonacoLang(language?.value || "python"));
        monacoEditor = monaco.editor.create(monacoHostEl, {
          model: monacoModel,
          automaticLayout: true,
          fontFamily: "Consolas, Menlo, Monaco, 'Courier New', monospace",
          fontSize: 14,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          wordWrap: "on",
          smoothScrolling: true,
          renderLineHighlight: "line",
        });

        monacoModel.onDidChangeContent(onMonacoChange);

        // Hide fallback textarea if it exists
        if (fallbackTextarea) fallbackTextarea.style.display = "none";

        // If textarea had content (rare), carry over
        const existing = String(fallbackTextarea?.value || "");
        if (existing) setCode(existing, true);

        syncButtons();
      } catch (e) {
        console.log("[MONACO] init failed:", e);
        useMonaco = false;
        if (fallbackTextarea) fallbackTextarea.style.display = "block";
        if (monacoHostEl) monacoHostEl.style.display = "none";
      }
    });
  } catch (e) {
    console.log("[MONACO] require config failed:", e);
    useMonaco = false;
    if (fallbackTextarea) fallbackTextarea.style.display = "block";
    if (monacoHostEl) monacoHostEl.style.display = "none";
  }
}

function showSolveModal(url) {
  if (!solveModal || !solveFrame) return;
  solveFrame.src = url;
  solveModal.classList.add("show");
  solveModal.setAttribute("aria-hidden", "false");
}

function hideSolveModal() {
  if (!solveModal || !solveFrame) return;
  solveModal.classList.remove("show");
  solveModal.setAttribute("aria-hidden", "true");
  solveFrame.src = "about:blank";
}

if (closeSolveBtn) closeSolveBtn.addEventListener("click", hideSolveModal);
if (solveModal) {
  solveModal.addEventListener("click", (e) => {
    // click outside card closes
    if (e.target === solveModal) hideSolveModal();
  });
}
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && solveModal?.classList.contains("show")) hideSolveModal();
});

(function initSessionFromUrl() {
  const url = new URL(window.location.href);
  const pathParts = url.pathname.split("/").filter(Boolean);

  if (pathParts[0] === "session" && pathParts[1]) sessionId = pathParts[1];

  const urlRole = url.searchParams.get("role");
  role = (urlRole === "candidate") ? "candidate" : "host";

  if (!sessionId) {
    sessionId = crypto.randomUUID().split("-")[0];
    role = "host";
    window.history.replaceState({}, "", `${window.location.origin}/session/${sessionId}?role=host`);
  }

  roleBadge.textContent = role === "candidate" ? "Candidate" : "Interviewer";

  if (hintBtn) {
    hintBtn.style.display = (role === "candidate") ? "inline-block" : "none";
    hintBtn.textContent = "Hint (3)";
    hintBtn.disabled = false;
  }

  const candidateLink = `${window.location.origin}/session/${sessionId}?role=candidate`;
  if (sessionLinkInput) sessionLinkInput.value = candidateLink;

  if (role !== "host") {
    if (recordingStatusEl) recordingStatusEl.style.display = "none";
    if (startRecBtn) startRecBtn.style.display = "none";
    if (stopRecBtn) stopRecBtn.style.display = "none";
    if (downloadRecordLink) downloadRecordLink.style.display = "none";
    if (replayThisLink) replayThisLink.style.display = "none";
    if (openRecordingsLink) openRecordingsLink.style.display = "none";

    if (endSessionBtn) endSessionBtn.style.display = "none";
    if (newSessionBtn) newSessionBtn.style.display = "none";
    if (loadScriptBtn) loadScriptBtn.style.display = "none";
    if (sessionLinkBlock) sessionLinkBlock.style.display = "none";

    if (challengeSource) challengeSource.style.display = "none";
    if (challengeLevel) challengeLevel.style.display = "none";
    if (loadChallengeBtn) loadChallengeBtn.style.display = "none";
    if (solveBtn) solveBtn.style.display = "none";
  } else {
    if (downloadRecordLink) downloadRecordLink.href = `${window.location.origin}/session/${sessionId}/record`;
    if (replayThisLink) replayThisLink.href = `${window.location.origin}/replay/${sessionId}`;
    setRecordingUI(false);
  }
})();

function joinSessionNow() {
  if (joinedOnce) return;
  joinedOnce = true;
  socket.emit("joinSession", { sessionId, role, candidateMeta: localCandidateMeta });
}

if (role === "candidate") {
  showNameModal();

  candJoin.addEventListener("click", () => {
    const meta = getCandidateMetaFromInputs();
    const err = validateCandidateName(meta);
    if (err) {
      candNameHint.textContent = err;
      return;
    }
    localCandidateMeta = meta;
    hideNameModal();
    renderCandidateDisplay(meta.first, meta.last);
    joinSessionNow();
  });

  [candFirst, candLast].forEach(el => {
    if (!el) return;
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter") candJoin.click();
    });
  });
} else {
  joinSessionNow();
}

socket.on("sessionJoined", (data) => {
  expiresAt = data.expiresAt;
  updateSessionStatus();
  setInterval(updateSessionStatus, 30000);

  if (data.candidateMeta) renderCandidateDisplay(data.candidateMeta.first, data.candidateMeta.last);

  if (role === "host") {
    hostKey = data.hostKey || null;

    if (typeof data.recordingActive === "boolean") {
      setRecordingUI(data.recordingActive);
      if (data.recordExists) {
        downloadRecordLink.style.display = "inline-block";
        replayThisLink.style.display = "inline-block";
      }
    }

    if (data.currentChallenge) renderChallengeBox(data.currentChallenge);
  }

  syncButtons();
});

socket.on("recordingStatus", ({ active, recordExists }) => {
  if (role !== "host") return;
  setRecordingUI(!!active);
  if (recordExists) {
    downloadRecordLink.style.display = "inline-block";
    replayThisLink.style.display = "inline-block";
  }
});

socket.on("candidateMetaUpdate", ({ first, last }) => renderCandidateDisplay(first, last));

socket.on("challengeUpdate", (payload) => {
  renderChallengeBox(payload);
});

socket.on("sessionEnded", ({ reason }) => {
  disableEditor(reason === "expired" ? "Session expired." : "Session ended by host.");
});

function updateSessionStatus() {
  if (!sessionStatus || !expiresAt) return;
  const remainingMs = expiresAt - Date.now();

  if (remainingMs <= 0) {
    sessionStatus.textContent = "Session expired.";
    disableEditor("Session expired.");
    return;
  }

  const mins = Math.floor(remainingMs / 60000);
  const secs = Math.floor((remainingMs % 60000) / 1000);
  sessionStatus.textContent = `Session active · ${mins}:${secs.toString().padStart(2, "0")} remaining`;
}

function disableEditor(msg) {
  setEditorDisabled(true);
  language.disabled = true;
  runBtn.disabled = true;
  clearBtn.disabled = true;
  if (hintBtn) hintBtn.disabled = true;
  if (startRecBtn) startRecBtn.disabled = true;
  if (stopRecBtn) stopRecBtn.disabled = true;

  if (loadChallengeBtn) loadChallengeBtn.disabled = true;
  if (solveBtn) solveBtn.disabled = true;

  setProcessing(false);
  output.textContent = msg || "Session no longer active.";
}

/** Local -> socket for textarea fallback */
if (fallbackTextarea) {
  fallbackTextarea.addEventListener("input", () => {
    if (useMonaco) return;
    socket.emit("codeUpdate", fallbackTextarea.value);
  });
}

socket.on("codeUpdate", (code) => {
  setCode(code, true);
});

language.addEventListener("change", () => socket.emit("languageUpdate", language.value));
socket.on("languageUpdate", (lang) => {
  setEditorLanguage(lang);
});

/** Run */
runBtn.addEventListener("click", async () => {
  if (runInFlight) return;
  runInFlight = true;
  setProcessing(true, "Running…");
  syncButtons();

  try {
    const response = await fetch("/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, code: getCode(), language: language.value })
    });

    const data = await response.json();
    const text = data.output ?? "";
    output.textContent = text;
  } catch (e) {
    output.textContent = "Run failed: " + (e?.message || e);
  } finally {
    runInFlight = false;
    setProcessing(false);
    syncButtons();
  }
});

socket.on("outputUpdate", (text) => {
  output.textContent = text ?? "";
});

/** Clear */
clearBtn.addEventListener("click", () => {
  setCode("", false);
  output.textContent = "";
  socket.emit("codeUpdate", "");
  socket.emit("outputUpdate", "");
});

/** Candidate hint */
if (hintBtn) {
  hintBtn.addEventListener("click", () => {
    if (hintInFlight) return;
    hintInFlight = true;
    setProcessing(true, "Generating hint…");
    syncButtons();
    socket.emit("requestHint");
  });
}

socket.on("hintResponse", ({ hint, hintsLeft }) => {
  const prefix = (typeof hintsLeft === "number")
    ? `[HINT] (${hintsLeft} left)\n`
    : `[HINT]\n`;

  const merged = (output.textContent || "") + "\n\n" + prefix + (hint || "");
  output.textContent = merged;

  if (role === "candidate" && hintBtn && typeof hintsLeft === "number") {
    hintBtn.textContent = `Hint (${hintsLeft})`;
    hintBtn.disabled = hintsLeft <= 0;
  }

  hintInFlight = false;
  setProcessing(false);
  syncButtons();
});

/** Host: Load Script */
if (loadScriptBtn && fileInput) {
  loadScriptBtn.addEventListener("click", () => fileInput.click());

  fileInput.addEventListener("change", () => {
    const f = fileInput.files && fileInput.files[0];
    if (!f) return;

    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || "");
      setCode(text, false);

      const guessed = guessLanguageFromFileName(f.name);
      if (guessed) {
        language.value = guessed;
        socket.emit("languageUpdate", guessed);
      }
    };
    reader.readAsText(f);
    fileInput.value = "";
  });
}

/** Host: recording controls */
if (role === "host") {
  startRecBtn.addEventListener("click", () => socket.emit("startRecording"));
  stopRecBtn.addEventListener("click", () => socket.emit("stopRecording"));
}

/** End session (host) */
if (endSessionBtn) {
  endSessionBtn.addEventListener("click", () => {
    if (confirm("End this interview session for all participants?")) socket.emit("endSession");
  });
}

/** New Session (host) */
if (newSessionBtn) {
  newSessionBtn.addEventListener("click", () => {
    if (!confirm("Start a new interview session? This will end the current session for the candidate.")) return;
    socket.emit("endSession");
    window.location.href = `${window.location.origin}/`;
  });
}

/** Host: Load Challenge */
async function loadChallenge() {
  if (role !== "host") return;
  if (!hostKey) {
    output.textContent = "[CHALLENGE ERROR]\nMissing hostKey. Refresh the host page.";
    return;
  }

  challengeInFlight = true;
  setProcessing(true, "Loading challenge…");
  syncButtons();

  const lang = normalizeLang(language.value);
  const level = Number(challengeLevel?.value || 1);
  const source = String(challengeSource?.value || "library");

  try {
    let challenge = null;

    if (source === "library") {
      const url = `/api/challenge/random?sessionId=${encodeURIComponent(sessionId)}&lang=${encodeURIComponent(lang)}&level=${encodeURIComponent(level)}&k=${encodeURIComponent(hostKey)}&ts=${Date.now()}`;
      const r = await fetch(url, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(JSON.stringify(j, null, 2));
      challenge = j.challenge;
    } else {
      const url = `/api/challenge/ai?k=${encodeURIComponent(hostKey)}&ts=${Date.now()}`;
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ sessionId, lang, level })
      });
      const j = await r.json();
      if (!r.ok) throw new Error(JSON.stringify(j, null, 2));
      challenge = j.challenge;
    }

    if (!challenge) throw new Error("No challenge returned");

    const chLang = normalizeLang(challenge.language || lang);
    language.value = chLang;
    socket.emit("languageUpdate", chLang);

    setCode(String(challenge.starterCode || ""), false);

    output.textContent = "";

    socket.emit("challengeUpdate", {
      id: challenge.id,
      source,
      title: challenge.title || "",
      prompt: challenge.prompt || "",
      language: chLang,
      level: challenge.level || level
    });
  } catch (e) {
    output.textContent = "[CHALLENGE ERROR]\n" + (e?.message || e);
  } finally {
    challengeInFlight = false;
    setProcessing(false);
    syncButtons();
  }
}

if (loadChallengeBtn) {
  loadChallengeBtn.addEventListener("click", loadChallenge);
}

/** ✅ Host: Solve (NO popup blockers; opens modal iframe with your existing black solve.html) */
if (solveBtn) {
  solveBtn.addEventListener("click", () => {
    if (role !== "host") return;
    if (!hostKey) {
      output.textContent = "[SOLVE ERROR]\nMissing hostKey. Refresh the host page.";
      return;
    }
    const url = `${window.location.origin}/solve/${encodeURIComponent(sessionId)}?k=${encodeURIComponent(hostKey)}&ts=${Date.now()}`;
    showSolveModal(url);
  });
}

renderChallengeBox(null);
syncButtons();
initMonaco();
