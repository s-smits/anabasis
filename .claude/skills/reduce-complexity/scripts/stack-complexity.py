#!/usr/bin/env python3
"""Compare revisions on the measures a stack is supposed to move.

Whether a branch bought its behaviour with more machinery or less. It reads every revision through
git plumbing, so it needs no second worktree and never touches the working tree.

    python3 stack-complexity.py origin/main HEAD
    python3 stack-complexity.py origin/main '#<bottom>' '#<top>'
    python3 stack-complexity.py --repo /abs/worktree --per-file origin/main HEAD

Name two revisions for a before and after, or a whole stack bottom-to-top for a column each: that
answers which PR in the stack moved a measure, which a single before-and-after hides. A `#<n>`
argument is a pull request number in the repository the checkout's `origin` names, resolved
through `gh` and fetched if the local repository has
not seen it, so a stack can be named the way the operator names it.

The first revision is read as `first...last` — the point they diverged — so work landed on the base
since the branch was cut is not charged to the branch. `--literal-base` compares the tips as given.

This is v1's instrument, adapted; v1's copy reads back with
`git show 5bc9988:.claude/skills/reduce-complexity/scripts/stack-complexity.py`, and no other copy
runs. What is v1's and not v2's was replaced rather than dropped — v2 has no cyclomatic baseline
and no document a model reads whole, and it has two standing exemption ledgers v1 had not written.

Measures, grouped by the question each answers. "Source" is what `tools/loc/source-policy.ts`
calls authored: `src`, `tools` and `packages`, never `vendor`, which is pinned verbatim.

  How much is there
    files, nonblank           source files and their nonblank lines
    test nonblank             what the gate has to run, which a mechanism moved into tests lowers
                              at the expense of nothing and a mechanism nobody proved does not

  How much branching
    decisions                 if/for/while/case/catch/&&/||/?./ternary. A McCabe proxy, not McCabe:
                              comparable between two revisions of one tree and nothing else.
    per 100 lines             the same count against the source it sits in. v1 read exact branching
                              debt off `complexity-baseline.json`; v2 holds no baseline and no
                              cyclomatic ceiling, so the honest second reading is the density: a
                              stack that added lines and branches together held it, and one that
                              added branches alone raised it.

  How tangled
    import edges              internal module edges: how many times one source file names another,
                              by relative path or by a `#` subpath `package.json` maps
    mean fan-out              edges per importing file
    hub files                 files whose fan-out sits at or above that revision's own 90th
                              percentile. An edge through a hub is a property of the hub, so their
                              number is the number of places where any change reaches most of the
                              tree.
    max fan-in                the most-imported module: how many files one edit can reach

  How wide the interface
    exports                   exported symbols, the surface one part offers another
    optional fields           `?:` in declarations: each is a state every reader must handle
    wide signatures           functions declaring five or more parameters

  How many rules there are
    refusal codes             distinct finding and refusal code literals. This is the size of the
                              contract a Builder has to satisfy: every one is a way to be refused.
    env knobs                 distinct environment variables read, the configuration surface

  How much is excused
    waived findings           rows of `tools/oxlint/not-slop.tsv`: a reported site a reader answered
                              rather than changed. A rise is a finding answered; a fall is a site
                              whose code changed until the finding stopped firing, since `bun run
                              lint` then asks for `not-slop -- prune`.
    copied ceilings           `copiedFileLimits` entries in `tools/loc/source-policy.json`: files
                              held at a limit of their own, which also turns the function check off
                              for them. AGENTS.md §12.10 keeps the map empty and says to add no
                              entry to pass, so anything above 0 is a finding by itself.

  How much a model must read
    prompt bytes              string-literal bytes in the files composing model-visible text: every
                              file that builds a prompt or declares a tool description. v1 counted
                              starter and contract documents beside this; v2 composes every
                              model-visible document in TypeScript and keeps none in the tree, so
                              the literal count is the whole of it.

A stack that adds behaviour usually moves the first four groups up. The trade this system is trying
to make is mechanism the harness enforces in place of prose it asks for, so the reading that
matters is whether the last group moved down while the others held.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from collections import Counter
from dataclasses import dataclass, fields

# `runs/` was an exclusion in v1, where it held run evidence. Here `tools/runs/` is the run CLI and
# nine authored modules, and v2 keeps every campaign outside the tree, so only the extension stays.
EXCLUDE = re.compile(
    r"(^|/)generated/|\.jsonl$"
    r"|\.(md|mdx|txt)$"
    r"|(^|/)(test|tests|__tests__)/|\.(test|spec)\.[cm]?tsx?$"
    r"|(^|/)(vendor|vendored|third_party)/|\.venv/|\.uv-cache/"
    r"|(^|/)node_modules/"
)
SOURCE_ROOTS = ("src/", "tools/", "packages/")
SOURCE_SUFFIX = (".ts", ".tsx", ".mts", ".js", ".mjs", ".py")

# Files that compose text a model receives in an ordinary session: system prompts, the loop's
# continuation and advice text, and the descriptions and results of the tools a session calls.
# Kept explicit: an AST census guesses audiences, and for a delta the honest move is to name the
# composers and let the number be exact. The membership rule, so a new one can be added without
# re-deriving it: a file is here when it builds prompt text or declares a tool description. That
# is why `src/examiner/session.ts` is in and `src/builder/session.ts` is out — the Builder's whole
# text lives in `prompt.ts`, which that session imports. Out too: the harness openers
# (`src/solve/harness.ts`, `harness-shim.ts`) and `src/kernel/contract.ts`, whose model-visible
# text is a campaign's data rather than this repository's literals; and the validators, whose
# literals are codes and paths only a refused session reads.
PROMPT_FILES = (
    "src/builder/prompt.ts",
    "src/builder/tools.ts",
    "src/builder/memory.ts",
    "src/examiner/prompt.ts",
    "src/examiner/draft.ts",
    "src/examiner/session.ts",
    "src/solve/prompt.ts",
    "src/solve/starter.ts",
    "src/solve/coding-tools.ts",
    "src/solve/answer.ts",
    "src/review/referee.ts",
    "src/review/diagnoser.ts",
    "src/review/probe.ts",
)
WAIVER_FILE = "tools/oxlint/not-slop.tsv"
POLICY_FILE = "tools/loc/source-policy.json"

DECISION = re.compile(
    r"\bif\s*\(|\bfor\s*\(|\bwhile\s*\(|\bcase\s+|\bcatch\s*\(|&&|\|\||\?\?|\?\.|\s\?\s"
)
EXPORT = re.compile(r"^\s*export\s+(?:const|function|class|interface|type|enum|async)\b", re.M)
# A declared property or parameter that may be absent. `a ?: b` in an expression needs a space
# before `?`, which this does not match; `foo?.(` is a call, excluded by requiring `:` next.
OPTIONAL = re.compile(r"[A-Za-z_$][\w$]*\?:")
# Single- and double-quoted literals plus backtick templates, which is where prompt text lives.
LITERAL = re.compile(r'"(?:[^"\\\n]|\\.)*"' r"|'(?:[^'\\\n]|\\.)*'" r"|`(?:[^`\\]|\\.)*`", re.S)
# An import of another module in this tree, by relative path or by a `#` subpath, which are the only
# edge kinds that count: a package import is not a coupling this repository can shorten. v1 read
# relative paths alone, which held there (8 `#` imports to 3,423 relative ones); v2 writes 347 of
# its 1,184 as `#src/` or `#tools/`, so reading only `./` lost nearly a third of the graph.
IMPORT = re.compile(r"""\bfrom\s+["']([.#][^"']*)["']|\bimport\s*\(\s*["']([.#][^"']*)["']""")
# A finding, refusal or non-result code: kebab-case string literals in a `code`/`kind` position.
CODE = re.compile(r"""\b(?:code|kind|check)\s*:\s*["']([a-z][a-z0-9]*(?:-[a-z0-9]+){1,6})["']""")
ENV = re.compile(r"""(?:Bun\.env|process\.env)(?:\.([A-Z][A-Z0-9_]*)|\[["']([A-Z][A-Z0-9_]*)["']\])""")
# `function f(a, b)` / `(a, b) =>` / `method(a, b) {`. Counts top-level commas in the list.
SIGNATURE = re.compile(r"(?:function\s+[\w$]*\s*|\b[\w$]+\s*)\(([^()]*)\)\s*(?::[^{=;]+)?(?:=>|\{)")


@dataclass
class Measure:
    files: int = 0
    nonblank: int = 0
    test_nonblank: int = 0
    decisions: int = 0
    decision_density: float = 0.0
    import_edges: int = 0
    mean_fanout: float = 0.0
    hub_files: int = 0
    max_fanin: int = 0
    exports: int = 0
    optional_fields: int = 0
    wide_signatures: int = 0
    refusal_codes: int = 0
    env_knobs: int = 0
    waived_findings: int = 0
    copied_ceilings: int = 0
    prompt_bytes: int = 0


LABEL = {
    "files": "source files",
    "nonblank": "nonblank source lines",
    "test_nonblank": "nonblank test lines",
    "decisions": "decision points (proxy)",
    "decision_density": "decisions per 100 lines",
    "import_edges": "internal import edges",
    "mean_fanout": "mean fan-out",
    "hub_files": "hub files (fan-out >= p90)",
    "max_fanin": "max fan-in",
    "exports": "exported symbols",
    "optional_fields": "optional fields",
    "wide_signatures": "signatures with 5+ params",
    "refusal_codes": "distinct refusal codes",
    "env_knobs": "environment knobs",
    "waived_findings": "waived findings",
    "copied_ceilings": "copied-file ceilings",
    "prompt_bytes": "prompt literal bytes",
}
GROUPS = (
    ("how much is there", ("files", "nonblank", "test_nonblank")),
    ("how much branching", ("decisions", "decision_density")),
    ("how tangled", ("import_edges", "mean_fanout", "hub_files", "max_fanin")),
    ("how wide the interface", ("exports", "optional_fields", "wide_signatures")),
    ("how many rules", ("refusal_codes", "env_knobs")),
    ("how much is excused", ("waived_findings", "copied_ceilings")),
    ("how much a model reads", ("prompt_bytes",)),
)


def resolve_rev(repo: str, rev: str) -> str:
    """`#724` or `pr/724` names a pull request; anything else is passed to git unchanged."""
    number = re.fullmatch(r"#(\d+)|pr/(\d+)", rev)
    if number is None:
        return rev
    pr = number.group(1) or number.group(2)
    named = subprocess.run(
        ["gh", "pr", "view", pr, "--repo", origin(repo), "--json", "headRefName", "-q", ".headRefName"],
        capture_output=True, text=True, check=False, cwd=repo,
    )
    if named.returncode != 0:
        sys.exit(f"gh pr view {pr}: {named.stderr.strip()}")
    branch = named.stdout.strip()
    for candidate in (f"origin/{branch}", branch):
        if subprocess.run(["git", "-C", repo, "rev-parse", "--verify", "-q", candidate],
                          capture_output=True, check=False).returncode == 0:
            return candidate
    git(repo, "fetch", "origin", f"pull/{pr}/head:refs/remotes/origin/pr/{pr}")
    return f"origin/pr/{pr}"


def origin(repo: str) -> str:
    url = git(repo, "remote", "get-url", "origin").strip()
    return re.sub(r"^.*[:/]([^/:]+/[^/]+?)(?:\.git)?$", r"\1", url)


def git(repo: str, *args: str) -> str:
    done = subprocess.run(["git", "-C", repo, *args], capture_output=True, text=True, check=False)
    if done.returncode != 0:
        sys.exit(f"git {' '.join(args)}: {done.stderr.strip()}")
    return done.stdout


def blob(repo: str, rev: str, path: str) -> str:
    done = subprocess.run(
        ["git", "-C", repo, "show", f"{rev}:{path}"], capture_output=True, text=True, check=False
    )
    return done.stdout if done.returncode == 0 else ""


def is_source(path: str) -> bool:
    return path.startswith(SOURCE_ROOTS) and path.endswith(SOURCE_SUFFIX) and EXCLUDE.search(path) is None


def is_test(path: str) -> bool:
    return bool(re.search(r"(^|/)(test|tests)/|\.(test|spec)\.[cm]?tsx?$", path)) and "node_modules" not in path


def literal_bytes(text: str) -> int:
    """Bytes of string-literal content. Comments carry no model-visible text, and a prompt file's
    own explanation of why a clause exists is often longer than the clause, so counting whole
    files would report the reasoning as prompt."""
    return sum(len(m.group(0).encode()) - 2 for m in LITERAL.finditer(text))


def wide_signatures(text: str) -> int:
    count = 0
    for match in SIGNATURE.finditer(text):
        params = match.group(1).strip()
        if params and params.count(",") >= 4:
            count += 1
    return count


def excused(repo: str, rev: str) -> tuple[int, int]:
    """The two standing exemptions this repository writes down, both exact: answered lint sites
    and files held at a size limit of their own. They take the place of v1's cyclomatic baseline,
    which v2 does not carry (AGENTS.md §12.10: there is no complexity gate in v2)."""
    rows = [line for line in blob(repo, rev, WAIVER_FILE).splitlines() if line.strip()]
    try:
        policy = json.loads(blob(repo, rev, POLICY_FILE) or "{}")
    except json.JSONDecodeError:
        policy = {}
    # The first line is the column header; every line under it is one answer.
    return max(0, len(rows) - 1), len(policy.get("copiedFileLimits", {}))


def subpath_aliases(repo: str, rev: str) -> dict[str, str]:
    """`"#src/*": "./src/*"` in `package.json`'s `imports` as `{"#src/": "src/"}`: how this
    revision's `#` specifiers resolve, read from the file that owns the mapping."""
    try:
        imports = json.loads(blob(repo, rev, "package.json") or "{}").get("imports", {})
    except json.JSONDecodeError:
        return {}
    return {
        name.rstrip("*"): target.removeprefix("./").rstrip("*")
        for name, target in imports.items()
        if isinstance(target, str)
    }


def resolve(importer: str, target: str, aliases: dict[str, str]) -> str | None:
    """The tree path an import names, or None for a `#` name the revision's map does not hold."""
    if target.startswith("#"):
        prefix = next((name for name in aliases if target.startswith(name)), None)
        return None if prefix is None else aliases[prefix] + target[len(prefix):]
    parts = importer.rsplit("/", 1)[0].split("/")
    for piece in target.split("/"):
        if piece == ".":
            continue
        if piece == "..":
            if parts:
                parts.pop()
        else:
            parts.append(piece)
    return "/".join(parts)


def measure(repo: str, rev: str, per_file: bool) -> tuple[Measure, dict[str, int]]:
    total = Measure()
    lines_by_file: dict[str, int] = {}
    codes: set[str] = set()
    knobs: set[str] = set()
    fanout: Counter[str] = Counter()
    fanin: Counter[str] = Counter()
    paths = set(p for p in git(repo, "ls-tree", "-r", "--name-only", rev).splitlines() if p)
    aliases = subpath_aliases(repo, rev)

    for path in sorted(paths):
        if is_test(path) and path.endswith(SOURCE_SUFFIX):
            total.test_nonblank += sum(1 for line in blob(repo, rev, path).split("\n") if line.strip())
            continue
        if not is_source(path):
            continue
        text = blob(repo, rev, path)
        nonblank = sum(1 for line in text.split("\n") if line.strip())
        total.files += 1
        total.nonblank += nonblank
        total.decisions += len(DECISION.findall(text))
        total.exports += len(EXPORT.findall(text))
        total.optional_fields += len(OPTIONAL.findall(text))
        total.wide_signatures += wide_signatures(text)
        codes.update(m.group(1) for m in CODE.finditer(text))
        knobs.update(m.group(1) or m.group(2) for m in ENV.finditer(text))
        for match in IMPORT.finditer(text):
            target = resolve(path, match.group(1) or match.group(2) or "", aliases)
            if target is None:
                continue
            fanout[path] += 1
            fanin[target] += 1
        if per_file:
            lines_by_file[path] = nonblank

    total.refusal_codes = len(codes)
    total.env_knobs = len(knobs)
    total.import_edges = sum(fanout.values())
    total.mean_fanout = round(total.import_edges / max(1, len(fanout)), 2)
    if fanout:
        ranked = sorted(fanout.values())
        p90 = ranked[min(len(ranked) - 1, int(len(ranked) * 0.9))]
        total.hub_files = sum(1 for count in fanout.values() if count >= p90)
    total.max_fanin = max(fanin.values(), default=0)
    total.decision_density = round(total.decisions / max(1, total.nonblank) * 100, 2)
    total.waived_findings, total.copied_ceilings = excused(repo, rev)
    for path in PROMPT_FILES:
        if path in paths:
            total.prompt_bytes += literal_bytes(blob(repo, rev, path))
    return total, lines_by_file


def cell(value: float) -> str:
    return f"{value:,.2f}" if isinstance(value, float) else f"{value:,}"


def delta(base: float, head: float) -> str:
    moved = head - base
    body = f"{moved:+,.2f}" if isinstance(moved, float) else f"{moved:+,}"
    return body if moved else "0"


def pct(base: float, head: float) -> str:
    return "n/a" if base == 0 else f"{(head - base) / base * 100:+.1f}%"


def column(rev: str) -> str:
    return rev.rsplit("/", 1)[-1][-10:]


def main() -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument("revs", nargs="+", help="base and head, or a stack bottom-to-top")
    ap.add_argument("--repo", default=".")
    ap.add_argument("--per-file", action="store_true", help="also list the files whose line count moved most")
    ap.add_argument("--literal-base", action="store_true", help="compare the tips as given, not from where they diverged")
    args = ap.parse_args()
    if len(args.revs) < 2:
        sys.exit("name at least two revisions")

    revs = [resolve_rev(args.repo, rev) for rev in args.revs]
    if not args.literal_base:
        merged = git(args.repo, "merge-base", revs[0], revs[-1]).strip()
        if merged and merged != git(args.repo, "rev-parse", revs[0]).strip():
            print(f"note: {args.revs[0]} has moved on since {args.revs[-1]} was cut; "
                  f"measuring from their merge base {merged[:9]}.\n")
            revs[0] = merged

    taken = [measure(args.repo, rev, args.per_file) for rev in revs]
    values = [m for m, _ in taken]
    base, head = values[0], values[-1]

    width = max(len(v) for v in LABEL.values())
    heads = [column(rev) for rev in args.revs]
    print(" -> ".join(args.revs) + "\n")
    print(f"{'measure'.ljust(width)}  " + "  ".join(h.rjust(10) for h in heads) + f"  {'net':>10}  {'':>7}")
    for title, keys in GROUPS:
        print(("— " + title + " ").ljust(width + 14 + 12 * len(heads), "—"))
        for key in keys:
            row = [getattr(m, key) for m in values]
            print(f"{LABEL[key].ljust(width)}  " + "  ".join(cell(v).rjust(10) for v in row)
                  + f"  {delta(row[0], row[-1]):>10}  {pct(row[0], row[-1]):>7}")

    print("\nmodel-visible text, per composer")
    for path in PROMPT_FILES:
        sizes = [literal_bytes(blob(args.repo, rev, path)) for rev in revs]
        if any(sizes):
            steps = " -> ".join(f"{s:,}" for s in sizes)
            print(f"  {sizes[-1] - sizes[0]:>+7,}  {steps}  {path}")

    if args.per_file:
        base_files, head_files = taken[0][1], taken[-1][1]
        moved = {
            path: head_files.get(path, 0) - base_files.get(path, 0)
            for path in set(base_files) | set(head_files)
        }
        rows = sorted((d for d in moved.items() if d[1]), key=lambda kv: -abs(kv[1]))[:15]
        if rows:
            print("\nlargest per-file line moves")
            for path, count in rows:
                print(f"  {count:>+6}  {path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
