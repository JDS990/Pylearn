/* tutor.js - Socratic tutor panel for the desktop lesson page (inlined by
   pylearn.py) and the phone coding page (copied by web/build.py).
   Talks to a host-provided request({action, code, ...}) that runs app/tutor.py.
   Gives no XP and does not change progress. */
(function () {
  "use strict";
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

  let cssDone = false, host = null, state = { finding: 0, level: 0, last: null, check: null, ai: { msgs: [], usage: null, connected: false, loaded: false } };

  function injectCSS() {
    if (cssDone || typeof document === "undefined") return; cssDone = true;
    const st = document.createElement("style");
    st.textContent = `
.tutor{border:1px solid #3a4a63;background:linear-gradient(135deg,#152033,#161c24);border-radius:10px;padding:14px 16px;margin:10px 0 0}
.tutor h3{margin:0 0 6px;font-size:15px;letter-spacing:.4px;color:#cfe3ff}
.tutor .tq{font-size:15px;line-height:1.55;margin:8px 0}
.tutor .tnote{font-family:var(--mono,monospace);font-size:13px;white-space:pre-wrap;background:#0b0f14;border:1px solid #2a3441;border-radius:8px;padding:10px 12px;margin:8px 0;line-height:1.45}
.tutor .tline{margin:8px 0}
.tutor .tread{color:#ffd970;font-size:14px;margin:8px 0 0}
.tutor .tmeta{color:#8b98a8;font-size:12.5px;margin-left:auto}
.tutor .thead{display:flex;align-items:center;gap:8px}
.tutor .fix{color:#aff5b4;margin-top:6px}
.gutter .gln{cursor:pointer;border-radius:3px}
.gutter .gln:hover,.gutter .gln.on{background:#2a3a55;color:#cfe3ff}
.gutter .gln.hit{background:#2a2210;color:#ffd970}
.tutor-trace{width:100%;border-collapse:collapse;margin:8px 0;font-size:13px}
.tutor-trace th,.tutor-trace td{border:1px solid #2a3441;padding:4px 8px;text-align:left;vertical-align:top}
.tutor-trace th{color:#8b98a8;background:#1c2430}
.tutor-trace code{font-size:12.5px}
.tutor-trace .ch{color:#aff5b4}
#askTutor{margin-top:8px}
.exq{flex:0 0 auto;border:0;background:transparent;color:#8b98a8;cursor:pointer;font-size:13px;padding:0 4px;line-height:1.4}
.exq:hover{color:#ffd970}
.exrow{display:flex;align-items:flex-start;gap:2px}
#explainBox,.explain-box{margin-top:10px;padding:10px 12px;border:1px solid #3a4a63;border-radius:8px;background:#152033;font-size:14px;line-height:1.5}
#explainBox code,.explain-box code{font-size:13px}
#aiChat{margin-top:14px;padding-top:12px;border-top:1px solid #2a3441}
#aiChat textarea{width:100%;box-sizing:border-box;background:#0b0f14;color:#dce6f0;border:1px solid #2a3441;border-radius:8px;padding:8px 10px;font:inherit;margin:8px 0;min-height:56px}
.aimsg{margin:8px 0;padding:8px 10px;border-radius:8px;line-height:1.5;font-size:14.5px}
.aimsg.user{background:#1c2430}
.aimsg.assistant{background:#152033;border:1px solid #3a4a63}
.aimsg .who{color:#8b98a8;font-size:12px;margin-bottom:2px}
.exp-pop{margin-top:8px}
`;
    document.head.appendChild(st);
  }

  function init(opts) { host = opts || {}; injectCSS(); state.ai = { msgs: [], usage: null, connected: false, loaded: false }; }

  function code() { return host.getCode ? host.getCode() : ""; }
  function box() { return document.getElementById("tutorBox"); }

  function markLine(n) {
    const g = document.getElementById("gutter");
    if (!g) return;
    g.querySelectorAll(".gln.hit").forEach(el => el.classList.remove("hit"));
    if (n) {
      const el = g.querySelector('.gln[data-n="' + n + '"]');
      if (el) { el.classList.add("hit"); el.scrollIntoView({ block: "nearest" }); }
    }
    if (host.highlightLine) host.highlightLine(n);
  }

  function renderNudge(a) {
    const el = box(); if (!el) return;
    state.last = a;
    el.classList.remove("hidden"); el.className = "tutor";
    const step = a.empty ? "" : ` <span class="tmeta">nudge ${a.finding_i + 1}.${a.level + 1}` +
      (a.finding_n ? ` of ${a.finding_n} slip${a.finding_n > 1 ? "s" : ""}` : "") + "</span>";
    let body = `<div class="thead"><h3>Tutor</h3>${step}</div><div class="tq">${host.inline ? host.inline(a.question) : esc(a.question)}</div>`;
    if (a.note) body += `<pre class="tnote">${esc(a.note)}</pre>`;
    if (a.show_line && a.line) {
      body += `<div class="tline">Line ${a.line}: <pre class="code">${host.highlight ? host.highlight(a.line_text || "") : esc(a.line_text || "")}</pre></div>`;
      if (a.fix_hint) body += `<div class="fix">${host.inline ? host.inline(a.fix_hint) : esc(a.fix_hint)}</div>`;
    }
    if (a.read) body += `<div class="tread">${host.inline ? host.inline("👀 " + a.read.replace(/^👀\s*/, "")) : esc(a.read)}</div>`;
    body += `<div class="btnrow" style="margin-top:10px">` +
      (a.more ? `<button class="b primary small" id="tutorNext">Next nudge</button>` : `<span class="tmeta">No further nudge on this code \u2014 try a change, then ask again.</span>`) +
      `<button class="b small" id="tutorAgain">Ask again</button>` +
      `<button class="b small" id="tutorExplain">Explain this line</button>` +
      `<button class="b small" id="tutorTrace">Trace it</button></div>` +
      `<div id="tutorExtra"></div>` + aiSection();
    el.innerHTML = body;
    if (a.line) markLine(a.line);
    if (a.task_ref && host.flashTask) host.flashTask(a.task_ref);
    const nx = el.querySelector("#tutorNext"); if (nx) nx.onclick = nextNudge;
    el.querySelector("#tutorAgain").onclick = () => ask({ reset: true });
    el.querySelector("#tutorExplain").onclick = () => explain();
    el.querySelector("#tutorTrace").onclick = () => doTrace();
    bindAI();
  }

  async function ask(opts) {
    opts = opts || {};
    if (!host.request) return;
    if (opts.reset) { state.finding = 0; state.level = 0; }
    if (opts.check) state.check = opts.check;
    const el = box(); if (el) { el.classList.remove("hidden"); el.className = "tutor"; el.innerHTML = "<div class='thead'><h3>Tutor</h3></div><div class='tq'>Looking at your code\u2026</div>"; }
    try {
      const a = await host.request({ action: "advise", code: code(), finding: state.finding, level: state.level, check: state.check || undefined });
      state.last = a;
      renderNudge(a);
      refreshAI();
    } catch (e) {
      if (el) el.innerHTML = "<div class='tq'>The tutor could not run. Is PyLearn still open?</div>";
    }
  }

  async function nextNudge() {
    const a = state.last;
    if (!a || !a.more) return ask({ reset: false });
    if (a.level + 1 < a.level_n) state.level = a.level + 1;
    else { state.finding = a.finding_i + 1; state.level = 0; }
    return ask();
  }

  function cursorLine() {
    if (host.getCursorLine) return host.getCursorLine();
    const ed = document.getElementById("editor");
    if (!ed) return 1;
    const up = (ed.value || "").slice(0, ed.selectionStart || 0);
    return up.split("\n").length;
  }

  async function explain(n) {
    const line = n || cursorLine();
    const extra = document.getElementById("tutorExtra") || box();
    try {
      const r = await host.request({ action: "explain", code: code(), line: line });
      const html = `<div class="exp-pop banner info"><b>Line ${r.line}:</b> ${host.inline ? host.inline(r.explain) : esc(r.explain)}</div>`;
      if (extra && extra.id === "tutorExtra") extra.innerHTML = html;
      else if (box()) {
        box().classList.remove("hidden"); box().className = "tutor";
        box().innerHTML = `<div class="thead"><h3>Tutor</h3></div>${html}
          <div class="btnrow"><button class="b small" id="tutorAgain">Ask the tutor</button>
          <button class="b small" id="tutorTrace">Trace it</button></div><div id="tutorExtra"></div>`;
        box().querySelector("#tutorAgain").onclick = () => ask({ reset: true });
        box().querySelector("#tutorTrace").onclick = () => doTrace();
      }
      markLine(r.line);
    } catch (e) {}
  }

  function renderTrace(t) {
    const extra = document.getElementById("tutorExtra") || box();
    if (!extra) return;
    if (!t.ok && !t.steps.length) {
      extra.innerHTML = `<div class="banner info">${esc(t.reason || "Cannot trace this program.")}</div>`;
      return;
    }
    let h = `<div class="exp-pop"><b>Trace</b> \u2014 each row is one line after it has run.`;
    if (t.reason) h += ` <span class="tmeta">${esc(t.reason)}</span>`;
    h += `</div><table class="tutor-trace"><tr><th>#</th><th>line</th><th>code</th><th>variables that changed</th></tr>`;
    for (const s of (t.steps || [])) {
      const ch = Object.entries(s.changed || {}).map(([k, v]) => {
        return `<span class="ch"><code>${esc(k)}</code> ${v.from == null ? "gets" : "goes from " + esc(String(v.from)) + " to"} <code>${esc(String(v.to))}</code></span>`;
      }).join("<br>") || "<span class='tmeta'>(no change)</span>";
      h += `<tr><td>${s.n}</td><td>${s.line}</td><td><code>${esc(s.text || "")}</code></td><td>${ch}</td></tr>`;
    }
    h += "</table>";
    extra.innerHTML = h;
  }

  async function doTrace() {
    if (!box()) return;
    box().classList.remove("hidden"); box().className = "tutor";
    if (!document.getElementById("tutorExtra")) {
      box().insertAdjacentHTML("beforeend", "<div id='tutorExtra'></div>");
    }
    const extra = document.getElementById("tutorExtra");
    if (extra) extra.innerHTML = "<div class='tmeta'>Tracing\u2026</div>";
    try { renderTrace(await host.request({ action: "trace", code: code() })); }
    catch (e) { if (extra) extra.innerHTML = "<div class='banner info'>Could not trace this program.</div>"; }
  }

  function bindGutter() {
    const g = document.getElementById("gutter");
    if (!g || g.dataset.tutorBound) return;
    g.dataset.tutorBound = "1";
    g.addEventListener("click", ev => {
      const t = ev.target.closest(".gln");
      if (!t) return;
      ev.preventDefault();
      const n = +t.dataset.n;
      const ed = document.getElementById("editor");
      if (ed && n) {
        const ls = ed.value.split("\n");
        let pos = 0; for (let i = 0; i < n - 1; i++) pos += ls[i].length + 1;
        ed.focus(); ed.setSelectionRange(pos, pos + (ls[n - 1] || "").length);
      }
      explain(n);
    });
  }



  function usageLine(u) {
    if (!u) return "";
    const cap = u.cap ? ` · ${u.requests} of ${u.cap} requests today` : ` · ${u.requests || 0} requests today`;
    const usd = u.usd_estimate ? ` · about $${Number(u.usd_estimate).toFixed(u.usd_estimate < 0.01 ? 4 : 2)} (estimate)` : "";
    return `Today: ${(u.tokens || 0).toLocaleString()} tokens${cap}${usd}`;
  }
  function aiSection() {
    let h = `<div id="aiChat"><div class="thead"><h3>Ask the AI tutor</h3></div>`;
    if (!state.ai.connected) {
      h += `<p class="tmeta">Optional. Connect your Anthropic API key in <b>AI tutor</b> settings. Never paste a key into this box. The built-in tutor above works with no key.</p></div>`;
      return h;
    }
    h += `<div id="aiMsgs">`;
    for (const m of (state.ai.msgs || [])) {
      const who = m.role === "user" ? "You" : "AI tutor";
      const body = host.inline ? host.inline(m.content) : esc(m.content);
      h += `<div class="aimsg ${m.role === "user" ? "user" : "assistant"}"><div class="who">${who}</div>${body}</div>`;
    }
    h += `</div><textarea id="aiQ" rows="2" placeholder="Ask a question about this lesson…"></textarea>
      <div class="btnrow"><button class="b small primary" id="aiAskBtn">Ask the AI tutor</button></div>
      <div class="tmeta" id="aiUse">${esc(usageLine(state.ai.usage))}</div>
      <div id="aiErr"></div></div>`;
    return h;
  }
  function bindAI() {
    const btn = document.getElementById("aiAskBtn");
    if (btn) btn.onclick = sendAI;
    const q = document.getElementById("aiQ");
    if (q) q.addEventListener("keydown", ev => {
      if (ev.key === "Enter" && (ev.metaKey || ev.ctrlKey)) { ev.preventDefault(); sendAI(); }
    });
  }
  async function refreshAI() {
    if (!host.aiStatus) return;
    try {
      const st = await host.aiStatus();
      state.ai.connected = !!(st && st.connected);
      state.ai.usage = st && st.usage;
      if (state.ai.connected && !state.ai.loaded && host.aiHistory) {
        const h = await host.aiHistory();
        state.ai.msgs = (h && h.history) || [];
        state.ai.loaded = true;
      }
    } catch (e) { state.ai.connected = false; }
    const chat = document.getElementById("aiChat");
    if (chat && box()) {
      chat.outerHTML = aiSection();
      bindAI();
    }
  }
  async function sendAI() {
    const qel = document.getElementById("aiQ");
    const q = ((qel && qel.value) || "").trim();
    if (!q || !host.aiAsk) return;
    state.ai.msgs = (state.ai.msgs || []).concat([{ role: "user", content: q }]);
    if (qel) qel.value = "";
    const err = document.getElementById("aiErr");
    if (err) err.innerHTML = "<div class='tmeta'>Thinking…</div>";
    const chat = document.getElementById("aiChat");
    if (chat) { chat.outerHTML = aiSection(); bindAI(); const e2 = document.getElementById("aiErr"); if (e2) e2.innerHTML = "<div class='tmeta'>Thinking…</div>"; }
    try {
      const r = await host.aiAsk({ question: q, code: code() });
      if (r && r.usage) state.ai.usage = r.usage;
      if (r && r.ok && r.text) {
        state.ai.msgs.push({ role: "assistant", content: r.text });
        if (r.history) state.ai.msgs = r.history;
        const c = document.getElementById("aiChat");
        if (c) { c.outerHTML = aiSection(); bindAI(); }
        return;
      }
      if (r && r.fallback && !state.last) {
        try { await ask({ reset: true }); } catch (e2) {}
      }
      const c = document.getElementById("aiChat");
      if (c) { c.outerHTML = aiSection(); bindAI(); }
      const e3 = document.getElementById("aiErr");
      if (e3) e3.innerHTML = `<div class="banner info">${esc((r && r.message) || "The built-in tutor is taking over.")}</div>`;
    } catch (e) {
      const c = document.getElementById("aiChat");
      if (c) { c.outerHTML = aiSection(); bindAI(); }
      const e3 = document.getElementById("aiErr");
      if (e3) e3.innerHTML = `<div class="banner info">The AI tutor couldn't run (you may be offline). I'll use the built-in tutor.</div>`;
      if (!state.last) { try { await ask({ reset: true }); } catch (e2) {} }
    }
  }

  function clip(s, n) { s = String(s || ""); return s.length <= n ? s : s.slice(0, n) + "…"; }

  function phraseExpr(s) {
    s = String(s || "").trim().replace(/:$/, "");
    if (!s) return "this";
    let m;
    if ((m = s.match(/^(.+?)\s*%\s+(.+)$/)))
      return "the remainder when " + phraseExpr(m[1]) + " is packed into groups of " + phraseExpr(m[2]);
    if ((m = s.match(/^(.+?)\s+in\s+(.+)$/)))
      return "is " + phraseExpr(m[1]) + " found inside " + phraseExpr(m[2]) + "?";
    if ((m = s.match(/^not\s+(.+)$/)))
      return "not (" + phraseExpr(m[1]) + ")";
    if ((m = s.match(/^(.+?)\s*==\s*(.+)$/)))
      return "is " + phraseExpr(m[1]) + " equal to " + phraseExpr(m[2]) + "?";
    if ((m = s.match(/^(.+?)\s*!=\s*(.+)$/)))
      return "is " + phraseExpr(m[1]) + " not equal to " + phraseExpr(m[2]) + "?";
    if ((m = s.match(/^len\((.+)\)$/)))
      return "the length of " + phraseExpr(m[1]);
    if ((m = s.match(/^range\((.+)\)$/)))
      return "`range(" + m[1] + ")` (0, 1, …, stopping before " + phraseExpr(m[1]) + ")";
    if ((m = s.match(/^print\((.*)\)$/)))
      return m[1].trim() ? "print " + phraseExpr(m[1]) : "print a blank line";
    if (/^f["']/.test(s) || s.startsWith('f"') || s.startsWith("f'"))
      return "a line of text with values filled in";
    if (/^[A-Za-z_]\w*$/.test(s)) return "`" + s + "`";
    if (/^[A-Za-z_]\w*(\.[A-Za-z_]\w*)+$/.test(s)) {
      const parts = s.split(".");
      return "`" + parts[0] + "`." + parts.slice(1).map(p => "`" + p + "`").join(".");
    }
    return "`" + clip(s, 50) + "`";
  }

  function phraseTest(s) {
    const p = phraseExpr(s);
    return /[?]$/.test(p) ? p : p;
  }

  /** Offline explain-this-line for drill pages (no Pyodide). Same phrasing as tutor.py. */
  function explainLocal(src, lineno) {
    const text = src || "";
    let raw, n;
    if (lineno == null && text.indexOf("\n") < 0) { raw = text; n = 1; }
    else {
      const ls = text.split("\n");
      n = lineno || 1;
      if (n < 1 || n > ls.length) return { line: n, text: "", explain: "There is no such line in the current code." };
      raw = ls[n - 1];
    }
    const s = String(raw).trim();
    if (!s) return { line: n, text: raw, explain: "This line is blank." };
    if (s.startsWith("#")) return { line: n, text: raw, explain: "This line is a comment. Python ignores it; it is a note for you." };
    let m;
    if ((m = s.match(/^elif\s+(.+):$/)))
      return { line: n, text: raw, explain: "Otherwise, if this is True, run the indented lines: " + phraseTest(m[1]) };
    if (/^else\s*:/.test(s))
      return { line: n, text: raw, explain: "If none of the checks above were True, run the indented lines." };
    if ((m = s.match(/^if\s+(.+):$/)))
      return { line: n, text: raw, explain: "If this is True, run the indented lines: " + phraseTest(m[1]) };
    if ((m = s.match(/^while\s+(.+):$/)))
      return { line: n, text: raw, explain: "While this is True, run the indented lines: " + phraseTest(m[1]) };
    if ((m = s.match(/^for\s+(.+?)\s+in\s+(.+):$/)))
      return { line: n, text: raw, explain: "For each " + phraseExpr(m[1]) + " taken from " + phraseExpr(m[2]) + ", run the indented lines." };
    if (/[^=!<>]=[^=]/.test(s) && /:$/.test(s) && /\b(if|elif|while)\b/.test(s))
      return { line: n, text: raw, explain: "This looks like a `=` (store) inside a condition. The test after `if`/`elif`/`while` has to be a question: use `==` to ask \"is … equal to …?\"." };
    if ((m = s.match(/^([A-Za-z_]\w*)\s*==\s*(.+)$/)))
      return { line: n, text: raw, explain: "Is `" + m[1] + "` equal to `" + m[2].replace(/:$/, "") + "`? This line asks a question and does not store a value. To store, you would use a single `=`." };
    if ((m = s.match(/^([A-Za-z_]\w*)\s*\+=\s*(.+)$/)))
      return { line: n, text: raw, explain: "Add " + phraseExpr(m[2]) + " to `" + m[1] + "` and store it back in `" + m[1] + "`." };
    if ((m = s.match(/^([A-Za-z_]\w*)\s*=\s*(.+)$/)))
      return { line: n, text: raw, explain: "`" + m[1] + "` gets value " + phraseExpr(m[2]) + "." };
    if ((m = s.match(/^print\s*\((.*)\)$/)))
      return { line: n, text: raw, explain: m[1].trim() ? "Print " + phraseExpr(m[1]) + "." : "Print a blank line." };
    if (s === "return")
      return { line: n, text: raw, explain: "Leave the function and hand back `None`." };
    if ((m = s.match(/^return\s+(.+)$/)))
      return { line: n, text: raw, explain: "Leave the function and hand back " + phraseExpr(m[1]) + "." };
    if (s === "break")
      return { line: n, text: raw, explain: "Leave the loop immediately (`break`)." };
    if (s === "continue")
      return { line: n, text: raw, explain: "Skip the rest of this round of the loop and go to the next item (`continue`)." };
    if (s === "..." || s === "…")
      return { line: n, text: raw, explain: "This `...` is a placeholder. Replace it with your line." };
    if (s === "pass")
      return { line: n, text: raw, explain: "`pass` does nothing. It is a placeholder for a block you have not written yet." };
    if (/%/.test(s) && /==/.test(s))
      return { line: n, text: raw, explain: "This asks whether the remainder is equal to something (often 0, meaning it divides evenly)." };
    if (s.includes("==") || /\bin\b/.test(s) || s.includes("%"))
      return { line: n, text: raw, explain: phraseTest(s).replace(/[.]?$/, ".") };
    return { line: n, text: raw, explain: "This line is `" + clip(s, 60) + "`. If it is not valid Python yet, finish the line (a missing colon `:` or a closing quote is a common cause) and ask again." };
  }

  window.PyTutor = { init, injectCSS, ask, explain, explainLocal, trace: doTrace, nextNudge, bindGutter, markLine, state };
})();
