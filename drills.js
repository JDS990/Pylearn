"use strict";
/* PyLearn drills: tap-first practice for the PyLearn course (no typing, no Python download).
   Data: data/lessons.json (course) + data/drills.json (drill bank verified at build time).
   State: localStorage "pylearn.drills.v1" (spaced repetition, streak), next to the coding
   lessons' "pylearn.progress.v1", which this page only reads (and replaces on Import). */

const DRILL_KEY = "pylearn.drills.v1";
const PROG_KEY = "pylearn.progress.v1";
const INTERVALS = [0, 1, 3, 7, 14, 30];        // Leitner boxes 0..5 -> days until the next review
const TYPE_NAME = { predict: "Predict the output", order: "Put the lines in order", fill: "Fill the blank", bug: "Spot the bug", card: "Flashcard" };
const TYPE_ICON = { predict: "🔮", order: "🧩", fill: "✏️", bug: "🐞", card: "🃏" };
const PRAISE = ["Correct!", "Nice!", "Exactly right!", "You got it!", "Spot on!"];
const $ = (id) => document.getElementById(id);
const D = { modules: [], lessons: [], byId: {}, idx: {}, bank: {}, items: {}, lessonOf: {} };
let ST = null;          // drill state
let SESSION = null;     // active practice session
let META = null;

// ------------------------------------------------------------------ dates (local calendar days)
function pad(n) { return String(n).padStart(2, "0"); }
function dayKey(d = new Date()) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function dayNum(key) { const [y, m, d] = key.split("-").map(Number); return Math.round(Date.UTC(y, m - 1, d) / 864e5); }
function keyOf(n) { return new Date(n * 864e5).toISOString().slice(0, 10); }
function today() { return dayNum(dayKey()); }

// ------------------------------------------------------------------ storage
function blankState() { return { v: 1, items: {}, days: {}, met: {}, goal: 10, here: null, best: 0, xp: 0 }; }
function normState(d) {
  const s = blankState();
  if (!d || typeof d !== "object") return s;
  if (d.items && typeof d.items === "object") {
    for (const [k, v] of Object.entries(d.items)) {
      if (!v || typeof v !== "object") continue;
      const num = (x, lo, hi) => (typeof x === "number" && isFinite(x) ? Math.min(hi, Math.max(lo, Math.round(x))) : lo);
      s.items[k] = { b: num(v.b, 0, 5), due: num(v.due, 0, 1e6), n: num(v.n, 0, 1e7), ok: num(v.ok, 0, 1e7), lapses: num(v.lapses, 0, 1e7), last: num(v.last, 0, 1e6) };
    }
  }
  for (const f of ["days", "met"]) if (d[f] && typeof d[f] === "object")
    for (const [k, v] of Object.entries(d[f])) if (/^\d{4}-\d\d-\d\d$/.test(k) && typeof v === "number") s[f][k] = v;
  if ([5, 10, 15, 20].includes(d.goal)) s.goal = d.goal;
  if (typeof d.here === "string") s.here = d.here;
  if (typeof d.best === "number") s.best = d.best;
  // XP: kept if present; state saved before XP existed gets a one-time estimate from its
  // history (pure function of the state, so loading it again gives the same number).
  if (typeof d.xp === "number" && isFinite(d.xp)) { s.xp = Math.max(0, Math.round(d.xp)); if (typeof d.xpBackfill === "number") s.xpBackfill = d.xpBackfill; }
  else { s.xp = PyGame.backfill(s); s.xpBackfill = s.xp; }
  return s;
}
function loadState() {
  let raw = null;
  try { raw = JSON.parse(localStorage.getItem(DRILL_KEY) || "null"); } catch (e) {}
  const s = normState(raw);
  if (raw && typeof raw === "object" && typeof raw.xp !== "number") { ST = s; saveState(); }   // persist the backfill once
  return s;
}
function saveState() {
  try { localStorage.setItem(DRILL_KEY, JSON.stringify(ST)); return true; }
  catch (e) { toast("Couldn't save on this device (storage full or blocked).", true); return false; }
}
function codingProgress() {
  try {
    const p = JSON.parse(localStorage.getItem(PROG_KEY) || "null") || {};
    return { completed: Array.isArray(p.completed) ? p.completed.filter(id => D.byId[id]) : [], last: D.byId[p.last] ? p.last : null, raw: p };
  } catch (e) { return { completed: [], last: null, raw: {} }; }
}

// ------------------------------------------------------------------ spaced repetition (Leitner)
function rec(id) { return ST.items[id]; }
function grade(id, result) {          // result: "again" | "good" | "easy"
  const t = today();
  const it = ST.items[id] || { b: 0, due: t, n: 0, ok: 0, lapses: 0, last: t };
  it.n++;
  if (result === "again") { it.lapses++; it.b = 1; it.due = t; }       // missed: back in the queue today
  else { it.ok++; it.b = Math.min(5, it.b + (result === "easy" ? 2 : 1)); it.due = t + INTERVALS[it.b]; }
  it.last = t;
  ST.items[id] = it;
  const k = dayKey();
  ST.days[k] = (ST.days[k] || 0) + 1;
  if (ST.days[k] >= ST.goal && !ST.met[k]) { ST.met[k] = 1; ST.best = Math.max(ST.best, streak()); justMet = true; }
  saveState();
}
let justMet = false;
function streak() {
  let n = today();
  if (!ST.met[keyOf(n)]) n--;          // today's goal not met yet: the streak is still alive from yesterday
  let s = 0;
  while (ST.met[keyOf(n)]) { s++; n--; }
  return s;
}
function doneToday() { return ST.days[dayKey()] || 0; }

// ------------------------------------------------------------------ XP + ranks (rules in game.js)
function game() { return PyGame.summary(ST, (id) => !!D.byId[id]); }
function renderBadge() { PyGame.badge($("streakChip"), game()); }
function addXP(n, near) {
  if (!n) return;
  const before = game().rank.index;
  ST.xp = (ST.xp || 0) + n;
  saveState();
  PyGame.floatXP(n, near);
  renderBadge();
  const g = game();
  if (g.rank.index > before) setTimeout(() => PyGame.celebrate(g), 650);
}
// XP for one answer (call BEFORE grade() so "already answered today" is known)
function xpFor(it, ok, firstInSession) {
  const r = rec(it.id), repeat = !!(r && r.last === today());
  const R = PyGame.RULES;
  if (it.type === "card") return firstInSession && !repeat ? R.card : R.card_repeat;
  if (!ok) return 0;
  return firstInSession && !repeat ? R.drill : R.drill_retry;
}

// ------------------------------------------------------------------ course position
function lessonItems(lid) { const L = D.bank[lid]; return L ? L.drills.concat(L.cards) : []; }
function hereId() {
  if (ST.here && D.byId[ST.here]) return ST.here;
  const cp = codingProgress();
  if (cp.last) return cp.last;
  const firstTodo = D.lessons.find(l => !cp.completed.includes(l.id));
  return (firstTodo || D.lessons[0]).id;
}
function frontier() {
  let f = D.idx[hereId()];
  for (const id of codingProgress().completed) f = Math.max(f, D.idx[id]);
  for (const id of Object.keys(ST.items)) { const l = D.lessonOf[id]; if (l) f = Math.max(f, D.idx[l]); }
  return f;
}
function unlocked() { return D.lessons.slice(0, frontier() + 1).map(l => l.id); }
function mastery(lid) {
  const items = lessonItems(lid);
  if (!items.length) return 0;
  return items.filter(it => (rec(it.id) || {}).b >= 2).length / items.length;
}
function lessonStats(lid) {
  let n = 0, ok = 0, seen = 0;
  for (const it of lessonItems(lid)) { const r = rec(it.id); if (r) { seen++; n += r.n; ok += r.ok; } }
  return { n, ok, seen, acc: n ? ok / n : 1 };
}
function weakLessons(limit = 3) {
  return unlocked().map(id => ({ id, ...lessonStats(id) })).filter(s => s.n >= 3 && s.acc < 0.8)
    .sort((a, b) => a.acc - b.acc).slice(0, limit);
}
function dueCards() {
  const t = today(), out = [];
  for (const lid of unlocked()) for (const c of D.bank[lid].cards) { const r = rec(c.id); if (r && r.due <= t) out.push(c.id); }
  return out;
}

// ------------------------------------------------------------------ building sessions
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function interleave(ids) {      // avoid two of the same drill type in a row where possible
  const out = [], rest = ids.slice();
  while (rest.length) {
    const prev = out.length ? D.items[out[out.length - 1]].type : null;
    let k = rest.findIndex(id => D.items[id].type !== prev);
    if (k < 0) k = 0;
    out.push(rest.splice(k, 1)[0]);
  }
  return out;
}
function byTypeRoundRobin(items) {   // keep the order within each type, but rotate types
  const groups = new Map();
  for (const it of items) { if (!groups.has(it.type)) groups.set(it.type, []); groups.get(it.type).push(it); }
  const out = [], gs = [...groups.values()];
  for (let i = 0; out.length < items.length; i++) for (const g of gs) if (g[i]) out.push(g[i]);
  return out;
}
function buildDaily(n = ST.goal) {
  const t = today(), here = hereId(), unl = unlocked();
  const all = unl.flatMap(lessonItems);
  const seen = all.filter(it => rec(it.id));
  const picked = [], has = new Set();
  let cards = 0;
  const add = (it) => {
    if (picked.length >= n || has.has(it.id)) return;
    if (it.type === "card") { if (cards >= Math.max(2, Math.round(n * 0.3))) return; cards++; }
    picked.push(it.id); has.add(it.id);
  };
  // 1. due reviews (missed ones first, then oldest)
  byTypeRoundRobin(seen.filter(it => rec(it.id).due <= t)
    .sort((a, b) => (rec(b.id).b === 1) - (rec(a.id).b === 1) || rec(a.id).due - rec(b.id).due || rec(b.id).lapses - rec(a.id).lapses))
    .slice(0, Math.ceil(n * 0.6)).forEach(add);
  // 2. weak spots: items missed before, lowest accuracy first
  seen.filter(it => rec(it.id).lapses > 0).sort((a, b) => rec(a.id).ok / rec(a.id).n - rec(b.id).ok / rec(b.id).n).slice(0, 2).forEach(add);
  // 3. new material from where he is, then from recent lessons going back
  const hi = unl.indexOf(here) >= 0 ? unl.indexOf(here) : unl.length - 1;
  const order = [here, ...unl.slice(0, hi).reverse(), ...unl.slice(hi + 1)];
  for (const lid of order) for (const it of interleave(lessonItems(lid).map(x => x.id)).map(id => D.items[id])) if (!rec(it.id)) add(it);
  // 4. still short (everything seen): review ahead, earliest due first
  seen.slice().sort((a, b) => rec(a.id).due - rec(b.id).due).forEach(add);
  return interleave(shuffle(picked));
}
function buildLesson(lid) { return interleave(D.bank[lid].drills.map(d => d.id)); }
function buildCards(lid) {
  if (lid) return shuffle(D.bank[lid].cards.map(c => c.id));
  const due = shuffle(dueCards());
  const fresh = [];
  for (const id of [hereId(), ...unlocked().reverse()]) for (const c of D.bank[id].cards) if (!rec(c.id) && !fresh.includes(c.id)) fresh.push(c.id);
  return due.concat(fresh.slice(0, Math.max(0, 5 - Math.min(due.length, 5)))).slice(0, 20);
}

// ------------------------------------------------------------------ text helpers (same tiny markdown as the coding app)
function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
function inline(s) {
  const codes = [];
  s = String(s).replace(/`([^`]+)`/g, (m, c) => { codes.push(c); return "\u0000" + (codes.length - 1) + "\u0000"; });
  s = esc(s);
  s = s.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
  s = s.replace(/(^|[^*\w])\*([^*\s][^*]*)\*(?!\w)/g, "$1<i>$2</i>");
  s = s.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  s = s.replace(/\u0000(\d+)\u0000/g, (m, i) => "<code>" + esc(codes[+i]) + "</code>");
  return s;
}
function md(src) {
  const lines = src.replace(/\r/g, "").split("\n");
  let html = "", i = 0;
  while (i < lines.length) {
    const ln = lines[i];
    if (/^```/.test(ln)) {
      const buf = []; i++;
      while (i < lines.length && !/^```/.test(lines[i])) { buf.push(lines[i]); i++; }
      i++; html += '<pre class="code">' + highlight(buf.join("\n")) + "</pre>"; continue;
    }
    if (/^\s*$/.test(ln)) { i++; continue; }
    if (/^#{1,4}\s/.test(ln)) { html += "<h4>" + inline(ln.replace(/^#+\s/, "")) + "</h4>"; i++; continue; }
    if (/^\|/.test(ln)) {
      const rows = [];
      while (i < lines.length && /^\|/.test(lines[i])) { rows.push(lines[i]); i++; }
      html += '<div class="tablewrap"><table>';
      rows.forEach((r, k) => {
        if (/^\|[\s\-:|]+\|$/.test(r)) return;
        const cells = r.replace(/^\||\|$/g, "").split("|"), tag = k === 0 ? "th" : "td";
        html += "<tr>" + cells.map(c => `<${tag}>${inline(c.trim())}</${tag}>`).join("") + "</tr>";
      });
      html += "</table></div>"; continue;
    }
    if (/^(- |\d+\. )/.test(ln)) {
      const ordered = /^\d+\. /.test(ln), items = [];
      while (i < lines.length && /^\s*(- |\d+\. )|^\s{2,}\S/.test(lines[i]) && !/^\s*$/.test(lines[i])) {
        const cur = lines[i]; i++;
        if (/^(- |\d+\. )/.test(cur)) items.push({ text: cur.replace(/^(- |\d+\. )/, ""), sub: [] });
        else if (/^\s+(- |\d+\. )/.test(cur) && items.length) items[items.length - 1].sub.push(cur.replace(/^\s+(- |\d+\. )/, ""));
        else if (items.length) { const it = items[items.length - 1]; if (it.sub.length) it.sub[it.sub.length - 1] += " " + cur.trim(); else it.text += " " + cur.trim(); }
      }
      html += ordered ? "<ol>" : "<ul>";
      for (const it of items) html += "<li>" + inline(it.text) + (it.sub.length ? "<ul>" + it.sub.map(x => "<li>" + inline(x) + "</li>").join("") + "</ul>" : "") + "</li>";
      html += ordered ? "</ol>" : "</ul>"; continue;
    }
    const para = [];
    while (i < lines.length && !/^\s*$/.test(lines[i]) && !/^```|^\||^#{1,4}\s|^(- |\d+\. )/.test(lines[i])) { para.push(lines[i]); i++; }
    html += "<p>" + inline(para.join(" ")) + "</p>";
  }
  return html;
}
const KW = new Set("False None True and as assert break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield".split(" "));
const BI = new Set("print len range sum max min sorted set list dict tuple str int float zip enumerate open abs round isinstance self map any all super type repr".split(" "));
function highlight(code) {
  const re = /(#[^\n]*)|([rbfRBF]?("""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'))|(\b\d+(?:\.\d+)?(?:e-?\d+)?\b)|([A-Za-z_]\w*)/g;
  let out = "", last = 0, m;
  while ((m = re.exec(code))) {
    out += esc(code.slice(last, m.index));
    const t = m[0];
    if (m[1]) out += '<span class="com">' + esc(t) + "</span>";
    else if (m[2]) out += '<span class="str">' + esc(t) + "</span>";
    else if (m[4]) out += '<span class="num">' + esc(t) + "</span>";
    else if (KW.has(t)) out += '<span class="kw">' + t + "</span>";
    else if (BI.has(t)) out += '<span class="bi">' + t + "</span>";
    else if (code[re.lastIndex] === "(") out += '<span class="fn">' + t + "</span>";
    else out += esc(t);
    last = re.lastIndex;
  }
  return out + esc(code.slice(last));
}
function outText(s) {   // printed output, with an error line styled
  return String(s).split("\n").map(l => /^Error: |^\(never stops/.test(l) ? '<span class="err-out">💥 ' + esc(l) + "</span>" : esc(l)).join("\n");
}
function indentHtml(line) {   // show leading indentation as faint guides
  const m = line.match(/^ */)[0].length;
  return '<span class="ind">' + "·   ".repeat(Math.floor(m / 4)).replace(/ /g, "\u00a0") + " ".repeat(m % 4) + "</span>" + highlight(line.slice(m));
}

// ------------------------------------------------------------------ chrome
function toast(msg, warn) {
  const t = $("toast"); t.textContent = msg; t.classList.toggle("warn", !!warn); t.classList.add("show");
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove("show"), warn ? 4000 : 2400);
}
function haptic(ok, el) {
  if (el) { el.classList.remove("pop", "shake"); void el.offsetWidth; el.classList.add(ok ? "pop" : "shake"); }
  try { if (navigator.vibrate) navigator.vibrate(ok ? 12 : [25, 40, 25]); } catch (e) {}
}
function setBar({ title, back, session } = {}) {
  $("barTitle").innerHTML = title ? esc(title) : "Py<span>Learn</span>";
  $("backBtn").classList.toggle("hidden", !back);
  $("backBtn").onclick = back || null;
  document.body.classList.toggle("in-session", !!session);
  $("sessProg").classList.toggle("hidden", !session);
  $("actbar").classList.toggle("hidden", !session);
  renderBadge();
}
function setTab(name) { for (const b of document.querySelectorAll("#tabs button")) b.classList.toggle("on", b.dataset.tab === name); }
for (const b of document.querySelectorAll("#tabs button")) b.onclick = () => go("#/" + b.dataset.tab);
function go(hash) { if (location.hash === hash) route(); else location.hash = hash; }
function act(html) { $("actbar").innerHTML = '<div class="in">' + html + "</div>"; }
function view(html) { $("view").innerHTML = html; window.scrollTo(0, 0); }

// ------------------------------------------------------------------ Today
function renderToday() {
  setBar({}); setTab("today");
  const n = doneToday(), goal = ST.goal, pct = Math.min(100, Math.round(100 * n / goal)), s = streak();
  const here = hereId(), hl = D.byId[here], hm = Math.round(100 * mastery(here));
  const dc = dueCards().length;
  const t = today();
  let week = "";
  for (let k = 6; k >= 0; k--) {
    const key = keyOf(t - k), d = new Date(key + "T12:00:00");
    week += `<div>${"SMTWTFS"[d.getDay()]}<i class="${ST.met[key] ? "met" : ""} ${k === 0 ? "today" : ""}">${ST.met[key] ? "✓" : ""}</i></div>`;
  }
  const met = n >= goal;
  const weak = weakLessons();
  view(`
    <div class="card hero">
      <div class="goal">
        <div class="ring" style="--p:${pct}"><div>${n}/${goal}<small>today</small></div></div>
        <div class="grow">
          <div style="font-size:21px;font-weight:750;line-height:1.2">${met ? "Daily goal done! 🎉" : n ? "Keep going!" : "Today's review"}</div>
          <div class="muted small">${s ? `🔥 ${s}-day streak${met ? "" : ": finish today's goal to keep it"}` : "Answer " + goal + " today to start a streak"}</div>
        </div>
      </div>
      <button class="btn primary" id="startDaily">${met ? "Bonus round" : n ? "Continue daily review" : "Start daily review"}<span class="small" style="opacity:.75">· ${goal}</span></button>
      <div class="week">${week}</div>
    </div>
    ${rankCard()}
    <div class="card here">
      <span class="badge">You are here</span>
      <div class="crumb" style="margin-top:8px">Module ${esc(hl.module)} · Lesson ${esc(here)}</div>
      <h3 style="margin:2px 0 6px;font-size:19px">${esc(hl.title)}</h3>
      <div class="bar"><div style="width:${hm}%"></div></div>
      <div class="muted small" style="margin:4px 0 12px">${hm}% mastered</div>
      <div class="btns two">
        <button class="btn primary" id="hereDrills">Practice</button>
        <button class="btn" id="hereOpen">Concepts</button>
      </div>
    </div>
    <div class="card">
      <div class="stat">
        <div><b>${dc}</b><span>cards due</span></div>
        <div><b>${s}</b><span>day streak</span></div>
        <div><b>${ST.best}</b><span>best streak</span></div>
      </div>
      <div style="margin-top:12px"><button class="btn" id="goCards">🃏 Review flashcards${dc ? ` (${dc} due)` : ""}</button></div>
    </div>
    ${weak.length ? `<div class="card"><h3>Weak spots</h3><div class="muted small">Lessons where you've missed the most. A quick round helps.</div>
      ${weak.map(w => `<button class="list-btn" data-lid="${w.id}"><div class="grow"><b>${w.id}</b> ${esc(D.byId[w.id].title)}<div class="muted small">${Math.round(100 * w.acc)}% right so far</div></div><span class="chev">›</span></button>`).join("")}</div>` : ""}
  `);
  $("startDaily").onclick = () => startSession("daily", buildDaily(), "Daily review");
  $("hereDrills").onclick = () => { startSession("lesson", buildLesson(here), "Lesson " + here, here); };
  $("hereOpen").onclick = () => go("#/lesson/" + here);
  $("goCards").onclick = () => go("#/cards");
  $("rankCard").onclick = () => go("#/ranks");
  for (const b of document.querySelectorAll(".list-btn[data-lid]")) b.onclick = () => startSession("lesson", buildLesson(b.dataset.lid), "Lesson " + b.dataset.lid, b.dataset.lid);
}

function rankCard() {
  const g = game();
  return `<button class="card rankcard" id="rankCard">
      <span class="rk-emoji">${g.rank.emoji}</span>
      <span class="grow"><span class="rk-name">${esc(g.rank.name)}</span> <span class="muted small">· ${g.xp} XP</span>
        <div class="bar gold"><div style="width:${Math.round(100 * g.rank.progress)}%"></div></div>
        <span class="muted small">${g.rank.next ? `${g.rank.to_next} XP to ${esc(g.rank.next)}` : "Top rank reached!"}</span></span>
      <span class="chev">›</span></button>`;
}

// ------------------------------------------------------------------ Ranks
function renderRanks() {
  setBar({ title: "Ranks", back: () => history.length > 1 ? history.back() : go("#/today") }); setTab("today");
  const g = game(), R = PyGame.RULES;
  view(`
    <div class="card center rank-hero">
      <div class="big-emoji">${g.rank.emoji}</div>
      <div class="end-title">${esc(g.rank.name)}</div>
      <div class="muted">${g.xp} XP${g.rank.next ? ` · ${g.rank.to_next} to ${esc(g.rank.next)}` : " · top rank!"}</div>
      <div class="bar gold" style="margin:12px 0 4px"><div style="width:${Math.round(100 * g.rank.progress)}%"></div></div>
      <div class="stat" style="margin-top:12px"><div><b>🔥 ${g.streak}</b><span>day streak</span></div><div><b>${g.best}</b><span>best streak</span></div><div><b>${g.lessons}</b><span>coding lessons</span></div></div>
    </div>
    <div class="ranklist">${PyGame.RANKS.map((r, i) => `<div class="rk ${i < g.rank.index ? "done" : i === g.rank.index ? "cur" : "locked"}" data-rank="${i}">
      <span class="rk-emoji">${i > g.rank.index ? "🔒" : r.emoji}</span>
      <span class="grow"><b>${esc(r.name)}</b><span class="muted small">${esc(r.desc)}</span></span>
      <span class="rk-xp">${r.xp} XP<small>${i < g.rank.index ? "✓ unlocked" : i === g.rank.index ? "★ you" : `${r.xp - g.xp} to go`}</small></span></div>`).join("")}</div>
    <div class="card"><h3>How to earn XP</h3><ul class="small xp-rules">
      <li>Right answer: <b>+${R.drill}</b> (after a miss, or again the same day: +${R.drill_retry})</li>
      <li>Flashcard review: <b>+${R.card}</b> (same card again today: +${R.card_repeat})</li>
      <li>Daily goal: <b>+${R.daily_bonus}</b> and your 🔥 streak grows</li>
      <li>Coding lesson, first time you pass it: <b>+${R.lesson}</b>. Passing one also counts as today's goal.</li></ul>
      <div class="muted small">The desktop app keeps its own XP and streak. The rules and ranks are the same.</div></div>`);
}

// ------------------------------------------------------------------ Lessons list
function renderLearn() {
  setBar({ title: "Lessons" }); setTab("learn");
  const here = hereId(), cp = codingProgress();
  let h = '<p class="muted small" style="margin:0 2px 12px">Open any lesson. Tap one to see its key ideas and practice it.</p>';
  for (const m of D.modules) {
    const isHere = m.lessons.includes(here);
    const mm = m.lessons.reduce((a, id) => a + mastery(id), 0) / m.lessons.length;
    h += `<div class="mod ${isHere ? "open" : ""}" data-mod="${m.id}">
      <button class="mod-head"><span class="mod-num">${m.id}</span><span class="grow"><span class="mod-title">${esc(m.title)}</span>
      <div class="bar"><div style="width:${Math.round(100 * mm)}%"></div></div></span><span class="chev">›</span></button><div class="mod-lessons">`;
    for (const id of m.lessons) {
      const l = D.byId[id], ms = Math.round(100 * mastery(id));
      h += `<button class="les ${id === here ? "cur" : ""}" data-id="${id}"><span class="id">${id}</span><span class="t">${esc(l.title)}
        ${id === here ? ' <span class="badge">Here</span>' : ""}<div class="bar"><div style="width:${ms}%"></div></div></span>
        ${cp.completed.includes(id) ? '<span class="done" title="Coding lesson complete">✓</span>' : ""}</button>`;
    }
    h += "</div></div>";
  }
  view(h);
  for (const el of document.querySelectorAll(".mod-head")) el.onclick = () => el.parentElement.classList.toggle("open");
  for (const el of document.querySelectorAll(".les")) el.onclick = () => go("#/lesson/" + el.dataset.id);
  const cur = document.querySelector(".les.cur"); if (cur) cur.scrollIntoView({ block: "center" });
}

// ------------------------------------------------------------------ Lesson page
function renderLesson(lid) {
  const l = D.byId[lid];
  if (!l) return go("#/learn");
  const m = D.modules.find(x => x.id === l.module), L = D.bank[lid];
  setBar({ title: "Lesson " + lid, back: () => history.length > 1 ? history.back() : go("#/learn") }); setTab("learn");
  const st = lessonStats(lid), ms = Math.round(100 * mastery(lid));
  const counts = {};
  for (const d of L.drills) counts[d.type] = (counts[d.type] || 0) + 1;
  const done = codingProgress().completed.includes(lid);
  view(`
    <div class="crumb">Module ${esc(m.id)} · ${esc(m.title)}</div>
    <h2 class="page">${esc(l.title)}</h2>
    <div class="card summary">
      <h3>💡 Key ideas</h3>
      <ul>${L.summary.map(s => "<li>" + inline(s) + "</li>").join("")}</ul>
      <button class="linkbtn" id="readFull">Read the full lesson ›</button>
    </div>
    <div class="btns">
      <button class="btn primary col" id="practice">▶ Practice drills<span class="sub">${L.drills.length} drills · ${Object.entries(counts).map(([t, n]) => TYPE_ICON[t] + " " + n).join("  ")}</span></button>
      <button class="btn col" id="flash">🃏 Flashcards<span class="sub">${L.cards.length} cards</span></button>
    </div>
    <div class="card" style="margin-top:14px">
      <div class="row"><div class="grow"><b>${ms}% mastered</b><div class="muted small">${st.seen ? `${Math.round(100 * st.acc)}% right · ${st.seen} of ${L.drills.length + L.cards.length} practiced` : "Not practiced yet"}</div></div>
      ${lid === hereId() ? '<span class="badge">You are here</span>' : `<button class="btn ghost" style="width:auto;min-height:44px;font-size:14px" id="setHere">Make this my lesson</button>`}</div>
      <div class="bar"><div style="width:${ms}%"></div></div>
    </div>
    <div class="card">
      <h3>⌨️ Code it yourself ${done ? '<span class="done">✓ done</span>' : ""}</h3>
      <div class="muted small">The full coding exercise, with a keyboard. Best on a computer. The first time, it downloads Python (about 14 MB), so use Wi-Fi.</div>
      <a class="btn" style="margin-top:10px" href="code.html#${encodeURIComponent(lid)}" id="codeIt">Open coding lesson</a>
    </div>
    <div class="why"><b>🧭 Why this matters:</b> ${inline(m.why.trim().replace(/\n/g, " "))}</div>
  `);
  $("practice").onclick = () => startSession("lesson", buildLesson(lid), "Lesson " + lid, lid);
  $("flash").onclick = () => startSession("cards", buildCards(lid), "Cards " + lid, lid);
  $("readFull").onclick = () => go("#/read/" + lid);
  const sh = $("setHere"); if (sh) sh.onclick = () => { ST.here = lid; saveState(); renderLesson(lid); toast("Lesson " + lid + " is now your current lesson"); };
}
function renderRead(lid) {
  const l = D.byId[lid];
  if (!l) return go("#/learn");
  setBar({ title: lid + " " + l.title, back: () => history.length > 1 ? history.back() : go("#/lesson/" + lid) }); setTab("learn");
  view(`<h2 class="page">${esc(l.title)}</h2><div class="card md">${md(l.text)}</div>
    <div class="card"><h3>Example</h3><pre class="code">${highlight(l.example.replace(/\n$/, ""))}</pre></div>
    <button class="btn primary" id="practice">▶ Practice this lesson</button>`);
  $("practice").onclick = () => startSession("lesson", buildLesson(lid), "Lesson " + lid, lid);
}

// ------------------------------------------------------------------ Cards tab
function renderCardsTab() {
  setBar({ title: "Flashcards" }); setTab("cards");
  const due = dueCards().length, total = unlocked().reduce((a, id) => a + D.bank[id].cards.length, 0);
  const seen = unlocked().reduce((a, id) => a + D.bank[id].cards.filter(c => rec(c.id)).length, 0);
  view(`
    <div class="card center">
      <div class="big-emoji">🃏</div>
      <div class="end-title">${due ? `${due} card${due === 1 ? "" : "s"} due` : "No cards due"}</div>
      <p class="muted">Cards you miss come back sooner; ones you know wait longer. ${seen} of ${total} cards started in the lessons you've reached.</p>
      <button class="btn primary" id="startCards">${due ? "Review due cards" : "Learn new cards"}</button>
    </div>
    <div class="card"><h3>How it works</h3><div class="muted small">Read the front, think of the answer, tap to flip. Then tell me how it went:
      <b>Again</b> (it comes back today), <b>Got it</b> (a few days), or <b>Easy</b> (much later). Each correct answer moves a card to a longer wait: 1, 3, 7, 14, then 30 days.</div></div>
  `);
  $("startCards").onclick = () => {
    const ids = buildCards();
    if (!ids.length) return toast("You've seen every card for the lessons you've reached. Nice!");
    startSession("cards", ids, "Flashcards");
  };
}

// ------------------------------------------------------------------ More
function renderMore() {
  setBar({ title: "More" }); setTab("more");
  const cp = codingProgress();
  view(`
    <button class="list-btn card" id="moreRanks" style="width:100%;padding:12px 16px;border:1px solid var(--border)"><span class="grow"><b>🏆 Ranks</b><div class="muted small">All ${PyGame.RANKS.length} ranks and how to earn XP</div></span><span class="chev">›</span></button>
    <div class="card"><h3>Daily goal</h3><div class="muted small" style="margin-bottom:10px">How many drills and cards to answer each day to keep your streak.</div>
      <div class="seg">${[5, 10, 15, 20].map(g => `<button data-goal="${g}" class="${ST.goal === g ? "on" : ""}">${g}</button>`).join("")}</div></div>
    <div class="card"><h3>⌨️ Coding lessons</h3><div class="muted small">The original lessons where you write and run real Python. ${cp.completed.length} of ${D.lessons.length} complete.</div>
      <a class="btn" style="margin-top:10px" href="code.html#${encodeURIComponent(hereId())}">Open coding lessons</a>
      <div class="muted small" style="margin-top:10px" id="pyoState">Checking offline coding…</div>
      <button class="btn ghost hidden" style="margin-top:8px" id="pyoGet">Download Python for offline coding (14 MB)</button></div>
    <div class="card"><h3>Your progress</h3><div class="muted small">Saved on this device. Export makes a backup file that also moves progress between devices (it includes coding lessons, drills, flashcards and your streak).</div>
      <div class="btns two" style="margin-top:10px"><button class="btn" id="exportBtn">⬇ Export</button><button class="btn" id="importBtn">⬆ Import</button></div>
      <button class="linkbtn" id="resetDrills" style="color:var(--bad)">Reset drill progress…</button></div>
    <div class="card"><h3>About</h3><div class="muted small" id="offlineNote">Works offline once loaded.</div>
      <div class="muted small" style="margin-top:6px">${Object.values(D.items).filter(i => i.type !== "card").length} drills and ${Object.values(D.items).filter(i => i.type === "card").length} flashcards. Every answer was checked by running it with real Python.</div></div>
  `);
  for (const b of document.querySelectorAll("[data-goal]")) b.onclick = () => { ST.goal = +b.dataset.goal; saveState(); renderMore(); };
  $("exportBtn").onclick = exportAll;
  $("moreRanks").onclick = () => go("#/ranks");
  $("importBtn").onclick = () => $("importFile").click();
  $("resetDrills").onclick = () => {
    if (!confirm("Erase drill, flashcard and streak progress on this device? Coding lessons are kept.\n\n(Tip: Export first to keep a backup.)")) return;
    ST = blankState(); saveState(); renderMore(); toast("Drill progress reset");
  };
  $("offlineNote").textContent = offline.note;
  checkPyodide();
}
async function checkPyodide() {
  const el = $("pyoState"), btn = $("pyoGet");
  if (!el || !META || !("caches" in window)) { if (el) el.textContent = ""; return; }
  try {
    const c = await caches.open(META.pyodide_cache);
    let have = 0;
    for (const a of META.pyodide_assets) if (await c.match(new URL(a, location.href).href)) have++;
    const ok = have === META.pyodide_assets.length;
    el.textContent = ok ? "✓ Coding lessons work offline on this device." : "Coding lessons need internet the first time (Python is downloaded when you open one).";
    btn.classList.toggle("hidden", ok || !navigator.serviceWorker || !navigator.serviceWorker.controller);
    btn.onclick = async () => {
      btn.disabled = true; btn.textContent = "Downloading…";
      try { for (const a of META.pyodide_assets) { const r = await fetch(a); if (!r.ok) throw new Error("HTTP " + r.status); await r.arrayBuffer(); } toast("Python saved for offline coding"); }
      catch (e) { toast("Download failed: " + e.message, true); }
      checkPyodide();
    };
  } catch (e) { el.textContent = ""; }
}

// ------------------------------------------------------------------ export / import
function exportAll() {
  const cp = codingProgress().raw;
  const data = { app: "PyLearn", format: 2, exported: new Date().toISOString(),
    completed: Array.isArray(cp.completed) ? cp.completed : [], code: cp.code && typeof cp.code === "object" ? cp.code : {}, last: cp.last || null, gates: Array.isArray(cp.gates) ? cp.gates : [], drills: ST, game: (() => { const g = game(); return { xp: g.xp, rank: g.rank.name, streak: g.streak, best: g.best }; })() };
  const blob = new Blob([JSON.stringify(data, null, 1)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "pylearn-progress-" + dayKey() + ".json";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  toast("Progress exported");
}
$("importFile").onchange = async (e) => {
  const f = e.target.files[0]; e.target.value = "";
  if (!f) return;
  try {
    const raw = JSON.parse(await f.text());
    if (!raw || typeof raw !== "object" || (!Array.isArray(raw.completed) && !raw.code && !raw.drills)) throw new Error("not a PyLearn progress file");
    const completed = Array.isArray(raw.completed) ? [...new Set(raw.completed.filter(id => typeof id === "string" && D.byId[id]))] : [];
    const code = {};
    if (raw.code && typeof raw.code === "object") for (const [k, v] of Object.entries(raw.code)) if (D.byId[k] && typeof v === "string") code[k] = v;
    const gates = Array.isArray(raw.gates) ? [...new Set(raw.gates.filter(id => typeof id === "string" && D.byId[id]))] : [];
    const drills = raw.drills ? normState(raw.drills) : null;
    const msg = `Replace your progress on this device with the file's?\n\nCoding: ${completed.length} lessons complete, code for ${Object.keys(code).length}.` +
      (drills ? `\nDrills: ${Object.keys(drills.items).length} practiced, ${Object.keys(drills.met).length} goal days.` : "\n(No drill progress in this file; yours is kept.)");
    if (!confirm(msg)) return;
    localStorage.setItem(PROG_KEY, JSON.stringify({ completed, code, last: D.byId[raw.last] ? raw.last : null, gates }));
    if (drills) { ST = drills; saveState(); }
    toast("Progress imported");
    route();
  } catch (err) { toast("Couldn't import that file: " + err.message, true); }
};

// ------------------------------------------------------------------ sessions
function startSession(kind, ids, title, lid) {
  if (!ids.length) return toast("Nothing to practice here yet.");
  if (lid && kind === "lesson") { ST.here = lid; saveState(); }
  SESSION = { kind, title, lid: lid || null, queue: ids.slice(), i: 0, first: {}, retry: new Set(), answered: false, total: ids.length };
  justMet = false;
  if (location.hash === "#/session") route(); else location.hash = "#/session";
}
function endSession() { SESSION = null; go("#/today"); }
function renderSession() {
  const S = SESSION;
  if (!S) return go("#/today");
  setBar({ title: S.title, session: true, back: () => { if (Object.keys(S.first).length === 0 || confirm("Stop this practice round? Your answers so far are saved.")) { const lid = S.lid, kind = S.kind; SESSION = null; go(lid && kind !== "daily" ? "#/lesson/" + lid : "#/today"); } } });
  if (S.i >= S.queue.length) return renderSessionEnd();
  $("sessProg").firstElementChild.style.width = (100 * S.i / S.queue.length) + "%";
  S.answered = false;
  const it = D.items[S.queue[S.i]];
  const lid = D.lessonOf[it.id];
  const retry = S.first[it.id] === false;
  const head = `<div class="tag">${TYPE_ICON[it.type]} ${TYPE_NAME[it.type]} <span class="lid">· ${lid} ${esc(D.byId[lid].title)}${retry ? " · try again" : ""}</span></div>`;
  ({ predict: drawPredict, fill: drawFill, bug: drawBug, order: drawOrder, card: drawCard })[it.type](it, head);
}
function shownChoices(it) { return shuffle([it.answer, ...it.wrong]); }
function feedback(ok, it, extra = "") {
  const fb = document.createElement("div");
  fb.className = "fb " + (ok ? "ok" : "bad");
  fb.innerHTML = `<h4>${ok ? "✅ " + PRAISE[Math.floor(Math.random() * PRAISE.length)] : "❌ Not quite"}</h4>${extra}<p>${inline(it.why)}</p>`;
  $("view").appendChild(fb);
  setTimeout(() => fb.scrollIntoView({ block: "nearest", behavior: "smooth" }), 60);
}
function record(it, ok, rating) {
  const S = SESSION;
  S.answered = true;
  const first = !(it.id in S.first);
  const xp = xpFor(it, ok, first);
  if (first) {
    S.first[it.id] = ok;
    grade(it.id, rating || (ok ? "good" : "again"));
    if (!ok && !S.retry.has(it.id)) { S.retry.add(it.id); S.queue.push(it.id); }   // missed: see it once more at the end
  }
  S.xp = (S.xp || 0) + xp;
  addXP(xp, document.querySelector(".fb h4") || $("streakChip"));
  if (justMet) { S.xp += PyGame.RULES.daily_bonus; addXP(PyGame.RULES.daily_bonus, $("streakChip")); }
  act(`<button class="btn ${ok ? "ok" : "primary"}" id="next">${S.i + 1 >= S.queue.length ? "Finish" : "Continue"}</button>`);
  $("next").onclick = nextItem;
  if (justMet) { justMet = false; setTimeout(() => toast(`🔥 Daily goal reached! ${streak()}-day streak · +${PyGame.RULES.daily_bonus} XP`), 400); }
}
function nextItem() { SESSION.i++; renderSession(); }

function drawPredict(it, head) {
  const ch = shownChoices(it);
  view(`${head}<pre class="code">${highlight(it.code)}</pre><div class="q">What does this print?</div>
    <div class="choices">${ch.map((c, k) => `<button class="choice" data-k="${k}" ${c === it.answer ? 'data-ok="1"' : ""}>${outText(c)}</button>`).join("")}</div>`);
  act('<button class="btn" disabled>Tap an answer</button>');
  for (const b of document.querySelectorAll(".choice")) b.onclick = () => {
    if (SESSION.answered) return;
    const ok = b.dataset.ok === "1";
    for (const x of document.querySelectorAll(".choice")) { x.disabled = true; if (x.dataset.ok === "1") x.classList.add("right"); else if (x !== b) x.classList.add("dim"); }
    if (!ok) b.classList.add("wrong");
    haptic(ok, ok ? b : b);
    feedback(ok, it);
    record(it, ok);
  };
}
function drawFill(it, head) {
  const [pre, post] = it.code.split("___");
  const codeHtml = (fill, cls) => highlight(pre) + `<span class="blank ${cls || ""}" id="blank">${fill ? esc(fill) : "\u00a0?\u00a0"}</span>` + highlight(post);
  const ch = shownChoices(it);
  view(`${head}<div class="q" style="margin-top:4px">${esc(it.ask)}</div><div class="target">${outText(it.target)}</div>
    <pre class="code" id="fillCode">${codeHtml()}</pre>
    <div class="choices" style="margin-top:14px">${ch.map((c, k) => `<button class="choice" data-k="${k}" ${c === it.answer ? 'data-ok="1"' : ""}>${esc(c)}</button>`).join("")}</div>`);
  act('<button class="btn" disabled>Tap a choice to fill the blank</button>');
  for (const b of document.querySelectorAll(".choice")) b.onclick = () => {
    if (SESSION.answered) return;
    const c = ch[+b.dataset.k], ok = c === it.answer;
    $("fillCode").innerHTML = codeHtml(it.answer, "right");
    for (const x of document.querySelectorAll(".choice")) { x.disabled = true; if (x.dataset.ok === "1") x.classList.add("right"); else if (x !== b) x.classList.add("dim"); }
    if (!ok) b.classList.add("wrong");
    haptic(ok, ok ? $("fillCode") : b);
    const extra = ok ? "" : `<p>With <code>${esc(c)}</code> it would print:</p><div class="codebox">${outText(it.wrong_out[c])}</div><p>The answer is <code>${esc(it.answer)}</code>.</p>`;
    feedback(ok, it, extra);
    record(it, ok);
  };
}
function drawBug(it, head) {
  const lines = it.code.split("\n");
  view(`${head}<div class="q" style="margin-top:4px">${esc(it.ask)}</div><div class="target">${outText(it.target)}</div>
    <div class="lines" id="bugLines">${lines.map((l, k) => `<button class="line" data-n="${k + 1}"><span class="ln">${k + 1}</span><span class="lc">${highlight(l) || " "}</span></button>`).join("")}</div>`);
  act('<button class="btn" disabled>Tap the line with the bug</button>');
  for (const b of document.querySelectorAll(".line")) b.onclick = () => {
    if (SESSION.answered) return;
    const n = +b.dataset.n, ok = n === it.line;
    const box = $("bugLines");
    for (const x of box.querySelectorAll(".line")) x.disabled = true;
    const bad = box.querySelector(`.line[data-n="${it.line}"]`);
    bad.classList.add(ok ? "right" : "struck");
    if (!ok) { b.classList.add("wrong"); bad.classList.add("struck"); }
    bad.insertAdjacentHTML("afterend", `<button class="line fixed" disabled><span class="ln">✓</span><span class="lc">${highlight(it.fix)}</span></button>`);
    haptic(ok, ok ? bad : b);
    const extra = `<p>${ok ? "" : `The bug is on line ${it.line}. `}As written, it prints:</p><div class="codebox">${outText(it.buggy)}</div><p>Fixed line ${it.line}: <code>${esc(it.fix.trim())}</code></p>`;
    feedback(ok, it, extra);
    record(it, ok);
  };
}
function drawOrder(it, head) {
  const lines = it.code.split("\n");
  let pool = shuffle(lines.map((_, k) => k));
  if (pool.every((k, i) => k === i) && lines.length > 1) pool.push(pool.shift());   // never start solved
  const placed = [];
  view(`${head}<div class="q" style="margin-top:4px">${esc(it.goal)}</div><div class="target">${outText(it.target)}</div>
    <div class="muted small" style="margin:0 2px 6px">Your program</div><div class="slot-area empty" id="prog"></div>
    <div class="muted small" style="margin:12px 2px 0">Lines <span style="opacity:.8">(· shows indentation)</span></div><div class="pool" id="pool"></div>`);
  const tile = (k, cls) => `<button class="tile ${cls}" data-k="${k}">${indentHtml(lines[k])}</button>`;
  function draw() {
    $("prog").innerHTML = placed.map(k => tile(k, "placed")).join("");
    $("prog").classList.toggle("empty", !placed.length);
    $("pool").innerHTML = pool.map(k => tile(k, placed.includes(k) ? "used" : "")).join("");
    for (const b of $("prog").querySelectorAll(".tile")) b.onclick = () => { if (SESSION.answered) return; placed.splice(placed.indexOf(+b.dataset.k), 1); draw(); };
    for (const b of $("pool").querySelectorAll(".tile:not(.used)")) b.onclick = () => { if (SESSION.answered) return; placed.push(+b.dataset.k); draw(); };
    const full = placed.length === lines.length;
    act(`<button class="btn ghost" id="clr" style="flex:0 0 30%" ${placed.length ? "" : "disabled"}>Clear</button><button class="btn primary" id="chk" ${full ? "" : "disabled"}>${full ? "Check" : `Place ${lines.length - placed.length} more`}</button>`);
    $("clr").onclick = () => { placed.length = 0; draw(); };
    $("chk").onclick = check;
  }
  function check() {
    const mine = placed.map(k => lines[k]).join("\n");
    const ok = it.orders.some(o => o.map(k => lines[k]).join("\n") === mine);
    const tiles = $("prog").querySelectorAll(".tile");
    tiles.forEach((t, i) => { t.disabled = true; t.classList.add(ok || lines[placed[i]] === lines[i] ? "right" : "wrong"); });
    haptic(ok, $("prog"));
    const extra = ok ? (it.orders.length > 1 ? "<p>(Some lines could go in more than one order. Any order that prints the same is accepted.)</p>" : "")
      : `<p>One right order:</p><pre class="codebox">${highlight(it.code)}</pre>`;
    feedback(ok, it, extra);
    record(it, ok);
  }
  draw();
}
function drawCard(it, head) {
  view(`${head}<div class="flash" id="flash"><div class="flash-in">
      <div class="face front"><small>Question</small><div>${inline(it.front)}</div><div class="hint">Tap to flip</div></div>
      <div class="face back"><small>Answer</small><div>${inline(it.back)}</div></div></div></div>`);
  act('<button class="btn primary" id="flip">Show answer</button>');
  let flipped = false;
  const flip = () => {
    if (flipped) return; flipped = true;
    $("flash").classList.add("flipped");
    act(`<button class="btn bad col" id="again">Again<span class="sub">missed it</span></button><button class="btn ok col" id="good">Got it<span class="sub">${INTERVALS[Math.min(5, ((rec(it.id) || {}).b || 0) + 1)]}d</span></button><button class="btn primary col" id="easy">Easy<span class="sub">${INTERVALS[Math.min(5, ((rec(it.id) || {}).b || 0) + 2)]}d</span></button>`);
    const rate = (r) => {
      if (SESSION.answered) return;
      const ok = r !== "again";
      haptic(ok, $("flash"));
      record(it, ok, r);
    };
    $("again").onclick = () => rate("again"); $("good").onclick = () => rate("good"); $("easy").onclick = () => rate("easy");
  };
  $("flash").onclick = flip; $("flip").onclick = flip;
}
function renderSessionEnd() {
  const S = SESSION;
  $("sessProg").firstElementChild.style.width = "100%";
  const ids = Object.keys(S.first), right = ids.filter(id => S.first[id]).length;
  const pct = ids.length ? right / ids.length : 0;
  const n = doneToday(), met = n >= ST.goal, s = streak();
  view(`<div class="big-emoji">${pct >= 0.9 ? "🏆" : pct >= 0.6 ? "💪" : "🌱"}</div>
    <div class="end-title">${pct >= 0.9 ? "Excellent!" : pct >= 0.6 ? "Good work!" : "Every miss is practice!"}</div>
    <p class="center muted">${right} of ${ids.length} right on the first try${S.retry.size ? `. The ${S.retry.size} you missed will come back sooner.` : "."}</p>
    <p class="center xp-earned">+${S.xp || 0} XP</p>
    <div class="card"><div class="stat"><div><b>${n}/${ST.goal}</b><span>today's goal</span></div><div><b>🔥 ${s}</b><span>day streak</span></div></div>
    ${met ? '<p class="center small" style="margin:10px 0 0">Daily goal reached. See you tomorrow!</p>' : `<p class="center small muted" style="margin:10px 0 0">${ST.goal - n} more to reach today's goal.</p>`}</div>`);
  const lid = S.lid;
  act(`${S.kind === "lesson" ? '<button class="btn" id="again">Practice again</button>' : ""}<button class="btn primary" id="done">Done</button>`);
  $("done").onclick = () => { SESSION = null; go(lid && S.kind !== "daily" ? "#/lesson/" + lid : "#/today"); };
  const ag = $("again"); if (ag) ag.onclick = () => startSession("lesson", buildLesson(lid), S.title, lid);
}

// ------------------------------------------------------------------ router
function route() {
  if (!ST) return;
  const h = location.hash || "#/today";
  const m = h.match(/^#\/(\w+)(?:\/(.+))?$/) || [];
  const page = m[1] || "today", arg = m[2] ? decodeURIComponent(m[2]) : null;
  if (page !== "session" && SESSION) SESSION = null;
  switch (page) {
    case "session": return renderSession();
    case "learn": return renderLearn();
    case "lesson": return renderLesson(arg);
    case "read": return renderRead(arg);
    case "cards": return renderCardsTab();
    case "more": return renderMore();
    case "ranks": return renderRanks();
    default: return renderToday();
  }
}
window.addEventListener("hashchange", route);
$("streakChip").onclick = () => { if (!SESSION) go("#/ranks"); };
window.addEventListener("storage", (e) => { if (e.key === DRILL_KEY && !SESSION) { ST = loadState(); route(); } });

// ------------------------------------------------------------------ offline (service worker)
const offline = { ready: false, note: "Offline mode needs https (or localhost)." };
if ("serviceWorker" in navigator && (location.protocol === "https:" || ["localhost", "127.0.0.1"].includes(location.hostname))) {
  const hadController = !!navigator.serviceWorker.controller;
  offline.note = "Saving for offline use…";
  navigator.serviceWorker.register("sw.js", { scope: "./" }).catch(err => { offline.note = "Offline mode unavailable: " + err.message; });
  navigator.serviceWorker.ready.then(() => { offline.ready = true; offline.note = "✓ Saved for offline use. Progress is stored on this device; Export makes a backup."; });
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadController) return;
    if (!SESSION) location.reload(); else toast("PyLearn was updated. It will use the new version next time you open it.");
  });
}

// ------------------------------------------------------------------ start
(async function init() {
  try {
    const [lr, dr] = await Promise.all([fetch("data/lessons.json"), fetch("data/drills.json")]);
    if (!lr.ok || !dr.ok) throw new Error("HTTP " + (lr.ok ? dr.status : lr.status));
    const ld = await lr.json(), dd = await dr.json();
    D.modules = ld.modules; D.lessons = ld.lessons; D.bank = dd.lessons;
    D.lessons.forEach((l, i) => { D.byId[l.id] = l; D.idx[l.id] = i; });
    for (const [lid, L] of Object.entries(D.bank)) for (const it of L.drills.concat(L.cards)) { D.items[it.id] = it; D.lessonOf[it.id] = lid; }
    ST = loadState();
    fetch("data/meta.json").then(r => r.json()).then(j => { META = j; }).catch(() => {});
    route();
  } catch (e) {
    $("view").innerHTML = '<div class="card">Could not load PyLearn (' + esc(String(e.message || e)) + "). Check your connection and reload.</div>";
  }
})();

// hooks for automated tests
window.PyLearn = {
  get state() { return ST; }, get session() { return SESSION; }, game, D, today, dayKey, keyOf, streak, buildDaily, hereId, unlocked, mastery, grade, offline,
  item: (id) => D.items[id], current: () => SESSION && D.items[SESSION.queue[SESSION.i]],
};
