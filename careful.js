/* careful.js - "slow down and read the task" helpers shared by the desktop app
   (inlined into index.html by pylearn.py) and the iPhone coding page (copied by
   web/build.py). Plain browser JS, no dependencies.

   - tipFor(i): the rotating "Read carefully" prompt shown above every task
   - renderGate(box, lesson, opts): 1-2 tap questions about the task; wrong answers
     point back at the task line to re-read; opts.onPass() runs when all are right
   - nudge(taskText, result): {phrase} of the task line a failed check is about
   - flash(taskEl, phrase): highlight + scroll to the task line containing phrase
   - Breather: two failed checks within 30 s -> "take a breath" + 5 s soft pause */
(function () {
  "use strict";
  const TIPS = [
    "Read the task twice. What exact output is it asking for?",
    "Underline the variable names you must use.",
    "Predict what your code prints before you run it.",
    "Look for edge cases: empty text, capitals, a missing key.",
    "Check the exact format: spaces, commas and capitals matter.",
    "Use the variables the task gives you. Don't type the answer in.",
  ];
  const BREATH_WINDOW_MS = 30000, BREATH_PAUSE_S = 5;

  function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
  function norm(s) { return String(s || "").replace(/[`*]/g, "").replace(/\s+/g, " ").trim().toLowerCase(); }
  function tipFor(i) { return TIPS[((i % TIPS.length) + TIPS.length) % TIPS.length]; }
  function shuffle(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

  let cssDone = false;
  function injectCSS() {
    if (cssDone || typeof document === "undefined") return; cssDone = true;
    const st = document.createElement("style");
    st.textContent = `
.readtip{display:flex;gap:8px;align-items:flex-start;background:#1d1a10;border:1px solid #6b5a1e;border-left:4px solid #e3b341;color:#f2dfa0;border-radius:8px;padding:8px 12px;margin:4px 0 10px;font-size:14.5px;line-height:1.45}
.readtip b{color:#ffd970;white-space:nowrap}
.gate{border:1px solid #3a4a63;background:#121a26;border-radius:10px;padding:12px 14px;margin:10px 0}
.gate h4{margin:0 0 4px;font-size:15px;color:#cfe3ff}
.gate .gsub{color:#8b98a8;font-size:13px;margin:0 0 8px}
.gq{margin:10px 0 4px}.gq p{margin:0 0 7px;font-weight:600}
.gopts{display:flex;flex-direction:column;gap:6px}
.gopt{text-align:left;font:inherit;font-size:14.5px;line-height:1.35;padding:9px 12px;min-height:40px;border-radius:8px;border:1px solid #2a3441;background:#1c2430;color:#dfe6ee;cursor:pointer}
.gopt:hover{border-color:#4fa3ff}
.gopt.right{border-color:#3fb950;background:#12261a;color:#aff5b4;cursor:default}
.gopt.wrong{border-color:#f85149;background:#2a1416;color:#ffd1cf;text-decoration:line-through}
.gopt:disabled{opacity:1}
.gq.done .gopt:not(.right){opacity:.45}
.gfb{font-size:14px;margin-top:6px;color:#ffd1cf}
.gfb.ok{color:#aff5b4}
.gfb a{color:#ffd970;cursor:pointer;text-decoration:underline}
.gate.passed{border-color:#3fb950}
.lockwrap{position:relative}
.lockwrap.locked>.lockveil{display:flex}
.lockveil{display:none;position:absolute;inset:0;z-index:5;align-items:center;justify-content:center;text-align:center;padding:16px;background:rgba(11,15,20,.82);border-radius:8px;color:#cfe3ff;font-weight:600;font-size:15px;cursor:not-allowed}
.lockwrap.locked button{pointer-events:none}
.reread-flash{background:rgba(227,179,65,.22)!important;outline:2px solid #e3b341;outline-offset:2px;border-radius:4px;transition:background .3s}
.nudge{display:block;font-weight:700;color:#ffd970;margin-bottom:4px}
.nudge a{color:#ffd970;cursor:pointer;text-decoration:underline}
.banner.breathe,.breathe{background:#10202a;border:1px solid #4fa3ff;color:#cfe3ff;border-radius:8px;padding:11px 14px;margin-top:10px;font-size:14.5px;line-height:1.5}
`;
    document.head.appendChild(st);
  }

  // ---- highlight the task line that contains a phrase
  function lineFor(taskEl, phrase) {
    if (!taskEl || !phrase) return null;
    const want = norm(phrase);
    let best = null;
    taskEl.querySelectorAll("li, p, pre, td, h4").forEach(el => {
      if (norm(el.textContent).includes(want)) {
        // prefer the innermost (shortest) element that contains the phrase
        if (!best || el.textContent.length < best.textContent.length) best = el;
      }
    });
    return best;
  }
  function flash(taskEl, phrase, scroll) {
    const el = lineFor(taskEl, phrase);
    if (!el) return null;
    taskEl.querySelectorAll(".reread-flash").forEach(x => x.classList.remove("reread-flash"));
    el.classList.add("reread-flash");
    if (scroll !== false && el.scrollIntoView) el.scrollIntoView({ behavior: "smooth", block: "center" });
    clearTimeout(el._flashT);
    el._flashT = setTimeout(() => el.classList.remove("reread-flash"), 6000);
    return el;
  }

  // ---- which task line is a failed check about?
  const STOP = new Set("should the and with your got have that this for are from was not but you use make sure its it's into then when what which there their them they each every only just like also than more most into code test line lines print printed exactly value values list".split(" "));
  function cleanLine(raw) {
    return raw.replace(/^\s*(?:[-*]|\d+\.)\s+/, "").replace(/[`*]/g, "").trim();
  }
  function shortPhrase(s) {
    s = cleanLine(s);
    if (s.length <= 70) return s;
    const cut = s.slice(0, 70); return cut.slice(0, cut.lastIndexOf(" ") > 40 ? cut.lastIndexOf(" ") : 70) + "…";
  }
  function nudge(taskText, result) {
    if (result && result.task_ref) return { phrase: result.task_ref, search: result.task_ref };
    const msg = String((result && result.message) || "");
    const words = (msg.match(/[A-Za-z_][A-Za-z0-9_]{2,}/g) || []).map(w => w.toLowerCase()).filter(w => !STOP.has(w));
    if (!words.length) return null;
    const lines = String(taskText || "").split("\n").map(x => x.trim()).filter(x => x && !/^```/.test(x));
    let best = null, bestScore = 0;
    lines.forEach(line => {
      const lw = new Set((line.match(/[A-Za-z_][A-Za-z0-9_]{2,}/g) || []).map(w => w.toLowerCase()));
      let score = 0;
      new Set(words).forEach(w => { if (lw.has(w)) score += w.includes("_") || w.length > 6 ? 2 : 1; });
      if (score > bestScore) { bestScore = score; best = line; }
    });
    if (!best || bestScore < 1) return null;
    const c = cleanLine(best);
    return { phrase: shortPhrase(best), search: c.length > 60 ? c.slice(0, 50) : c };
  }
  function nudgeHTML(n) {
    if (!n) return '<span class="nudge">🐢 Slow down: read the task again, line by line, and compare it with your output.</span>';
    return '<span class="nudge">🐢 Slow down: re-read the task line about <a class="nudge-link">“' + esc(n.phrase) + '”</a>.</span>';
  }

  // ---- the comprehension gate
  function renderGate(box, lesson, opts) {
    opts = opts || {};
    const qs = lesson.gate || [];
    const taskEl = opts.taskEl;
    box.innerHTML = "";
    box.className = "gate";
    box.innerHTML = '<h4>👀 Before you code: did you read the task?</h4><p class="gsub">Tap the right answer. A wrong answer is fine: it shows you which part to read again.</p>';
    let left = qs.length;
    if (!left) { if (opts.onPass) opts.onPass(); return; }
    qs.forEach((q, qi) => {
      const d = document.createElement("div");
      d.className = "gq";
      d.innerHTML = '<p>' + (qs.length > 1 ? (qi + 1) + ". " : "") + esc(q.q) + '</p><div class="gopts"></div><div class="gfb" aria-live="polite"></div>';
      const optsEl = d.querySelector(".gopts"), fb = d.querySelector(".gfb");
      shuffle([q.right].concat(q.wrong)).forEach(choice => {
        const b = document.createElement("button");
        b.type = "button"; b.className = "gopt"; b.textContent = choice;
        b.onclick = () => {
          if (d.classList.contains("done")) return;
          if (choice === q.right) {
            b.classList.add("right"); d.classList.add("done");
            optsEl.querySelectorAll(".gopt").forEach(x => x.disabled = true);
            fb.className = "gfb ok"; fb.textContent = "✓ Right.";
            left -= 1;
            if (left === 0) { box.classList.add("passed"); if (opts.onPass) opts.onPass(); }
          } else {
            b.classList.add("wrong"); b.disabled = true;
            fb.className = "gfb";
            fb.innerHTML = 'Not quite. Re-read the part of the task about <a>“' + esc(q.reread) + '”</a>, then try again.';
            const go = () => flash(taskEl, q.reread);
            fb.querySelector("a").onclick = go;
            go();
          }
        };
        optsEl.appendChild(b);
      });
      box.appendChild(d);
    });
  }

  // ---- breather: two failed checks close together
  const fails = {};
  function recordFail(id, now) {
    now = now || Date.now();
    const prev = fails[id];
    fails[id] = now;
    if (prev && now - prev < BREATH_WINDOW_MS) { fails[id] = 0; return true; }
    return false;
  }
  function breatheHTML() {
    return '<div class="breathe" id="breathe">🌬️ <b>Take a breath.</b> Read the task one more time, line by line. Check unlocks in <span class="bcount">' + BREATH_PAUSE_S + "</span> s.</div>";
  }
  // disables btn for BREATH_PAUSE_S seconds with a countdown; returns a cancel fn
  function pause(btn, label, root) {
    let n = BREATH_PAUSE_S;
    btn.disabled = true; btn.dataset.breath = "1";
    const tick = () => {
      const c = (root || document).querySelector("#breathe .bcount");
      if (n <= 0) {
        btn.disabled = false; delete btn.dataset.breath; btn.textContent = label;
        const bd = (root || document).querySelector("#breathe");
        if (bd) bd.innerHTML = "🌬️ <b>Ready when you are.</b> Read it line by line, then check again.";
        return;
      }
      btn.textContent = label + " (" + n + ")";
      if (c) c.textContent = n;
      n -= 1;
      btn._breathT = setTimeout(tick, 1000);
    };
    tick();
    return () => { clearTimeout(btn._breathT); btn.disabled = false; delete btn.dataset.breath; btn.textContent = label; };
  }

  const api = { TIPS, tipFor, norm, injectCSS, renderGate, flash, lineFor, nudge, nudgeHTML, recordFail, breatheHTML, pause,
                BREATH_WINDOW_MS, BREATH_PAUSE_S };
  if (typeof window !== "undefined") window.PyCareful = api;
  if (typeof module !== "undefined") module.exports = api;
})();
