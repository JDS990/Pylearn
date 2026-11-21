/* ai_tutor.js - optional Anthropic AI tutor for the phone coding page and
   More settings. The key lives in localStorage key "pylearn.ai.v1" only.
   It is never synced, never exported, and never written into progress.
   Direct browser calls use the official CORS header
   anthropic-dangerous-direct-browser-access (see
   https://platform.claude.com/docs/en/cli-sdks-libraries/sdks/typescript).
   Tradeoff: a key stored on the device can be read by anything that can
   already run JavaScript as this origin. */
(function () {
  "use strict";
  const MODELS = [
    { id: "claude-haiku-5-5", name: "Claude Haiku 5.5", blurb: "Fast and inexpensive. A good default for short tutoring nudges." },
    { id: "claude-sonnet-5-5", name: "Claude Sonnet 5.5", blurb: "Stronger coaching, still reasonably priced. Slower and costs more." }
  ];
  const PRICES = { "claude-haiku-5-5": [0.10, 0.50], "claude-sonnet-5-5": [2.00, 10.00] };
  const DEFAULT_MODEL = "claude-haiku-5-5";
  const KEYS_URL = "https://console.anthropic.com/settings/keys";
  const API_URL = "https://api.anthropic.com/v1/messages";
  const VERSION = "2026-10-21";
  const MAX_TOKENS = 1024, PROBE_MAX_TOKENS = 256, MAX_QUESTION = 600, MAX_CODE = 4000, MAX_TEXT = 2500, MAX_RUN = 1500;
  const MAX_HISTORY = 8, MAX_CONTEXT = 12000, DEFAULT_CAP = 40;
  const CFG_KEY = "pylearn.ai.v1", CHAT_KEY = "pylearn.ai.chats.v1";
  const SYSTEM_PROMPT = "You are PyLearn's optional AI tutor, coaching a total beginner who often rushes.\n\nHow you teach:\n- Stay Socratic. Ask a focused question or give a short nudge. Never hand out a full solution, a completed program, or a drop-in replacement for the learner's code.\n- If they ask for the answer, the solution, or \"just tell me what to type\", coach them instead: point at the relevant task line and ask a smaller question.\n- Keep answers short (a few sentences). One idea at a time.\n- Use the course phrasing the learner already knows:\n  - assignment: \"`x` gets value \u2026\"\n  - membership: \"is x found inside y?\"\n  - loops: \"for each x taken from y\"\n  - equality: \"is a equal to b?\"\n  - `%`: \"the remainder when a is packed into groups of b\"\n- Always end with a read-carefully reminder that points back to the exact task line involved (quote a short phrase from the task).\n- You may show a tiny snippet only to illustrate a concept, and only with different variable names than the task (never the learner's identifiers, and never the answer to this exercise).\n- You can see the built-in tutor's findings; you may build on them, but do not paste a finished fix.\n- Do not reveal hidden tests or any official solution. If those appear to be missing from your context, that is intentional.\n- No XP, grades, or progress changes. Just teaching.\n";
  function today() { return new Date().toISOString().slice(0, 10); }
  function loadCfg() {
    let c = {};
    try { c = JSON.parse(localStorage.getItem(CFG_KEY) || "null") || {}; } catch (e) { c = {}; }
    const model = MODELS.some(m => m.id === c.model) ? c.model : DEFAULT_MODEL;
    let cap = parseInt(c.daily_cap, 10); if (!Number.isFinite(cap)) cap = DEFAULT_CAP;
    cap = Math.max(0, Math.min(500, cap));
    let usage = c.usage && typeof c.usage === "object" ? c.usage : {};
    if (usage.day !== today()) usage = { day: today(), requests: 0, input_tokens: 0, output_tokens: 0 };
    return { key: c.key || "", model, daily_cap: cap, usage };
  }
  function saveCfg(cfg) {
    const out = { model: cfg.model, daily_cap: cfg.daily_cap, usage: cfg.usage };
    if (cfg.key) out.key = cfg.key;
    try { localStorage.setItem(CFG_KEY, JSON.stringify(out)); } catch (e) {}
  }
  function loadChats() {
    try { return JSON.parse(localStorage.getItem(CHAT_KEY) || "null") || {}; } catch (e) { return {}; }
  }
  function saveChats(all) {
    try { localStorage.setItem(CHAT_KEY, JSON.stringify(all)); } catch (e) {}
  }
  function usageOf(cfg) {
    const u = cfg.usage || {}, inp = +(u.input_tokens || 0), out = +(u.output_tokens || 0), reqs = +(u.requests || 0);
    const pr = PRICES[cfg.model] || PRICES[DEFAULT_MODEL];
    const usd = (inp / 1e6) * pr[0] + (out / 1e6) * pr[1];
    return { day: u.day, requests: reqs, input_tokens: inp, output_tokens: out, tokens: inp + out,
             usd_estimate: Math.round(usd * 10000) / 10000, cap: cfg.daily_cap,
             capped: !!(cfg.daily_cap && reqs >= cfg.daily_cap) };
  }
  function status() {
    const cfg = loadCfg();
    return { connected: !!cfg.key, model: cfg.model, models: MODELS, daily_cap: cfg.daily_cap,
             usage: usageOf(cfg), keys_url: KEYS_URL, default_model: DEFAULT_MODEL };
  }
  function usageLine(u) {
    if (!u) return "";
    const cap = u.cap ? ` · ${u.requests} of ${u.cap} requests today` : ` · ${u.requests || 0} requests today`;
    const usd = u.usd_estimate ? ` · about $${Number(u.usd_estimate).toFixed(u.usd_estimate < 0.01 ? 4 : 2)} (estimate)` : "";
    return `Today: ${(u.tokens || 0).toLocaleString()} tokens${cap}${usd}`;
  }
  function clip(s, n) { s = String(s || ""); return s.length <= n ? s : s.slice(0, n) + "\n… (cut)"; }
  function stripSecrets(text, solution, test) {
    if (typeof text !== "string") return text;
    let out = text;
    [solution, test].forEach(blob => {
      if (!blob || !String(blob).trim()) return;
      const raw = String(blob);
      [raw, raw.trim(), raw.trim() + "\n"].forEach(piece => {
        if (piece.trim().length >= 8 && out.indexOf(piece) >= 0) out = out.split(piece).join("[removed]");
      });
    });
    return out;
  }
  function buildContext(lesson, code, run, findings, summary, question) {
    lesson = lesson || {};
    const sol = (lesson.solution || "").trim(), tes = (lesson.test || "").trim();
    code = clip(code || "", MAX_CODE);
    if (sol && code.trim() === sol) code = "[the official solution text was removed from this request]";
    code = stripSecrets(code, sol, tes);
    const text = stripSecrets(clip(lesson.text || "", MAX_TEXT), sol, tes);
    const task = stripSecrets(clip(lesson.task || "", MAX_TEXT), sol, tes);
    run = run && typeof run === "object" ? run : {};
    const runBits = [];
    ["stdout", "stderr", "message", "explanation", "status"].forEach(k => {
      if (run[k]) runBits.push(k + ": " + stripSecrets(clip(String(run[k]), MAX_RUN), sol, tes));
    });
    const finds = (findings || []).slice(0, 8).map(f => {
      const q = (f.levels && f.levels[0] && f.levels[0].question) || f.question || "";
      return `- ${f.rule || "?"} (line ${f.line || "?"}): ${stripSecrets(q, sol, tes)}`;
    });
    let ctx = [
      `Lesson ${lesson.id || ""}: ${lesson.title || ""}`,
      "Lesson text:\n" + text,
      "Task:\n" + task,
      "The learner's current code:\n```python\n" + code + "\n```",
      "Last run or check:\n" + (runBits.join("\n") || "(none yet)"),
      "Built-in tutor findings:\n" + (finds.join("\n") || "(none)"),
      "Progress: " + stripSecrets(summary || "", sol, tes),
      "The learner's question:\n" + stripSecrets(clip(question, MAX_QUESTION), sol, tes)
    ].join("\n\n");
    if (ctx.length > MAX_CONTEXT) ctx = ctx.slice(0, MAX_CONTEXT) + "\n… (context cut to the size limit)";
    return stripSecrets(ctx, sol, tes);
  }
  function buildBody(lesson, code, run, findings, summary, history, question, model) {
    const sol = (lesson && lesson.solution) || "", tes = (lesson && lesson.test) || "";
    const msgs = [];
    (history || []).forEach(m => {
      if (!m || (m.role !== "user" && m.role !== "assistant") || !m.content) return;
      msgs.push({ role: m.role, content: stripSecrets(clip(m.content, 1500), sol, tes) });
    });
    if (msgs.length > MAX_HISTORY * 2) msgs.splice(0, msgs.length - MAX_HISTORY * 2);
    msgs.push({ role: "user", content: buildContext(lesson, code, run, findings, summary, question) });
    const body = { model: model || DEFAULT_MODEL, max_tokens: MAX_TOKENS, system: SYSTEM_PROMPT, messages: msgs, output_config: { effort: "low" } };
    const blob = JSON.stringify(body);
    if ((sol && sol.trim().length >= 8 && blob.indexOf(sol.trim()) >= 0) ||
        (tes && tes.trim().length >= 8 && blob.indexOf(tes.trim()) >= 0)) {
      body.messages = [{ role: "user", content: "Coach from the task only. Question: " + clip(question, 200) }];
    }
    return body;
  }
  function friendly(status, errType, message, offline) {
    const msg = message || "";
    if (offline) return { ok: false, fallback: true, error: "offline",
      message: "The AI tutor can't reach Anthropic right now (you may be offline). I'll use the built-in tutor instead." };
    if (status === 401 || errType === "authentication_error") {
      if (/^cors requests are not allowed/i.test(msg))
        return { ok: false, fallback: true, error: "cors",
          message: "This Anthropic organization doesn't allow API calls from a browser. Use the desktop app's AI tutor. I'll use the built-in tutor for now." };
      return { ok: false, fallback: true, error: "bad_key",
        message: "That Anthropic API key was refused (wrong, revoked or expired). Open AI tutor settings and paste a new key. I'll use the built-in tutor for now." };
    }
    if (status === 402 || errType === "billing_error" || /credit|billing/i.test(msg))
      return { ok: false, fallback: true, error: "billing",
        message: "Anthropic says there's a billing or credit problem on this key. Check the Claude Console. I'll use the built-in tutor for now." };
    if (status === 429 || errType === "rate_limit_error" || /rate limit|spend cap/i.test(msg))
      return { ok: false, fallback: true, error: "rate_limit",
        message: "Anthropic is rate-limiting this key, or a spend cap was reached. I'll use the built-in tutor for now." };
    if (status === 500 || status === 504 || status === 529 || errType === "api_error" || errType === "timeout_error" || errType === "overloaded_error")
      return { ok: false, fallback: true, error: "unavailable",
        message: "Anthropic is busy or timed out. I'll use the built-in tutor for now." };
    const typ = String(errType || "").toLowerCase().replace(/[^a-z0-9_.-]/g, "").slice(0, 80);
    let text = String(msg || "").replace(/\s+/g, " ").trim().replace(/sk-ant-[A-Za-z0-9_-]+/g, "[key]");
    if (text.length > 180) text = text.slice(0, 180);
    const detail = [typ, text].filter(Boolean).join("; ");
    return { ok: false, fallback: true, error: typ || "unavailable",
      message: "The AI tutor couldn't finish this request" + (detail ? " (" + detail + ")" : "") + ". I'll use the built-in tutor for now." };
  }
  async function callApi(key, body) {
    let res, raw;
    try {
      res = await fetch(API_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "anthropic-version": VERSION,
          "x-api-key": key,
          "anthropic-dangerous-direct-browser-access": "true"
        },
        body: JSON.stringify(body)
      });
      raw = await res.text();
    } catch (e) {
      return [null, friendly(0, "offline", "", true)];
    }
    let payload = {};
    try { payload = raw ? JSON.parse(raw) : {}; } catch (e) { return [null, friendly(res.status, "api_error", "bad json")]; }
    if (!res.ok || payload.type === "error") {
      const err = payload.error || {};
      return [null, friendly(res.status, err.type || "", err.message || "")];
    }
    return [payload, null];
  }
  function record(cfg, usage) {
    const u = cfg.usage;
    u.requests = +(u.requests || 0) + 1;
    u.input_tokens = +(u.input_tokens || 0) + +((usage || {}).input_tokens || 0);
    u.output_tokens = +(u.output_tokens || 0) + +((usage || {}).output_tokens || 0);
    cfg.usage = u;
    saveCfg(cfg);
    return usageOf(cfg);
  }
  function history(lid) { return (loadChats()[lid] || []); }
  function setHistory(lid, turns) {
    if (!lid) return;
    const all = loadChats();
    all[lid] = (turns || []).slice(-MAX_HISTORY * 2);
    saveChats(all);
  }
  async function connect(key, model, cap) {
    key = (key || "").trim();
    if (!key || key.indexOf("sk-ant-") !== 0)
      return { ok: false, message: "That doesn't look like an Anthropic API key. It should start with sk-ant-. Paste the key only into this settings box, never into chat." };
    const cfg = loadCfg();
    if (MODELS.some(m => m.id === model)) cfg.model = model;
    if (cap != null && Number.isFinite(+cap)) cfg.daily_cap = Math.max(0, Math.min(500, +cap));
    const body = { model: cfg.model, max_tokens: PROBE_MAX_TOKENS, messages: [{ role: "user", content: "Reply with the single word ok." }], output_config: { effort: "low" } };
    const [payload, err] = await callApi(key, body);
    if (err) return { ok: false, message: err.message, error: err.error };
    cfg.key = key;
    saveCfg(cfg);
    record(cfg, payload && payload.usage);
    return Object.assign({ ok: true, message: "Connected. The key is stored only on this device and will not be shown again." }, status());
  }
  function updateSettings(model, cap) {
    const cfg = loadCfg();
    if (MODELS.some(m => m.id === model)) cfg.model = model;
    if (cap != null && Number.isFinite(+cap)) cfg.daily_cap = Math.max(0, Math.min(500, +cap));
    saveCfg(cfg);
    return Object.assign({ ok: true }, status());
  }
  function disconnect() {
    const cfg = loadCfg();
    cfg.key = "";
    saveCfg(cfg);
    return Object.assign({ ok: true, message: "Disconnected. The key has been removed from this device." }, status());
  }
  async function testConnection() {
    const cfg = loadCfg();
    if (!cfg.key) return { ok: false, message: "No API key is saved yet." };
    const body = { model: cfg.model, max_tokens: PROBE_MAX_TOKENS, messages: [{ role: "user", content: "Reply with the single word ok." }], output_config: { effort: "low" } };
    const [payload, err] = await callApi(cfg.key, body);
    if (err) return Object.assign({ ok: false, message: err.message, error: err.error }, status());
    record(cfg, payload && payload.usage);
    return Object.assign({ ok: true, message: "The key works. Anthropic answered." }, status());
  }
  function textOf(payload) {
    return ((payload && payload.content) || []).filter(b => b && b.type === "text" && b.text).map(b => b.text).join("\n").trim();
  }
  async function ask({ lesson, code, question, run, findings, summary, historyTurns }) {
    const cfg = loadCfg();
    if (!cfg.key) return { ok: false, fallback: true, error: "disconnected",
      message: "The AI tutor isn't connected. Open AI tutor settings and paste your Anthropic API key (never paste it into chat). I'll use the built-in tutor." };
    const used = usageOf(cfg);
    if (used.capped) return { ok: false, fallback: true, error: "cap", usage: used,
      message: `You've reached today's AI tutor cap (${cfg.daily_cap} requests). The built-in tutor is still here, and the cap resets tomorrow.` };
    const q = (question || "").trim();
    if (!q) return { ok: false, fallback: false, error: "empty", message: "Type a question for the AI tutor first.", usage: used };
    const lid = (lesson && lesson.id) || "";
    const hist = historyTurns || history(lid);
    const body = buildBody(lesson, code, run, findings, summary, hist, q, cfg.model);
    const [payload, err] = await callApi(cfg.key, body);
    if (err) { err.usage = usageOf(cfg); return err; }
    const text = textOf(payload);
    if (!text) {
      const u = record(cfg, payload && payload.usage);
      if (payload && payload.stop_reason === "max_tokens")
        return { ok: false, fallback: true, error: "truncated", usage: u,
          message: "The AI tutor used up its reply budget before finishing a written answer (some of that budget can go to thinking). Try asking again. I'll use the built-in tutor for now." };
      return { ok: false, fallback: true, error: "unavailable", usage: u,
        message: "The AI tutor returned an empty reply. I'll use the built-in tutor for now." };
    }
    const u = record(cfg, payload.usage);
    const turns = hist.concat([{ role: "user", content: q }, { role: "assistant", content: text }]);
    setHistory(lid, turns);
    return { ok: true, fallback: false, text, usage: u, model: cfg.model, history: turns.slice(-MAX_HISTORY * 2) };
  }

  function stepsHtml() {
    return `<ol class="steps">
      <li>Open the <a href="${KEYS_URL}" target="_blank" rel="noopener">Anthropic API keys page</a> (Claude Console) and sign in.</li>
      <li>Click <b>Create key</b>, name it something like PyLearn tutor, choose an expiration, and create it.</li>
      <li>Copy the key (it starts with <code>sk-ant-</code>). The Console shows the full key only once.</li>
      <li>Paste it <b>only</b> in the box below. <b>Never paste the key into chat</b>, into a lesson, or into a message to anyone.</li>
      <li>The key is stored only on this device. It is never synced and never included in an export. <b>Security tradeoff:</b> anything that can run JavaScript as this site could read a key stored here. Use a key you can revoke, and Disconnect if you share this device.</li>
    </ol>`;
  }


  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
  function settingsHtml() {
    const st = status();
    const models = (st.models || []).map(m => `<option value="${esc(m.id)}" ${m.id === st.model ? "selected" : ""}>${esc(m.name)}</option>`).join("");
    const cap = st.daily_cap == null ? 40 : st.daily_cap;
    if (st.connected) {
      return `<div class="card" id="aiCard"><h3>🧑‍🏫 AI tutor is connected</h3>
        <p class="muted small">A key is saved on this device only. It is never synced or exported, and will not be shown again. The built-in tutor still works if Anthropic is unavailable.</p>
        <div class="muted small" id="aiUse">${esc(usageLine(st.usage))}</div>
        <label class="fieldl"><span>Model</span><select id="aiModel">${models}</select></label>
        <label class="fieldl"><span>Daily request cap (0 = no cap)</span><input id="aiCap" type="number" min="0" max="500" value="${esc(cap)}"></label>
        <div class="btns" style="margin-top:10px"><button class="btn primary" id="aiSave">Save settings</button><button class="btn" id="aiTest">Test</button><button class="btn" id="aiOff">Disconnect</button></div>
        <div id="aiOut"></div></div>`;
    }
    return `<div class="card" id="aiCard"><h3>🧑‍🏫 Optional AI tutor</h3>
      <p class="muted small">The built-in tutor works with no key. The AI tutor is a chat on top, using your own Anthropic account. Default model: Claude Haiku 5.5.</p>
      ${stepsHtml()}
      <label class="fieldl"><span>Anthropic API key</span><input id="aiKey" type="password" placeholder="sk-ant-…" spellcheck="false" autocomplete="off"></label>
      <label class="fieldl"><span>Model</span><select id="aiModel">${models || '<option value="claude-haiku-5-5">Claude Haiku 5.5</option>'}</select></label>
      <label class="fieldl"><span>Daily request cap (0 = no cap)</span><input id="aiCap" type="number" min="0" max="500" value="${esc(cap)}"></label>
      <div class="btns" style="margin-top:10px"><button class="btn primary" id="aiSave">Save &amp; connect</button></div>
      <div id="aiOut"></div></div>`;
  }
  function bindSettings(onDone) {
    const out = (ok, msg) => { const el = document.getElementById("aiOut"); if (el) el.innerHTML = `<div class="banner ${ok ? "pass" : "fail"}">${esc(msg)}</div>`; };
    const capVal = () => { const n = parseInt((document.getElementById("aiCap") || {}).value, 10); return Number.isFinite(n) ? n : 40; };
    const modelVal = () => (document.getElementById("aiModel") || {}).value;
    const save = document.getElementById("aiSave");
    const st = status();
    if (save) save.onclick = async () => {
      save.disabled = true;
      try {
        let r;
        if (st.connected) {
          r = updateSettings(modelVal(), capVal());
          if (onDone) onDone(r);
          else out(!!r.ok, r.message || (r.ok ? "Settings saved." : "Could not save."));
        } else {
          const keyEl = document.getElementById("aiKey");
          r = await connect(keyEl && keyEl.value, modelVal(), capVal());
          if (r.ok) {
            if (keyEl) keyEl.value = "";
            if (onDone) onDone(r);
            else out(true, r.message || "Connected.");
          } else {
            // Keep the key in the field and the error banner on this panel.
            // Re-rendering here would wipe both, which looked like a flash.
            out(false, r.message || "Could not connect.");
          }
        }
      } catch (e) { out(false, "Could not reach Anthropic."); }
      finally { const b = document.getElementById("aiSave"); if (b) b.disabled = false; }
    };
    const test = document.getElementById("aiTest");
    if (test) test.onclick = async () => {
      const r = await testConnection();
      out(!!r.ok, r.message || "");
    };
    const off = document.getElementById("aiOff");
    if (off) off.onclick = () => {
      if (!confirm("Remove the Anthropic API key from this device?")) return;
      const r = disconnect();
      if (onDone) onDone(r);
    };
  }

  window.PyAI = {
    MODELS, DEFAULT_MODEL, KEYS_URL, CFG_KEY, CHAT_KEY, SYSTEM_PROMPT,
    status, usageLine, loadCfg, connect, updateSettings, disconnect, testConnection,
    ask, history, setHistory, buildBody, buildContext, stripSecrets, stepsHtml, settingsHtml, bindSettings
  };
})();
