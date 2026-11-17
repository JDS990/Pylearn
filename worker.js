// PyLearn Python worker: loads Pyodide (self-hosted in ./pyodide/) and runs
// learner code off the main thread. The page enforces time limits by
// terminating this worker and starting a fresh one.
import { loadPyodide } from "./pyodide/pyodide.mjs";

let runner = null;
let currentId = null;

const ready = (async () => {
  const base = new URL("./", import.meta.url);
  const py = await loadPyodide({
    indexURL: new URL("pyodide/", base).href,
    stdout: () => {}, stderr: () => {},   // learner output is captured in Python
    packages: [],
  });
  py.setStdin({ stdin: () => null });     // input() behaves like the desktop app: EOFError
  const [rt, src] = await Promise.all([
    fetch(new URL("data/runtime.json", base)).then(r => { if (!r.ok) throw new Error("runtime.json " + r.status); return r.text(); }),
    fetch(new URL("data/runner.py", base)).then(r => { if (!r.ok) throw new Error("runner.py " + r.status); return r.text(); }),
  ]);
  py.globals.set("_runner_src", src);
  const mod = py.runPython(`
import types, sys
_m = types.ModuleType("pylearn_runner"); _m.__file__ = "/pylearn/runner.py"
sys.modules["pylearn_runner"] = _m
exec(compile(_runner_src, "/pylearn/runner.py", "exec"), _m.__dict__)
del _runner_src
_m`);
  mod.setup(rt, (kind, text) => postMessage({ type: "stream", id: currentId, kind, text }));
  runner = mod;
  return py;
})();

ready.then(py => postMessage({ type: "ready", version: py.version }),
           err => postMessage({ type: "fatal", error: String(err && err.stack || err) }));

self.onmessage = async (e) => {
  const job = e.data;
  try { await ready; } catch (err) { return; }
  currentId = job.id;
  postMessage({ type: "start", id: job.id });
  try {
    const json = job.kind === "check"
      ? runner.check(job.code, job.test, job.timeout)
      : runner.run(job.code, job.timeout);
    postMessage({ type: "result", id: job.id, result: JSON.parse(json) });
  } catch (err) {
    // Only reached if Python itself broke (e.g. the WebAssembly stack overflowed).
    postMessage({ type: "crash", id: job.id, error: String(err && err.message || err) });
  }
};
