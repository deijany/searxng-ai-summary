(() => {
  "use strict";
  const urls = document.getElementById("urls");
  const qInput = document.getElementById("q");
  if (!urls || !qInput || !qInput.value.trim()) return;

  const query = qInput.value.trim();
  const store = {
    get(s, k) { try { return window[s].getItem(k); } catch { return null; } },
    set(s, k, v) { try { window[s].setItem(k, v); } catch {} },
  };

  const results = [...urls.querySelectorAll("article.result")].slice(0, 10).map((el) => {
    const a = el.querySelector("h3 a") || el.querySelector("a.url_header");
    const c = el.querySelector(".content");
    return {
      title: (a?.textContent || "").trim(),
      url: a?.href || "",
      content: (c?.textContent || "").trim(),
    };
  }).filter((r) => r.url);
  if (!results.length) return;

  const esc = (s) => s.replace(/[&<>"']/g, (ch) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));

  function render(md) {
    const cite = (s) => s.replace(/\[(\d+(?:\s*,\s*\d+)*)\]/g, (_, nums) =>
      nums.split(/\s*,\s*/).map((n) => {
        const r = results[+n - 1];
        return r ? `<a class="ai-sum-cite" href="${esc(r.url)}" title="${esc(r.title)}">${n}</a>` : `[${n}]`;
      }).join(""));
    const inline = (s) => cite(esc(s)
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/`([^`]+)`/g, "<code>$1</code>"));
    return md.trim().split(/\n{2,}/).map((block) => {
      const lines = block.split("\n");
      if (lines.every((l) => /^\s*([-*•]|\d+\.)\s+/.test(l))) {
        return "<ul>" + lines.map((l) => `<li>${inline(l.replace(/^\s*([-*•]|\d+\.)\s+/, ""))}</li>`).join("") + "</ul>";
      }
      return `<p>${lines.map((l) => inline(l.replace(/^#+\s*/, ""))).join("<br>")}</p>`;
    }).join("");
  }

  const box = document.createElement("section");
  box.className = "ai-sum";
  box.innerHTML = `
    <div class="ai-sum-head">
      <span class="ai-sum-title">AI summary</span>
      <select class="ai-sum-provider" aria-label="Model"></select>
      <button type="button" class="ai-sum-btn">Summarize</button>
    </div>
    <div class="ai-sum-body" aria-live="polite"></div>`;
  urls.prepend(box);
  const sel = box.querySelector(".ai-sum-provider");
  const btn = box.querySelector(".ai-sum-btn");
  const body = box.querySelector(".ai-sum-body");
  let ctrl = null;

  async function run(force) {
    const provider = sel.value;
    const cacheKey = `ai-sum:${provider}:${query}`;
    const cached = !force && store.get("sessionStorage", cacheKey);
    if (cached) { body.innerHTML = render(cached); btn.textContent = "Regenerate"; return; }

    ctrl?.abort();
    ctrl = new AbortController();
    box.classList.add("ai-sum-loading");
    body.innerHTML = '<p class="ai-sum-muted">Thinking…</p>';
    btn.textContent = "Regenerate";
    let text = "";
    try {
      const res = await fetch("/_ai/summarize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, provider, results }),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let queued = false;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        text += dec.decode(value, { stream: true });
        if (!queued) {
          queued = true;
          requestAnimationFrame(() => { body.innerHTML = render(text); queued = false; });
        }
      }
      body.innerHTML = render(text) || '<p class="ai-sum-muted">No summary returned.</p>';
      if (text.trim()) store.set("sessionStorage", cacheKey, text);
    } catch (e) {
      if (e.name !== "AbortError") body.innerHTML = `<p class="ai-sum-error">${esc(e.message)}</p>`;
    } finally {
      box.classList.remove("ai-sum-loading");
    }
  }

  fetch("/_ai/config").then((r) => r.json()).then((cfg) => {
    if (!cfg.providers.length) { box.remove(); return; }
    for (const p of cfg.providers) sel.add(new Option(p.label, p.id));
    const saved = store.get("localStorage", "ai-sum-provider");
    sel.value = cfg.providers.some((p) => p.id === saved) ? saved : cfg.default;
    if (cfg.providers.length < 2) sel.hidden = true;
    sel.addEventListener("change", () => { store.set("localStorage", "ai-sum-provider", sel.value); run(false); });
    btn.addEventListener("click", () => run(true));
    if (cfg.auto) run(false);
    else body.innerHTML = '<p class="ai-sum-muted">Click Summarize to generate.</p>';
  }).catch(() => box.remove());
})();
