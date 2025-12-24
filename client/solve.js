// client/solve.js
(function () {
  const titleEl = document.getElementById("solv-title");
  const metaEl = document.getElementById("solv-meta");
  const codeEl = document.getElementById("solv-code");

  const backBtn = document.getElementById("back");
  const copyBtn = document.getElementById("copy");
  const openNewBtn = document.getElementById("open-new");

  const url = new URL(window.location.href);
  const k = url.searchParams.get("k") || "";

  const parts = url.pathname.split("/").filter(Boolean);
  const sessionId = parts[1] || "";

  backBtn.addEventListener("click", () => {
    window.location.href = `/session/${encodeURIComponent(sessionId)}?role=host`;
  });

  openNewBtn.addEventListener("click", () => {
    window.open(window.location.href, "_blank", "noopener,noreferrer");
  });

  copyBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(codeEl.textContent || "");
      copyBtn.textContent = "Copied!";
      setTimeout(() => (copyBtn.textContent = "Copy code"), 1100);
    } catch {
      copyBtn.textContent = "Copy failed";
      setTimeout(() => (copyBtn.textContent = "Copy code"), 1100);
    }
  });

  async function load() {
    if (!sessionId) {
      titleEl.textContent = "Solve failed";
      codeEl.textContent = "Missing sessionId in URL.";
      return;
    }
    if (!k) {
      titleEl.textContent = "Solve failed";
      codeEl.textContent = "Missing host key (?k=...).";
      return;
    }

    titleEl.textContent = "Loading…";
    metaEl.textContent = `Session: ${sessionId}`;

    try {
      const resp = await fetch(`/api/challenge/solve?sessionId=${encodeURIComponent(sessionId)}&k=${encodeURIComponent(k)}`);
      const json = await resp.json();

      if (!resp.ok) {
        titleEl.textContent = "Solve failed";
        codeEl.textContent = JSON.stringify(json, null, 2);
        return;
      }

      const title = json.title || "Solution";
      const lvl = json.level ? `L${json.level}` : "";
      const lang = json.language || "";

      titleEl.textContent = title;
      metaEl.textContent = [`Session: ${sessionId}`, lang && `Lang: ${lang}`, lvl && `Level: ${lvl}`]
        .filter(Boolean)
        .join(" · ");

      codeEl.textContent = String(json.solutionCode || "(no solution returned)");
    } catch (e) {
      titleEl.textContent = "Solve failed";
      codeEl.textContent = String(e?.message || e);
    }
  }

  load();
})();
