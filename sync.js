"use strict";
/* PyLearn sync (iPhone side): two-way progress sync with desktop PyLearn through one JSON
   file ("progress.json") in a PRIVATE GitHub repo, via the GitHub Contents API
   (GET content + sha, PUT with that sha; 409/422 = someone else saved: re-pull, merge, retry).
   Same merge rules as app/sync.py on the desktop:
     completed lessons, read-the-task gates -> union        saved code, last lesson -> newest edit wins
     goal-met days -> union (streak recomputed)             drill/card items -> newest review wins
     drill XP -> per device, max                            Muscle Memory "open all" -> either
   The token stays in this browser's storage ("pylearn.sync.v1"); it is never logged or shown again. */
const PySync = (() => {
  const CFG_KEY = "pylearn.sync.v1", DRILL_KEY = "pylearn.drills.v1", PROG_KEY = "pylearn.progress.v1";
  const SCHEMA = 1, FILE = "progress.json", API = "https://api.github.com";
  const DEFAULT_REPO = "JDS990/pylearn-progress", TOKEN_URL = "https://github.com/settings/personal-access-tokens/new";
  const RE_DATE = /^\d{4}-\d\d-\d\d$/, RE_REPO = /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/;
  const RE_TOKEN = /^(github_pat_|ghp_|gho_|ghu_)[A-Za-z0-9_]{20,255}$/;
  const ITEM_KEYS = [["b", 5], ["due", 1e6], ["n", 1e7], ["ok", 1e7], ["lapses", 1e7], ["last", 1e6], ["t", 1e14]];

  // ---------------------------------------------------------------- document + merge (mirrors app/sync.py)
  const int = (x, lo = 0, hi = 1e14) => (typeof x === "number" && isFinite(x) ? Math.min(hi, Math.max(lo, Math.trunc(x))) : lo);
  const strs = (x) => Array.isArray(x) ? [...new Set(x.filter(s => typeof s === "string" && s.length > 0 && s.length < 200))].sort(cmp) : [];
  const dateOk = (k) => typeof k === "string" && RE_DATE.test(k) && !isNaN(Date.parse(k + "T00:00:00Z")) && new Date(k + "T00:00:00Z").toISOString().slice(0, 10) === k;
  function cmp(a, b) { return a < b ? -1 : a > b ? 1 : 0; }
  function blankDoc() { return { app: "PyLearn", schema: SCHEMA, completed: [], gates: [], code: {}, last: { id: null, t: 0 }, days: [], best: 0, answers: {}, items: {}, drill_xp: {}, mm_all: false }; }
  function normItem(v) { const it = {}; for (const [k, hi] of ITEM_KEYS) it[k] = int(v[k], 0, hi); if (!it.t) it.t = it.last * 86400000; return it; }
  function normDoc(d) {
    const o = blankDoc();
    if (!d || typeof d !== "object") return o;
    o.schema = int(d.schema, 1, 1e6);
    o.completed = strs(d.completed); o.gates = strs(d.gates);
    if (d.code && typeof d.code === "object") for (const [k, v] of Object.entries(d.code)) if (v && typeof v === "object" && typeof v.c === "string") o.code[k] = { c: v.c, t: int(v.t) };
    if (d.last && typeof d.last === "object" && typeof d.last.id === "string") o.last = { id: d.last.id, t: int(d.last.t) };
    o.days = Array.isArray(d.days) ? [...new Set(d.days.filter(dateOk))].sort(cmp) : [];
    o.best = int(d.best, 0, 1e5);
    if (d.answers && typeof d.answers === "object") for (const [k, v] of Object.entries(d.answers)) if (dateOk(k) && int(v, 0, 1e6) > 0) o.answers[k] = int(v, 0, 1e6);
    if (d.items && typeof d.items === "object") for (const [k, v] of Object.entries(d.items)) if (v && typeof v === "object") o.items[k] = normItem(v);
    if (d.drill_xp && typeof d.drill_xp === "object") for (const [k, v] of Object.entries(d.drill_xp)) if (k.length > 0 && k.length < 60) o.drill_xp[k] = int(v);
    o.mm_all = d.mm_all === true;
    return o;
  }
  // canonical JSON (sorted keys), used to compare documents
  function canon(x) {
    if (Array.isArray(x)) return "[" + x.map(canon).join(",") + "]";
    if (x && typeof x === "object") return "{" + Object.keys(x).sort(cmp).map(k => JSON.stringify(k) + ":" + canon(x[k])).join(",") + "}";
    return JSON.stringify(x);
  }
  const same = (a, b) => canon(normDoc(a)) === canon(normDoc(b));
  function longestRun(days) {
    let best = 0, run = 0, prev = null;
    for (const k of [...days].sort(cmp)) { const n = Date.parse(k + "T00:00:00Z") / 864e5; run = prev !== null && n - prev === 1 ? run + 1 : 1; best = Math.max(best, run); prev = n; }
    return best;
  }
  // deterministic winner, identical on every device: compare keys left to right
  function pick(a, b, keys) { for (const k of keys) { if (a[k] > b[k]) return a; if (a[k] < b[k]) return b; } return a; }
  const union = (a, b) => [...new Set([...a, ...b])].sort(cmp);
  function merge(x, y) {
    const a = normDoc(x), b = normDoc(y), m = blankDoc();
    m.completed = union(a.completed, b.completed); m.gates = union(a.gates, b.gates);
    for (const k of union(Object.keys(a.code), Object.keys(b.code))) {
      const ca = a.code[k], cb = b.code[k];
      m.code[k] = !cb ? ca : !ca ? cb : pick(ca, cb, ["t", "c"]);
    }
    m.last = b.last.id === null ? a.last : a.last.id === null ? b.last : pick(a.last, b.last, ["t", "id"]);
    m.days = union(a.days, b.days);
    m.best = Math.max(a.best, b.best, longestRun(m.days));
    for (const k of union(Object.keys(a.answers), Object.keys(b.answers))) m.answers[k] = Math.max(a.answers[k] || 0, b.answers[k] || 0);
    for (const k of union(Object.keys(a.items), Object.keys(b.items))) {
      const ia = a.items[k], ib = b.items[k];
      m.items[k] = !ib ? ia : !ia ? ib : pick(ia, ib, ["t", "n", "b", "due", "ok", "lapses", "last"]);
    }
    for (const k of union(Object.keys(a.drill_xp), Object.keys(b.drill_xp))) m.drill_xp[k] = Math.max(a.drill_xp[k] || 0, b.drill_xp[k] || 0);
    m.mm_all = a.mm_all || b.mm_all;
    return m;
  }

  // ---------------------------------------------------------------- this device's storage <-> document
  const read = (k) => { try { const v = JSON.parse(localStorage.getItem(k) || "null"); return v && typeof v === "object" ? v : null; } catch (e) { return null; } };
  const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } };
  function drillState() {
    const st = read(DRILL_KEY) || { v: 1, items: {}, days: {}, met: {}, goal: 10, here: null, best: 0, mmAll: false };
    for (const f of ["items", "days", "met"]) if (!st[f] || typeof st[f] !== "object") st[f] = {};
    const hadDev = typeof st.dev === "string";
    PyGame.normXp(st);            // also gives this install its device id ("phone-…")
    if (!hadDev) write(DRILL_KEY, st);   // keep the id from now on, so its XP is never counted twice
    return st;
  }
  function docFromLocal() {
    const p = read(PROG_KEY) || {}, st = drillState(), d = blankDoc();
    d.completed = strs(p.completed); d.gates = strs(p.gates);
    const ct = p.code_t && typeof p.code_t === "object" ? p.code_t : {};
    if (p.code && typeof p.code === "object") for (const [k, v] of Object.entries(p.code)) if (typeof v === "string") d.code[k] = { c: v, t: int(ct[k]) };
    if (typeof p.last === "string") d.last = { id: p.last, t: int(p.last_t) };
    d.days = Object.keys(st.met).filter(k => dateOk(k) && st.met[k]);
    d.best = int(st.best, 0, 1e5);
    for (const [k, v] of Object.entries(st.days)) if (dateOk(k) && v > 0) d.answers[k] = int(v, 0, 1e6);
    d.items = st.items;
    d.drill_xp = Object.assign({}, st.peerXp || {}, { [st.dev]: int(st.dxp) });
    d.mm_all = st.mmAll === true;
    return normDoc(d);
  }
  // Bring the merged document into this device's storage. Only adds, or takes newer edits.
  function applyLocal(m) {
    const p0 = read(PROG_KEY) || {}, st0 = read(DRILL_KEY);
    const p = JSON.parse(JSON.stringify(p0)), st = drillState();
    for (const f of ["completed", "gates"]) { p[f] = Array.isArray(p[f]) ? p[f] : []; for (const id of m[f]) if (!p[f].includes(id)) p[f].push(id); }
    p.code = p.code && typeof p.code === "object" ? p.code : {}; p.code_t = p.code_t && typeof p.code_t === "object" ? p.code_t : {};
    for (const [k, v] of Object.entries(m.code)) if (!(k in p.code) || v.t > int(p.code_t[k])) { p.code[k] = v.c; p.code_t[k] = v.t; }
    let lastMoved = false;
    if (m.last.id && m.last.t > int(p.last_t)) { lastMoved = p.last !== m.last.id; p.last = m.last.id; p.last_t = m.last.t; }
    if (!("last" in p)) p.last = null;
    for (const k of m.days) st.met[k] = 1;
    for (const [k, v] of Object.entries(m.answers)) st.days[k] = Math.max(st.days[k] || 0, v);
    for (const [k, v] of Object.entries(m.items)) st.items[k] = v;
    st.best = Math.max(int(st.best), m.best);
    st.dxp = Math.max(int(st.dxp), m.drill_xp[st.dev] || 0);
    st.peerXp = {}; for (const [k, v] of Object.entries(m.drill_xp)) if (k !== st.dev) st.peerXp[k] = v;
    if (m.mm_all) st.mmAll = true;
    if (lastMoved) st.here = null;           // follow the lesson you were on most recently (maybe on the desktop)
    if (typeof PyGame !== "undefined") PyGame.normXp(st);
    const changed = canon(p) !== canon(p0) || canon(st) !== canon(st0 || {});
    if (changed) { write(PROG_KEY, p); write(DRILL_KEY, st); }
    return changed;
  }

  // ---------------------------------------------------------------- settings + status
  function cfg() { return read(CFG_KEY) || {}; }
  function setCfg(patch) { const c = Object.assign(cfg(), patch); write(CFG_KEY, c); return c; }
  const connected = () => { const c = cfg(); return !!(c.token && c.repo); };
  function ago(ms) {
    const s = Math.max(0, (Date.now() - ms) / 1000);
    return s < 45 ? "just now" : s < 3600 ? Math.round(s / 60) + " min ago" : s < 86400 ? Math.round(s / 3600) + " h ago" : Math.round(s / 86400) + " d ago";
  }
  function status() {
    const c = cfg();
    if (!connected()) return { connected: false, cls: "", text: "Sync with desktop: off", repo: c.repo || DEFAULT_REPO };
    const base = { connected: true, repo: c.repo, last: c.last || 0, message: c.msg || "" };
    if (busy) return Object.assign(base, { cls: "wait", text: "Syncing…" });
    if (c.state === "offline") return Object.assign(base, { cls: "wait", text: "Offline: will sync" });
    if (c.state === "error") return Object.assign(base, { cls: "bad", text: "Sync problem: tap to fix" });
    if (c.pending || !c.last) return Object.assign(base, { cls: "wait", text: "Changes waiting to sync" });
    return Object.assign(base, { cls: "ok", text: "Synced " + ago(c.last) });
  }

  // ---------------------------------------------------------------- GitHub
  class SyncError extends Error { constructor(kind, msg) { super(msg); this.kind = kind; } }
  async function gh(method, path, token, body) {
    let r;
    try {
      r = await fetch(API + path, { method, cache: "no-store", headers: Object.assign({ Accept: "application/vnd.github+json", Authorization: "Bearer " + token },
        body ? { "Content-Type": "application/json" } : {}), body: body ? JSON.stringify(body) : undefined });
    } catch (e) { throw new SyncError("offline", "Offline: will sync when the internet is back."); }
    let data = null; try { data = await r.json(); } catch (e) {}
    return { status: r.status, data };
  }
  function fail(code, what) {
    if (code === 401) return new SyncError("auth", "GitHub rejected the token (wrong, revoked or expired). Make a new one and paste it here.");
    if (code === 403) return new SyncError("forbidden", `The token isn't allowed to ${what}. Give it Contents: Read and write on the repository.`);
    if (code === 404) return new SyncError("notfound", "Can't see that repository. Check its name, and that the token was given access to it.");
    if (code === 409 || code === 422) return new SyncError("conflict", "Someone else saved at the same moment.");
    if (code === 429 || code >= 500) return new SyncError("offline", "GitHub is busy right now: will try again shortly.");
    return new SyncError("http", `GitHub answered ${code} while trying to ${what}.`);
  }
  const b64enc = (s) => { const b = new TextEncoder().encode(s); let t = ""; for (let i = 0; i < b.length; i += 0x8000) t += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(t); };
  const b64dec = (s) => new TextDecoder().decode(Uint8Array.from(atob(String(s).replace(/\s/g, "")), c => c.charCodeAt(0)));
  async function checkRepo(repo, token) {
    if (!RE_REPO.test(repo || "")) throw new SyncError("config", "The repository should look like owner/name, e.g. " + DEFAULT_REPO);
    let r = await gh("GET", `/repos/${repo}`, token);
    if (r.status !== 200) throw fail(r.status, "read the repository");
    if (!r.data || !r.data.private) throw new SyncError("public", "That repository is PUBLIC. Progress (and your code) must go in a private repository.");
    r = await gh("GET", `/repos/${repo}/contents/${FILE}`, token);
    if (r.status !== 200 && r.status !== 404) throw fail(r.status, "read files in the repository");
    return `Connected to ${repo} (private).` + (r.status === 200 ? "" : " The progress file will be created on the first sync.");
  }
  async function getRemote(repo, token) {
    const r = await gh("GET", `/repos/${repo}/contents/${FILE}`, token);
    if (r.status === 404) {
      const r2 = await gh("GET", `/repos/${repo}`, token);
      if (r2.status === 200) return { doc: blankDoc(), sha: null };
      throw fail(r2.status, "read the repository");
    }
    if (r.status !== 200) throw fail(r.status, "read the progress file");
    let doc = null; try { doc = JSON.parse(b64dec(r.data.content || "")); } catch (e) {}
    if (doc && int(doc.schema, 1) > SCHEMA) throw new SyncError("newer", "The synced progress was saved by a newer PyLearn. Reload the app to update it.");
    return { doc: normDoc(doc), sha: r.data.sha };
  }
  async function putRemote(repo, token, doc, sha, dev) {
    const full = Object.assign({}, doc, { updated: new Date().toISOString().slice(0, 19) + "+00:00", by: dev });
    const text = JSON.stringify(JSON.parse(canon(full)), null, 1) + "\n";
    const body = { message: `PyLearn sync (${dev})`, content: b64enc(text) };
    if (sha) body.sha = sha;
    const r = await gh("PUT", `/repos/${repo}/contents/${FILE}`, token, body);
    if (r.status !== 200 && r.status !== 201) throw fail(r.status, "save the progress file");
  }

  // ---------------------------------------------------------------- engine
  let busy = false, again = false, timer = null, retryMs = 15000, onChange = () => {}, onStatus = () => {}, lastTry = 0;
  async function cycle() {
    if (!connected()) return null;
    if (busy) { again = true; return null; }
    busy = true; lastTry = Date.now(); onStatus(status());
    const c = cfg();
    let changed = false;
    try {
      for (let attempt = 0; ; attempt++) {
        const { doc: remote, sha } = await getRemote(c.repo, c.token);
        const local = docFromLocal();
        const merged = merge(remote, local);
        if (applyLocal(merged)) changed = true;
        if (same(merged, remote) && sha) break;
        try { await putRemote(c.repo, c.token, merged, sha, drillState().dev); break; }
        catch (e) { if (e.kind !== "conflict" || attempt >= 4) throw e; await new Promise(r => setTimeout(r, 300)); }
      }
      setCfg({ last: Date.now(), pending: false, state: "ok", msg: "" });
      retryMs = 15000;
    } catch (e) {
      const soft = e.kind === "offline" || e.kind === "conflict";
      setCfg({ pending: true, state: soft ? "offline" : "error", msg: e.message || String(e) });
      if (soft) { clearTimeout(timer); timer = setTimeout(cycle, retryMs); retryMs = Math.min(300000, retryMs * 2); }   // quiet retry
    } finally {
      busy = false;
      if (changed) { try { onChange(); } catch (e) { console.error(e); } }
      onStatus(status());
      if (again) { again = false; setTimeout(cycle, 50); }
    }
    return { changed, status: status() };
  }
  // Local progress changed: push after a quiet moment (debounced).
  function dirty(delay = 8000) {
    if (!connected()) return;
    if (!cfg().pending) setCfg({ pending: true });
    clearTimeout(timer); timer = setTimeout(cycle, delay);
  }
  const flush = () => { if (connected()) { clearTimeout(timer); return cycle(); } return Promise.resolve(null); };
  function init(opts) {
    onChange = opts.onChange || onChange; onStatus = opts.onStatus || onStatus;
    if (!connected()) return;
    cycle();                                          // pull on open
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") { if (Date.now() - lastTry > 15000) cycle(); }   // back in the foreground: pull
      else if (cfg().pending) flush();                                                             // leaving: push what's waiting
    });
    window.addEventListener("online", () => cycle());
    setInterval(() => { if (document.visibilityState === "visible") onStatus(status()); }, 30000);
  }
  async function connect(repo, token) {
    repo = (repo || DEFAULT_REPO).trim(); token = (token || "").trim();
    if (!RE_TOKEN.test(token)) throw new SyncError("config", "That doesn't look like a GitHub token (it should start with github_pat_).");
    const msg = await checkRepo(repo, token);
    setCfg({ repo, token, last: 0, pending: true, state: "ok", msg: "" });
    return msg;
  }
  async function test() { const c = cfg(); if (!connected()) throw new SyncError("config", "Sync isn't set up yet."); return checkRepo(c.repo, c.token); }
  function disconnect() { clearTimeout(timer); try { localStorage.removeItem(CFG_KEY); } catch (e) {} onStatus(status()); }

  return { SCHEMA, DEFAULT_REPO, TOKEN_URL, normDoc, merge, same, canon, longestRun, docFromLocal, applyLocal, status, connected,
    cycle, dirty, flush, init, connect, test, disconnect, SyncError, b64enc, b64dec };
})();
