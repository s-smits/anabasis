#!/usr/bin/env python3
"""Measure the files a /simplify pass touches, so the pass argues from counts.

  measure.py <files...>                 functions by branch count and length, exports by caller count
  measure.py --diff <scope.diff>        the source files in that diff (from scope.sh), and the
                                        names the diff introduces
  measure.py --base <ref> <files...>    the same measurement on <ref>'s version, printed as
                                        before -> after per function (run after editing)
  --diff <d> --base <ref>               both, plus the budget ledger against <ref>
  -C <dir>                              measure another worktree; the ledger reads the after-state
                                        from its files, so check out the commit being measured
  --complexity N  --function-lines N  --file-lines N
                                        ceilings to flag (defaults 21, 80, 600: what this
                                        operator's repositories refuse)

Every --diff run ends with two sections the operator's budgets are argued from:

  budget   production and test nonblank lines net, new and deleted files, new function names net
           of removed ones, and per import source the names added (`../meta/filesystem.ts +1
           existsSync`). With --base the ledger compares whole files, so multi-line imports and
           moved functions count correctly; with --diff alone it reads the diff lines.
  repeats  added three-line windows that already occur elsewhere in tracked source once strings
           and numbers are normalised: leads for the "already in this codebase?" rung.

Branch counts, function lengths and file lengths come from oxlint's `complexity`,
`max-lines-per-function` and `max-lines` rules with the maximum set to 0, so every function is
reported. Needs `node_modules/oxlint/bin/oxlint` under the worktree and `bun` on PATH; without
them only line counts and callers print. Callers are counted with git grep as tracked files other
than the defining one that mention the exported name as a whole word: 0 means nothing uses the
export, 1 means one caller, which is where a wrapper with no rule of its own usually sits.
"""
import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

SRC = re.compile(r"\.(ts|tsx|mts|cts|js|mjs|cjs|jsx)$")
EXPORT = re.compile(r"^export\s+(?:async\s+)?(?:function\*?|const|let|class|type|interface|enum)\s+([A-Za-z_$][\w$]*)", re.M)
ADDED_NAME = re.compile(r"^\+\s*(?:export\s+)?(?:async\s+)?(?:function\*?|class|type|interface|enum)\s+([A-Za-z_$][\w$]*)|^\+(?:export\s+)?(?:const|let)\s+([A-Za-z_$][\w$]*)\s*[:=]")


def run(cmd, cwd=None):
    return subprocess.run(cmd, cwd=cwd, capture_output=True, text=True)


def nonblank(text):
    return sum(1 for line in text.splitlines() if line.strip())


def oxlint_measure(root, files, binary_root=None):
    """{file: {"lines": n, "functions": [(name, line, complexity, length)]}} or None without oxlint."""
    binary = os.path.join(binary_root or root, "node_modules", "oxlint", "bin", "oxlint")
    if not (os.path.exists(binary) and shutil.which("bun")):
        return None
    cfg = {"rules": {
        "complexity": ["error", {"max": 0}],
        "max-lines-per-function": ["error", {"max": 0, "skipBlankLines": True, "skipComments": True}],
        "max-lines": ["error", {"max": 0, "skipBlankLines": True, "skipComments": True}],
    }}
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, dir=root) as fh:
        json.dump(cfg, fh)
        cfg_path = fh.name
    # oxlint under bun drops output past 64 KiB when stdout is a pipe, so it writes to a file.
    out_path = cfg_path + ".out"
    try:
        with open(out_path, "w") as sink:
            subprocess.run(["bun", binary, "-c", cfg_path, "--format", "json", *files], cwd=root, stdout=sink, stderr=subprocess.DEVNULL)
        out = open(out_path).read()
    finally:
        for p in (cfg_path, out_path):
            if os.path.exists(p):
                os.remove(p)
    try:
        payload = json.loads(out)
    except json.JSONDecodeError:
        return None
    diagnostics = payload.get("diagnostics", payload) if isinstance(payload, dict) else payload
    result = {f: {"lines": None, "functions": {}} for f in files}
    for d in diagnostics:
        path = d.get("filename", "")
        rel = os.path.relpath(path, root) if os.path.isabs(path) else path
        entry = result.get(rel) or result.get(path)
        if entry is None:
            continue
        msg = d.get("message", "")
        labels = d.get("labels") or [{}]
        line = (labels[0].get("span") or {}).get("line")
        code = d.get("code", "")
        if code == "eslint(max-lines)":
            m = re.search(r"\((\d+)\)", msg)
            entry["lines"] = int(m.group(1)) if m else None
            continue
        named = re.search(r"`([^`]+)`", msg)
        name = named.group(1) if named else "(anonymous)"
        key = (name, line)
        fn = entry["functions"].setdefault(key, [None, None])
        if code == "eslint(complexity)":
            m = re.search(r"complexity of (\d+)", msg)
            fn[0] = int(m.group(1)) if m else None
        elif code == "eslint(max-lines-per-function)":
            m = re.search(r"\((\d+)\)", msg)
            fn[1] = int(m.group(1)) if m else None
    return result


def exports_of(text):
    return sorted(set(EXPORT.findall(text)))


def caller_count(root, name, defining):
    """Tracked source files other than `defining` mentioning `name` as a whole word."""
    cmd = ["git", "grep", "-l", "-w", name, "--", "*.ts", "*.tsx", "*.mts", "*.cts", "*.js", "*.mjs", "*.cjs", "*.jsx"]
    out = run(cmd, cwd=root).stdout.split("\n")
    hits = {os.path.normpath(p) for p in out if p}
    hits.discard(os.path.normpath(defining))
    return len(hits)


def base_snapshot(root, ref, files):
    """Copy <ref>'s version of each file into a temp tree beside node_modules, for oxlint."""
    tmp = tempfile.mkdtemp(prefix=".simplify-base-", dir=root)
    present = []
    for f in files:
        show = run(["git", "show", f"{ref}:{f}"], cwd=root)
        if show.returncode != 0:
            continue
        dest = os.path.join(tmp, f)
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        with open(dest, "w") as fh:
            fh.write(show.stdout)
        present.append(f)
    return tmp, present


def diff_files_and_names(path):
    files, names = [], []
    for line in open(path, errors="replace"):
        if line.startswith("diff --git"):
            m = re.search(r" b/(.+)$", line.rstrip("\n"))
            if m and SRC.search(m.group(1)) and "node_modules" not in m.group(1):
                files.append(m.group(1))
        elif line.startswith("+") and not line.startswith("+++"):
            m = ADDED_NAME.match(line.rstrip("\n"))
            if m:
                names.append(m.group(1) or m.group(2))
    return files, sorted(set(names))


TEST_PATH = re.compile(r"(^|/)(test|tests|__tests__|fixtures)/|\.(test|spec)\.")
IMPORT_STMT = re.compile(r"^\s*(?:import|export)\s+(?:type\s+)?(\{[^}]*\}|[^;\n{]*?)\s+from\s+[\"']([^\"']+)[\"']", re.M)
FUNC_NAME = re.compile(r"^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\*?\s+([A-Za-z_$][\w$]*)"
                       r"|^\s*(?:export\s+)?(?:const|let)\s+([A-Za-z_$][\w$]*)\s*(?::[^=\n]+)?=\s*(?:async\s+)?"
                       r"(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*(?::[^=\n]+)?=>", re.M)


def imported_names(text):
    """{specifier: {names}} for static imports and re-exports, multi-line braces included."""
    out = {}
    for clause, spec in IMPORT_STMT.findall(text):
        for part in re.split(r"[,{}]", clause):
            part = re.sub(r"^\s*type\s+", "", part).strip()
            if part:
                out.setdefault(spec, set()).add(part.split(" as ")[0].strip())
    return out


def function_names(text):
    return {a or b for a, b in FUNC_NAME.findall(text)}


def diff_sections(path):
    """[[file, status, [(new_lineno, text)], [removed text]]] from a unified diff."""
    rows, cur, new_no = [], None, 0
    for raw in open(path, errors="replace"):
        line = raw.rstrip("\n")
        if line.startswith("diff --git"):
            m = re.search(r" b/(.+)$", line)
            cur = [m.group(1) if m else "?", "modified", [], []]
            rows.append(cur)
        elif cur is None or line.startswith(("+++", "---", "\\")):
            continue
        elif line.startswith("new file mode"):
            cur[1] = "new"
        elif line.startswith("deleted file mode"):
            cur[1] = "deleted"
        elif line.startswith("@@"):
            m = re.search(r"\+(\d+)", line)
            new_no = int(m.group(1)) if m else 0
        elif line.startswith("+"):
            cur[2].append((new_no, line[1:]))
            new_no += 1
        elif line.startswith("-"):
            cur[3].append(line[1:])
        else:
            new_no += 1
    return rows


def budget(root, sections, base):
    """Print the ledger that net-LoC, one-new-function and +1-import budgets are read from."""
    tally = {"prod": [0, 0], "test": [0, 0]}
    new_files, gone_files, new_fns, gone_fns, imports = [], [], {}, set(), []
    for f, status, added, removed in sections:
        if not SRC.search(f) or "node_modules" in f:
            continue
        kind = "test" if TEST_PATH.search(f) else "prod"
        {"new": new_files, "deleted": gone_files}.get(status, []).append(f)
        if base:
            path = os.path.join(root, f)
            after = open(path, errors="replace").read() if os.path.exists(path) else ""
            shown = run(["git", "show", f"{base}:{f}"], cwd=root)
            before = shown.stdout if shown.returncode == 0 else ""
        else:
            before, after = "\n".join(removed), "\n".join(t for _n, t in added)
        tally[kind][0] += nonblank(after) if not base else max(0, nonblank(after) - nonblank(before))
        tally[kind][1] += nonblank(before) if not base else max(0, nonblank(before) - nonblank(after))
        if kind == "test":
            continue
        fb, fa = function_names(before), function_names(after)
        for n in fa - fb:
            new_fns[n] = f
        gone_fns |= fb - fa
        ib, ia = imported_names(before), imported_names(after)
        for spec in sorted(ia):
            grew, shrank = sorted(ia[spec] - ib.get(spec, set())), sorted(ib.get(spec, set()) - ia[spec])
            if grew:
                imports.append(f"{f}: {spec} +{len(grew)} {' '.join(grew)}"
                               + (f", -{len(shrank)} {' '.join(shrank)}" if shrank else ""))
    moved = set(new_fns) & gone_fns
    fresh = sorted(f"{n} ({p})" for n, p in new_fns.items() if n not in moved)
    print("budget " + (f"against {base}:" if base else "from diff lines (add --base <ref> for whole files):"))
    for kind, (a, r) in tally.items():
        print(f"  {kind} nonblank: +{a} -{r}, net {a - r:+d}")
    print(f"  files: {len(new_files)} new{' ' + ' '.join(new_files) if new_files else ''}, {len(gone_files)} deleted")
    print(f"  new production functions: {len(fresh)}{' ' + ', '.join(fresh) if fresh else ''}"
          + (f"; moved or re-declared: {', '.join(sorted(moved))}" if moved else "")
          + (f"; removed: {len(gone_fns - moved)}" if gone_fns - moved else ""))
    for row in imports:
        print("  imports " + row)


WINDOW = 3


def normalise(line):
    s = re.sub(r"\"(?:[^\"\\]|\\.)*\"|'(?:[^'\\]|\\.)*'|`[^`]*`", "S", line.strip())
    s = re.sub(r"\s+", " ", re.sub(r"\b\d+(?:\.\d+)?\b", "0", s))
    return "" if len(s) < 12 or s.startswith(("//", "*", "/*", "import ", "export {")) else s


def windows(numbered):
    """Three-line windows over normalised code lines, skipping blank and comment lines."""
    code = [(n, normalise(t)) for n, t in numbered]
    code = [(n, s) for n, s in code if s]
    for i in range(len(code) - WINDOW + 1):
        chunk = code[i:i + WINDOW]
        if chunk[-1][0] - chunk[0][0] <= 2 * WINDOW:
            yield chunk[0][0], tuple(s for _n, s in chunk)


def repeats(root, sections, limit=10):
    """Added code windows that also occur somewhere else in tracked source."""
    wanted = {}
    for f, _status, added, _removed in sections:
        if SRC.search(f) and "node_modules" not in f:
            for line, key in windows(added):
                wanted.setdefault(key, set()).add((f, line))
    found = {}
    listed = run(["git", "ls-files", "-z", "--", "*.ts", "*.tsx", "*.mts", "*.js", "*.mjs"], cwd=root).stdout
    for path in filter(None, listed.split("\0")):
        full = os.path.join(root, path)
        if "node_modules" in path or not os.path.isfile(full):
            continue
        with open(full, errors="replace") as fh:
            for line, key in windows(enumerate(fh.read().splitlines(), 1)):
                if key in wanted:
                    found.setdefault(key, set()).add((path, line))
    leads = sorted((f, line, sorted(where - wanted[key]), key[0])
                   for key, where in found.items() if where - wanted[key] for f, line in wanted[key])
    if not leads:
        print("repeats: no added code window occurs elsewhere")
        return
    print("repeats (added code that already exists: call the owner or merge the copies):")
    shown, last = 0, ("", -99)
    for f, line, others, first in leads:
        if f == last[0] and line - last[1] <= WINDOW:
            last = (f, line)
            continue
        last = (f, line)
        where = ", ".join(f"{p}:{n}" for p, n in others[:3]) + (f" and {len(others) - 3} more" if len(others) > 3 else "")
        print(f"  {f}:{line} `{first[:70]}` also at {where}")
        shown += 1
        if shown == limit:
            print("  ... further leads omitted")
            break


def fmt_fn(name, line, cx, ln):
    return f"{name}:{line} cx={cx if cx is not None else '?'} lines={ln if ln is not None else '?'}"


def main():
    ap = argparse.ArgumentParser(add_help=True)
    ap.add_argument("files", nargs="*")
    ap.add_argument("--diff")
    ap.add_argument("--base")
    ap.add_argument("-C", dest="root", default=".")
    ap.add_argument("--complexity", type=int, default=21)
    ap.add_argument("--function-lines", type=int, default=80)
    ap.add_argument("--file-lines", type=int, default=600)
    a = ap.parse_args()
    root = os.path.abspath(a.root)
    files = list(a.files)
    names = []
    if a.diff:
        df, names = diff_files_and_names(a.diff)
        files = files or df
    files = [f for f in files if os.path.exists(os.path.join(root, f))]
    if not files:
        print("measure: no source files to measure")
        if a.diff:
            budget(root, diff_sections(a.diff), a.base)
        return 0

    now = oxlint_measure(root, files)
    before = None
    if a.base:
        tmp, present = base_snapshot(root, a.base, files)
        try:
            before = oxlint_measure(tmp, present, binary_root=root) if present else {}
        finally:
            shutil.rmtree(tmp, ignore_errors=True)
    if now is None:
        print("measure: oxlint not found under node_modules (or bun missing); branch counts skipped")

    flagged = []
    for f in files:
        text = open(os.path.join(root, f), errors="replace").read()
        lines = nonblank(text)
        base_lines = None
        if before is not None and f in before:
            b = run(["git", "show", f"{a.base}:{f}"], cwd=root)
            base_lines = nonblank(b.stdout) if b.returncode == 0 else None
        head = f"{f}: {lines} nonblank lines" + (f" (was {base_lines})" if base_lines is not None else "")
        if lines > a.file_lines:
            head += f"  OVER file ceiling {a.file_lines}"
        print(head)
        if now is not None:
            fns = now.get(f, {}).get("functions", {})
            ordered = sorted(fns.items(), key=lambda kv: -((kv[1][0] or 0) * 1000 + (kv[1][1] or 0)))
            shown = 0
            for (name, line), (cx, ln) in ordered:
                over = []
                if cx is not None and cx > a.complexity:
                    over.append(f"cx>{a.complexity}")
                if ln is not None and ln > a.function_lines:
                    over.append(f"lines>{a.function_lines}")
                mark = "  OVER " + ",".join(over) if over else ""
                if over or shown < 8:
                    print("  " + fmt_fn(name, line, cx, ln) + mark)
                    shown += 1
                if over:
                    flagged.append(f"{f} {name} cx={cx} lines={ln}")
            if len(ordered) > shown:
                print(f"  ... {len(ordered) - shown} smaller functions")
            if before is not None and f in before:
                bfns = {n: v for (n, _l), v in before[f]["functions"].items()}
                nfns = {n: v for (n, _l), v in fns.items()}
                moved = []
                for n in sorted(set(bfns) | set(nfns)):
                    b, c = bfns.get(n), nfns.get(n)
                    if b is None:
                        moved.append(f"new {n} cx={c[0]} lines={c[1]}")
                    elif c is None:
                        moved.append(f"gone {n} (was cx={b[0]} lines={b[1]})")
                    elif b != c:
                        moved.append(f"{n} cx {b[0]}->{c[0]} lines {b[1]}->{c[1]}")
                if moved:
                    print("  before -> after: " + "; ".join(moved))
        exps = exports_of(text)
        if exps:
            rows = []
            for name in exps:
                n = caller_count(root, name, f)
                tag = " UNUSED" if n == 0 else (" one-caller" if n == 1 else "")
                rows.append(f"{name}={n}{tag}")
            print("  exports (files using them): " + ", ".join(rows))
    if names:
        print(f"names defined on added lines ({len(names)}): " + ", ".join(names))
    if flagged:
        print("over a ceiling:")
        for row in flagged:
            print("  " + row)
    if a.diff:
        sections = diff_sections(a.diff)
        budget(root, sections, a.base)
        repeats(root, sections)
    return 0


if __name__ == "__main__":
    sys.exit(main())
