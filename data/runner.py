"""PyLearn web runner: executes inside Pyodide (in a Web Worker).

It mirrors what pylearn.py does on the desktop with a subprocess:
  * every Run/Check gets a fresh folder holding the bundled sandbox files
    (engine.py, nn.py, lmdata.py, corpus.txt) as the working directory,
  * Check runs the *unchanged* app/harness.py (hidden tests, with_var, ...),
  * error explanations come from the *unchanged* app/errors.py.
Because a browser tab can't start a new Python process each time, we clean up
between runs instead: modules loaded from the run folder are forgotten,
builtins / cwd / sys.path / recursion limit are restored.
"""
import builtins
import gc
import json
import linecache
import os
import shutil
import sys
import tempfile
import types

_STATE = {}


def _load_module(name, src, filename):
    mod = types.ModuleType(name)
    mod.__file__ = filename
    exec(compile(src, filename, "exec"), mod.__dict__)
    sys.modules[name] = mod
    return mod


def setup(runtime_json, emit):
    """runtime_json: JSON text built by build.py. emit(kind, text) streams output to JS."""
    rt = json.loads(runtime_json)
    _STATE["files"] = rt["files"]
    _STATE["max_out"] = rt["max_out"]
    _STATE["check_recursion_limit"] = rt["check_recursion_limit"]
    _STATE["emit"] = emit
    _STATE["harness"] = _load_module("pylearn_harness", rt["harness"], "/pylearn/harness.py")
    _STATE["errors"] = _load_module("pylearn_errors", rt["errors"], "/pylearn/errors.py")
    _STATE["home"] = os.getcwd()
    _STATE["recursion"] = sys.getrecursionlimit()
    _STATE["builtins"] = dict(builtins.__dict__)
    _STATE["stdout"], _STATE["stderr"] = sys.stdout, sys.stderr
    os.makedirs("/tmp", exist_ok=True)


def _trim(s):
    m = _STATE["max_out"]
    return s if len(s) <= m else s[:m] + "\n... (output cut off: too long)"


class _Capture:
    """A sys.stdout/sys.stderr stand-in that keeps the text and (optionally) streams it."""
    encoding = "utf-8"
    errors = "strict"

    def __init__(self, kind, stream):
        self.kind, self.stream, self.parts, self.size = kind, stream, [], 0

    def write(self, s):
        if not isinstance(s, str):
            raise TypeError(f"write() argument must be str, not {type(s).__name__}")
        if self.size <= _STATE["max_out"] + 100:  # don't let a runaway loop flood memory
            self.parts.append(s)
            if self.stream and s:
                _STATE["emit"](self.kind, s)
        self.size += len(s)
        return len(s)

    def writelines(self, lines):
        for ln in lines:
            self.write(ln)

    def flush(self):
        pass

    def isatty(self):
        return False

    def readable(self):
        return False

    def writable(self):
        return True

    @property
    def text(self):
        return "".join(self.parts)


def _enter():
    d = tempfile.mkdtemp(prefix="pylearn_", dir="/tmp")
    for name, text in _STATE["files"].items():
        with open(os.path.join(d, name), "w", encoding="utf-8") as f:
            f.write(text)
    os.chdir(d)
    sys.path.insert(0, d)
    linecache.clearcache()  # same file names every run: never show stale source lines
    return d


def _leave(d):
    sys.stdout, sys.stderr = _STATE["stdout"], _STATE["stderr"]
    os.chdir(_STATE["home"])
    while d in sys.path:
        sys.path.remove(d)
    for name, mod in list(sys.modules.items()):
        f = getattr(mod, "__file__", None) or ""
        if f.startswith(d) or name == "your_code":
            del sys.modules[name]
    bd, snap = builtins.__dict__, _STATE["builtins"]
    for k in list(bd):
        if k not in snap:
            del bd[k]
    for k, v in snap.items():
        if bd.get(k) is not v:
            bd[k] = v
    sys.setrecursionlimit(_STATE["recursion"])
    shutil.rmtree(d, ignore_errors=True)
    gc.collect()


def run(code, timeout):
    """Like pylearn.run_code: run the learner's program, return stdout/stderr/returncode."""
    harness = _STATE["harness"]
    d = _enter()
    out, err = _Capture("out", True), _Capture("err", True)
    rc = 0
    try:
        with open(harness.USER_FILE, "w", encoding="utf-8") as f:  # so tracebacks can show the line
            f.write(code)
        sys.stdout, sys.stderr = out, err
        ns = {"__name__": "__main__", "__file__": harness.USER_FILE}
        try:
            exec(compile(code, harness.USER_FILE, "exec"), ns)
        except SystemExit as e:  # behave like `python your_code.py` exiting
            if e.code is None:
                rc = 0
            elif isinstance(e.code, int):
                rc = e.code
            else:
                err.write(str(e.code) + "\n")
                rc = 1
        except BaseException as e:  # noqa
            err.write(harness.user_traceback(e))
            rc = 1
    finally:
        _leave(d)
    res = {"stdout": _trim(out.text), "stderr": _trim(err.text), "returncode": rc, "timeout": False}
    res["explanation"] = _STATE["errors"].explain_error(res["stderr"], False, timeout)
    return json.dumps(res)


def check(code, test, timeout):
    """Like pylearn.check_code: run app/harness.py's main() in a fresh folder."""
    harness = _STATE["harness"]
    d = _enter()
    sink_out, sink_err = _Capture("out", False), _Capture("err", False)
    try:
        with open(harness.USER_FILE, "w", encoding="utf-8") as f:
            f.write(code)
        with open("_test.py", "w", encoding="utf-8") as f:
            f.write(test)
        sys.stdout, sys.stderr = sink_out, sink_err
        # harness.py's __main__ uses 10000; the browser's native stack is smaller, so the
        # build script picks a limit that still raises a clean RecursionError.
        sys.setrecursionlimit(_STATE["check_recursion_limit"])
        try:
            harness.main()
        except BaseException:  # noqa  (the harness itself crashed; handled below)
            pass
        try:
            with open("_result.json", encoding="utf-8") as f:
                res = json.load(f)
        except (OSError, ValueError):
            res = {"status": "error", "stdout": sink_out.text, "stderr": sink_err.text,
                   "message": "The checker stopped unexpectedly (did your code call exit() "
                              "or crash Python?)."}
    finally:
        _leave(d)
    res["stdout"] = _trim(res.get("stdout", ""))
    res["stderr"] = _trim(res.get("stderr", ""))
    res["timeout"] = False
    res["explanation"] = _STATE["errors"].explain_error(res["stderr"], False, timeout)
    return json.dumps(res)
