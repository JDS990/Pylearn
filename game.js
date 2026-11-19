// PyLearn XP, ranks and streaks for the iPhone app (shared by drills.js and app.js).
// The numbers come from app/gamify.py (build.py fills in GAME), so desktop and phone match.
"use strict";
const PyGame = (() => {
  const GAME = {"rules": {"lesson": 50, "drill": 10, "drill_retry": 3, "card": 5, "card_repeat": 1, "daily_bonus": 25, "desktop_goal": 1}, "ranks": [{"name": "Beginner", "xp": 0, "emoji": "🌱", "desc": "Just getting started"}, {"name": "Coder", "xp": 50, "emoji": "⌨️", "desc": "Your first program runs"}, {"name": "Looper", "xp": 150, "emoji": "🔁", "desc": "Loops and decisions"}, {"name": "Function Builder", "xp": 300, "emoji": "🧩", "desc": "Writing your own tools"}, {"name": "Data Wrangler", "xp": 500, "emoji": "🗂️", "desc": "Lists, dicts and files tamed"}, {"name": "Tokenizer", "xp": 800, "emoji": "✂️", "desc": "Turning text into numbers"}, {"name": "Model Builder", "xp": 1200, "emoji": "🧠", "desc": "Counting, probabilities, first models"}, {"name": "Neural Net Trainer", "xp": 1700, "emoji": "🏋️", "desc": "Gradients and training loops"}, {"name": "Text Generator", "xp": 2300, "emoji": "✍️", "desc": "Your model writes text"}, {"name": "LM Engineer", "xp": 3000, "emoji": "🤖", "desc": "You built a language model"}]};
  const R = GAME.rules, RANKS = GAME.ranks;
  const DRILL_KEY = "pylearn.drills.v1", PROG_KEY = "pylearn.progress.v1";
  const pad = (n) => String(n).padStart(2, "0");
  const dayKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const prevKey = (k) => { const [y, m, d] = k.split("-").map(Number); return dayKey(new Date(y, m - 1, d - 1)); };

  function rankFor(xp) {
    let i = 0;
    RANKS.forEach((r, k) => { if (xp >= r.xp) i = k; });
    const r = RANKS[i], nx = RANKS[i + 1];
    return { index: i, name: r.name, emoji: r.emoji, min: r.xp, next: nx ? nx.name : null, next_xp: nx ? nx.xp : null,
      to_next: nx ? nx.xp - xp : 0, progress: nx ? (xp - r.xp) / (nx.xp - r.xp) : 1 };
  }
  // Consecutive met days ending today (or yesterday, if today isn't met yet: still alive).
  function streak(met, today = dayKey()) {
    let k = met[today] ? today : prevKey(today), n = 0;
    while (met[k]) { n++; k = prevKey(k); }
    return n;
  }
  // One-time estimate of XP already earned by drill history saved before XP existed.
  // Item ids look like "1.5:p:ab12cd34"; the letter c = flashcard.
  function backfill(st) {
    let xp = 0;
    for (const [id, r] of Object.entries(st.items || {})) {
      if (id.split(":")[1] === "c") xp += R.card * (r.n || 0);
      else { const ok = r.ok || 0, retry = Math.min(r.lapses || 0, ok); xp += R.drill * (ok - retry) + R.drill_retry * retry; }
    }
    return xp + R.daily_bonus * Object.keys(st.met || {}).length;
  }
  // XP is derived, so syncing with the desktop can't double count it:
  //   phone XP = this device's drill/card XP (st.dxp) + other devices' drill XP (st.peerXp,
  //              from sync) + daily bonus x goal-met days (st.met, any device)
  //   total    = phone XP + lesson XP x coding lessons completed
  // st.xp is kept as "phone XP" for older versions / backups. State saved before this
  // version only had a running st.xp (bonuses included): its drill part becomes st.dxp.
  const metCount = (st) => Object.keys(st.met || {}).filter(k => st.met[k]).length;
  function phoneXp(st) {
    let peers = 0;
    for (const v of Object.values(st.peerXp || {})) if (typeof v === "number" && v > 0) peers += v;
    return (st.dxp || 0) + peers + R.daily_bonus * metCount(st);
  }
  function normXp(st) {     // in place; idempotent
    if (typeof st.dxp !== "number" || !isFinite(st.dxp)) {
      const legacy = typeof st.xp === "number" && isFinite(st.xp) ? st.xp : backfill(st);
      st.dxp = Math.max(0, Math.round(legacy - R.daily_bonus * metCount(st)));
    }
    if (!st.peerXp || typeof st.peerXp !== "object") st.peerXp = {};
    if (typeof st.dev !== "string" || !/^phone-[a-z0-9]{6,12}$/.test(st.dev)) st.dev = "phone-" + Math.random().toString(36).slice(2, 10).padEnd(8, "0");
    st.xp = phoneXp(st);
    return st;
  }
  function codingDone(validIds) {
    try {
      const p = JSON.parse(localStorage.getItem(PROG_KEY) || "null") || {};
      const c = Array.isArray(p.completed) ? p.completed : [];
      return [...new Set(c.filter(id => !validIds || validIds(id)))];
    } catch (e) { return []; }
  }
  // Total = XP earned on the phone (drills, cards, daily bonuses) + coding lessons completed.
  function summary(st, validIds) {
    const lessons = codingDone(validIds).length;
    const own = typeof st.dxp === "number" ? phoneXp(st) : phoneXp(normXp(JSON.parse(JSON.stringify(st || {}))));
    const xp = own + R.lesson * lessons;
    const s = streak(st.met || {});
    return { xp, drillXp: own, lessonXp: R.lesson * lessons, lessons, rank: rankFor(xp), streak: s,
      best: Math.max(st.best || 0, s), todayMet: !!(st.met || {})[dayKey()] };
  }
  // Used by the coding page: passing a lesson meets today's goal (like on the desktop).
  function codingPass(validIds) {
    let st;
    try { st = JSON.parse(localStorage.getItem(DRILL_KEY) || "null"); } catch (e) { st = null; }
    if (!st || typeof st !== "object") st = { v: 1, items: {}, days: {}, met: {}, goal: 10, here: null, best: 0 };
    st.met = st.met && typeof st.met === "object" ? st.met : {};
    if (typeof st.xp !== "number" && typeof st.dxp !== "number") { st.xp = backfill(st); st.xpBackfill = st.xp; }
    normXp(st);                    // before today is marked, so an old running total converts correctly
    const k = dayKey();
    let bonus = 0;
    if (!st.met[k]) { st.met[k] = 1; bonus = R.daily_bonus; }
    normXp(st);
    st.best = Math.max(st.best || 0, streak(st.met));
    try { localStorage.setItem(DRILL_KEY, JSON.stringify(st)); } catch (e) {}
    return { bonus, state: st, game: summary(st, validIds) };
  }

  // ---- UI bits shared by both pages
  const css = `
  .pg-badge{display:inline-flex;align-items:center;gap:5px;font:700 14px/1 system-ui,-apple-system,sans-serif;padding:6px 10px;border-radius:999px;border:none;cursor:pointer;white-space:nowrap;color:inherit;background:rgba(127,127,127,.18);min-height:34px;font-variant-numeric:tabular-nums}
  .pg-badge .pg-x{font-weight:600;opacity:.85;font-size:12.5px}
  .pg-badge .pg-f.off{opacity:.55;font-weight:500}
  #pgUp{position:fixed;inset:0;z-index:100;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.45);padding:20px;pointer-events:none;animation:pgFade 3.6s ease forwards}
  #pgUp .pg-box{background:var(--card,#fff);color:var(--text,#111);border:2px solid #f5b041;border-radius:22px;padding:26px 22px;max-width:340px;width:100%;text-align:center;box-shadow:0 0 70px rgba(245,176,65,.45);animation:pgPop .55s cubic-bezier(.2,1.6,.4,1)}
  #pgUp .pg-big{font-size:72px;line-height:1.1;animation:pgWig 1s ease-in-out .45s 2}
  #pgUp h3{margin:10px 0 4px;font-size:23px} #pgUp p{margin:0;opacity:.75}

  .pg-spark{position:fixed;left:50%;top:42%;z-index:101;font-size:24px;pointer-events:none;animation:pgBurst 1.3s ease-out forwards}
  .pg-float{position:fixed;z-index:90;font:800 18px system-ui,sans-serif;color:#e39a1c;pointer-events:none;animation:pgRise 1s ease-out forwards;text-shadow:0 1px 0 rgba(0,0,0,.15)}
  @keyframes pgFade{0%,82%{opacity:1}100%{opacity:0}}
  @keyframes pgPop{from{transform:scale(.4);opacity:0}to{transform:scale(1);opacity:1}}
  @keyframes pgWig{0%,100%{transform:rotate(0)}25%{transform:rotate(-12deg) scale(1.1)}75%{transform:rotate(12deg) scale(1.1)}}
  @keyframes pgBurst{from{transform:translate(-50%,-50%) scale(.5);opacity:1}to{transform:translate(calc(-50% + var(--dx)),calc(-50% + var(--dy))) scale(1.2);opacity:0}}
  @keyframes pgRise{from{transform:translateY(0);opacity:1}to{transform:translateY(-46px);opacity:0}}
  @media (prefers-reduced-motion:reduce){#pgUp .pg-box,#pgUp .pg-big,.pg-spark,.pg-float{animation:none}}`;
  if (typeof document !== "undefined") { const s = document.createElement("style"); s.textContent = css; document.head.appendChild(s); }
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const short = (n) => n >= 10000 ? (n / 1000).toFixed(n >= 100000 ? 0 : 1) + "k" : String(n);
  function badge(el, g) {
    if (!el) return;
    el.classList.add("pg-badge");
    el.innerHTML = `<span aria-hidden="true">${g.rank.emoji}</span><span class="pg-xp">${short(g.xp)}</span><span class="pg-x">XP</span><span class="pg-f ${g.streak ? "" : "off"}">🔥<b>${g.streak}</b></span>`;
    el.title = `${g.rank.name}: ${g.xp} XP` + (g.rank.next ? `, ${g.rank.to_next} to ${g.rank.next}` : "") + `. ${g.streak}-day streak.`;
    el.setAttribute("aria-label", el.title + " Open ranks.");
  }
  function celebrate(g) {
    const old = document.getElementById("pgUp"); if (old) old.remove();
    const o = document.createElement("div"); o.id = "pgUp"; o.setAttribute("role", "dialog");
    o.innerHTML = `<div class="pg-box"><div class="pg-big">${g.rank.emoji}</div><h3>Rank up!<br>You're a ${esc(g.rank.name)}</h3>
      <p>${g.xp} XP${g.rank.next ? ` · next: ${esc(g.rank.next)} at ${g.rank.next_xp}` : " · top rank!"}</p></div>`;
    // purely visual (never blocks a tap) and gone after a few seconds
    document.body.appendChild(o);
    setTimeout(() => o.remove(), 3600);
    for (let i = 0; i < 16; i++) {
      const sp = document.createElement("span"); sp.className = "pg-spark"; sp.textContent = ["✨", "⭐", "🎉", "💫"][i % 4];
      const a = (i / 16) * 2 * Math.PI; sp.style.setProperty("--dx", Math.cos(a) * 150 + "px"); sp.style.setProperty("--dy", Math.sin(a) * 190 + "px");
      document.body.appendChild(sp); setTimeout(() => sp.remove(), 1400);
    }
    if (navigator.vibrate) try { navigator.vibrate([30, 40, 30]); } catch (e) {}
  }
  function floatXP(n, near) {
    if (!n) return;
    const f = document.createElement("div"); f.className = "pg-float"; f.textContent = "+" + n + " XP";
    const r = near && near.getBoundingClientRect ? near.getBoundingClientRect() : { right: innerWidth - 20, top: 60 };
    f.style.left = Math.max(10, Math.min(innerWidth - 90, r.right - 80)) + "px"; f.style.top = Math.max(50, r.top) + "px";
    document.body.appendChild(f); setTimeout(() => f.remove(), 1100);
  }
  return { RULES: R, RANKS, rankFor, streak, backfill, summary, codingPass, normXp, phoneXp, badge, celebrate, floatXP, dayKey };
})();
