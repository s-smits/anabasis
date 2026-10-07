#!/usr/bin/env python3
"""Compose grouped prompts for native (Claude subagent) lanes from the single-lane prompts.

`build-manifest.ts --sessions` only groups contiguous catalogue lanes, so thematic groups such as
2+34 or 5+33+6 cannot be asked of it. The single-lane prompts it writes under
`<lanes>/prompts/lane_NN.md` already hold everything a lane needs, and every one starts with the
same shared instructions, so a group is one shared prefix plus each lane's own `startsFrom:` line
and body. This script composes those groups, one file per Agent call, under `<lanes>/pairs/`.
Standard library only; it writes nothing outside the output directory.

    python3 compose-native-pairs.py --lanes <review>/lanes --agents 8 \
        [--remote-host <ssh host>] [--out-dir <dir>] [--groups ../references/lane-groups.json]
    python3 compose-native-pairs.py --lanes <review>/lanes --pairs 1+8,2+34,5   # explicit groups
    python3 compose-native-pairs.py --runs <review> <review> <review> --components 9 \
        --out-dir <multi> [--prior <earlier note>]                               # one lane group across runs

`--agents N` is the total number of subagents; `--components K` instead caps each subagent at K
lanes times runs. `references/lane-groups.json` says which lanes read the same bytes (a binary tree
of themes) and which lanes always run alone; the script prunes lanes that have no prompt, gives
each alone lane its own subagent, and cuts the rest by splitting the largest group into its two
children (ties go to the left one) until the count is met or every group fits the cap. Every lane
with a prompt lands in exactly one group, and the plan is printed and written as
`<out-dir>/groups.json` before any prompt is composed. The Authority paragraph is replaced by a
report-only one: a native lane's default authority lets it commit repairs in a worktree of its
own, which this script withholds so the primary adjudicates first.

`--runs` names several review directories, each as `wri.ts read --out` left it and, for a run
with a snapshot, with its single-lane prompts already built. Each group then reads its lanes in
every named run and writes one report that sorts each finding by the runs it recurs in. The
alone lanes stay per run: their evidence boundary or scratch belongs to one run. A run without a
snapshot (probe tier) is named with the captures it can answer from. The run's identity is read
from its `wri-review.json` and its campaign's `opening.json`, read-only.

Exit 1 when the lane-group file or any structural check fails. The composed text is handed to
the Agent tool verbatim as the prompt.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

DEFAULT_GROUPS = Path(__file__).resolve().parent.parent / "references" / "lane-groups.json"
WIDE_GROUP = 8
# The full shared instructions open with this heading. A launch that also held an isolated lane
# writes the blind file first and these instructions inside each open lane's task, after
# `# Your assignment`, so a prefix is cut from this heading to `assignedSession:`, never at the
# first `# Your assignment`. A prompt without it is an isolated lane's, whose head is the blind file.
FULL_HEAD = "# Whole-run investigation"
ASSIGNMENT = ["", "---", "", "# Your assignment", ""]
# The sections build-manifest writes into the shared instructions, by heading. The orientation is
# authored and may carry headings of its own, so only these split a prefix.
SECTION_HEADS = (
    "## Orientation",
    "## Controller facts",
    "## Run overview",
    "## The moved variable",
    "## Assignments in this launch",
    "## Progressive admission",
    "## Snapshot directory",
    "## Transport capabilities",
    "## Commands",
    "## Reporting rules",
)
# A multi-run assignment replaces the launch's own lane ledger.
LAUNCH_ONLY = ("## Assignments in this launch", "## Progressive admission")
# The labels a multi-run finding carries; `validate-reports.ts --groups` reads the same sets from
# `manifest-reporting.ts`, and the composer test holds the two together.
PILES = {
    "every": "the same mechanism at the same owner shows in every run where the lane's question applies",
    "absent": "it shows in some runs, and you read the others' records and it is not there; say why for each (domain shape, censored by a stop, never reached)",
    "unsaid": "it shows in some runs and the others' records cannot say either way; say what is missing",
}
OUTCOMES = {
    "patch": "owner `file:line` at the run's source commit, the general mechanism in one sentence, the test that would fail without it, and the corpus count",
    "decision": "for the operator: one owner, the missing evidence, and the decision it changes",
    "prediction": "a falsifiable row for the next run: moved variable, claim, direction, falsifier",
    "drop": "why: an edge case, one run only with a rival explanation, product content, or already fixed",
}


def load_groups(path: Path) -> tuple[set[int], dict]:
    doc = json.loads(path.read_text())
    if doc.get("schema") != "wri-lane-groups/v2":
        raise SystemExit(f"{path}: schema is not wri-lane-groups/v2")
    alone = {int(k) for k in doc["alone"]}
    seen: list[int] = []

    def walk(node) -> None:
        if isinstance(node, int):
            seen.append(node)
            return
        children = node.get("split")
        if not isinstance(node.get("reads"), str) or not isinstance(children, list) or len(children) != 2:
            raise SystemExit(f"{path}: a node needs a `reads` string and exactly two children")
        for child in children:
            walk(child)

    walk(doc["tree"])
    if len(seen) != len(set(seen)):
        raise SystemExit(f"{path}: a lane appears twice in the tree")
    if set(seen) & alone:
        raise SystemExit(f"{path}: lanes {sorted(set(seen) & alone)} are both alone and in the tree")
    missing = set(range(1, 39)) - set(seen) - alone
    if missing:
        raise SystemExit(f"{path}: lanes {sorted(missing)} are in neither the tree nor `alone`")
    return alone, doc["tree"]


def prune(node, available: set[int]):
    """The tree with lanes that have no prompt removed; a node left with one child becomes it."""
    if isinstance(node, int):
        return node if node in available else None
    kids = [k for k in (prune(c, available) for c in node["split"]) if k is not None]
    if not kids:
        return None
    return kids[0] if len(kids) == 1 else {"reads": node["reads"], "split": kids}


def lanes_of(node) -> list[int]:
    return [node] if isinstance(node, int) else lanes_of(node["split"][0]) + lanes_of(node["split"][1])


def cut(tree, groups: int | None = None, size: int | None = None) -> list:
    """Subtrees made by repeatedly splitting the one with the most lanes (the leftmost wins a tie),
    until there are `groups` of them or none holds more than `size` lanes, or every lane is alone."""
    parts = [tree]
    while True:
        biggest, at = max((len(lanes_of(p)), -i) for i, p in enumerate(parts))
        if biggest < 2 or (groups is not None and len(parts) >= groups) or (size is not None and biggest <= size):
            return parts
        parts[-at : -at + 1] = parts[-at]["split"]


def plan_agents(
    alone: set[int], tree, available: set[int], agents: int | None = None, per_agent: int | None = None
) -> list[tuple[tuple[int, ...], str]]:
    """Each alone lane in its own subagent, the rest cut into `agents` groups in all or into groups
    of at most `per_agent` lanes."""
    own = sorted(n for n in alone if n in available)
    rest = prune(tree, available)
    out = [((n,), "runs alone") for n in own]
    if rest is None:
        return out
    if per_agent is not None:
        parts = cut(rest, size=max(1, per_agent))
    else:
        slots = (agents or 0) - len(own)
        if slots < 1:
            raise SystemExit(f"--agents {agents} leaves no subagent for the grouped lanes: {len(own)} lanes run alone")
        parts = cut(rest, groups=slots)
    out += [(tuple(lanes_of(part)), "one lane" if isinstance(part, int) else part["reads"]) for part in parts]
    return out


def authority(writes: str, remote_host: str | None, leads: bool = False) -> str:
    if remote_host:
        remote = (
            f"- Evidence that is not mirrored locally may be read on `{remote_host}` with read-only "
            f"`ssh {remote_host}` commands (ls, cat, sha256sum, find), as the Orientation says, and only when "
            "your question needs it. Never write, install or run anything there, and never redirect output to "
            "a file there, not even under /private/tmp: one stray `> file` in an ssh command is a write."
        )
    else:
        remote = (
            "- No remote host is available. Evidence that is not mirrored locally is something you could not "
            "read; say so under `### Not established`."
        )
    return "\n".join(
        [
            "Authority (set by the primary reviewer for this review; it replaces any repair authority in the shared instructions above):",
            "- Report only. Do not create a worktree, branch or commit and do not edit any source file; the primary reviewer decides about repairs after adjudicating the reports.",
            f"- The one thing you may write is your report: {writes} Write nothing else anywhere.",
            "- Write `owner:` only on a finding's own owner line. The report validator takes the first word after any `owner:` on any line as a finding owner, so a sentence like \"the projection owner: add a ...\" is refused.",
            (
                "- Do not read another group's prompt or report; the earlier reports your assignment names for your own lanes are leads you may read."
                if leads
                else "- Do not read any other lane's prompt or report."
            )
            + " Work each assigned lane as its own independent investigation; a conclusion from one lane is not evidence in the other.",
            remote,
            "- Keep each lane's report to about 1,500 words at most.",
            "- When your report files are written, reply with only: for each lane, its number and one line per finding headline, plus anything you could not read or settle.",
        ]
    )


def single_writes(out_dir: Path) -> str:
    return (
        f"one file per assigned lane at {out_dir}/lane_NN.md (NN = two-digit lane number), in exactly the shape required above "
        "(a `## lane_NN` heading, then `### Started from`, `### Evidence read`, `### Findings`, `### Not established`, each once "
        "and in that order, every finding carrying an `owner:` line, and each finding's observation and its inferred cause as "
        "separate sentences)."
    )


def available_lanes(prompts: Path) -> set[int]:
    return {int(m.group(1)) for p in prompts.glob("lane_*.md") if (m := re.match(r"lane_(\d+)\.md$", p.name))}


def parse(lanes: Path, n: int) -> dict:
    path = lanes / "prompts" / f"lane_{n:02d}.md"
    if not path.is_file():
        raise SystemExit(f"lane {n}: no prompt at {path}")
    lines = path.read_text().split("\n")

    def find(pred, start, what):
        for i in range(start, len(lines)):
            if pred(lines[i]):
                return i
        raise SystemExit(f"lane {n}: {what} not found in {path}")

    full = next((i for i, line in enumerate(lines) if line.startswith(FULL_HEAD)), None)
    session = find(lambda l: l.startswith("assignedSession:"), full or 0, "`assignedSession:` line")
    prefix = lines[full or 0 : session]
    while prefix and prefix[-1] in ASSIGNMENT:
        prefix.pop()
    starts = find(lambda l: l.startswith("startsFrom:"), session, "`startsFrom:` line")
    report = find(lambda l: l.startswith("Report one clearly separated"), session, "report paragraph")
    body0 = find(lambda l: re.match(r"^\*\*\d+\. ", l) is not None, session, "`**N. Title.**` lane body")
    auth = find(lambda l: l.startswith("Authority:"), body0, "`Authority:` paragraph")
    return {
        "blind": full is None,
        "prefix": prefix,
        "startsFrom": lines[starts],
        "report": lines[report:body0],
        "body": lines[body0:auth],
    }


def session_name(group: tuple[int, ...]) -> str:
    nums = [f"{n:02d}" for n in group]
    return "lanes_" + "_".join(nums) if len(group) > 1 else f"lane_{nums[0]}"


def compose(lanes: Path, pair: tuple[int, ...], out_dir: Path, remote_host: str | None) -> tuple[str, str, bool]:
    parts = [parse(lanes, n) for n in pair]
    name = session_name(pair)
    out = list(parts[0]["prefix"]) + ASSIGNMENT
    out += [f"assignedSession: {name}", f"assignedLanes: {', '.join(f'{n:02d}' for n in pair)}"]
    out += [p["startsFrom"] for p in parts]
    out += ["assignmentKind: grouped semantic review" if len(pair) > 1 else "assignmentKind: single semantic review", ""]
    out += parts[0]["report"]
    for p in parts:
        out += p["body"]
    out += [authority(single_writes(lanes / "native-output"), remote_host), ""]
    return name, "\n".join(out), parts[0]["blind"]


def check(text: str, pair: tuple[int, ...], blind: bool = False) -> list[str]:
    bad = []
    if text.count("# Your assignment") != 1:
        bad.append(f"{text.count('# Your assignment')} assignment headings")
    if blind and "## Run overview" in text:
        bad.append("an isolated lane's prompt carries the `## Run overview` it must be blind to")
    if not blind and "## Run overview" not in text:
        bad.append("no `## Run overview`: the shared instructions did not reach the composed prompt")
    if not blind and "# Independent blind review" in text:
        bad.append("an open lane's prompt carries the isolated lanes' blind file")
    authorities = len(re.findall(r"^Authority[ (:]", text, re.M))
    if authorities != 1:
        bad.append(f"{authorities} Authority paragraphs; a lane body kept its own")
    for n in pair:
        if not re.search(rf"^\*\*{n}\. ", text, re.M):
            bad.append(f"lane {n} body missing")
    if "trace-challenge-packet" in text and pair != (23,):
        bad.append("private trace-challenge packet named outside lane 23")
    return bad


# ---- several runs ---------------------------------------------------------------------------


def read_run(review: Path) -> dict:
    """One named run: its identity, its single-lane prompts if it has a snapshot, and the earlier
    lane reports under its review, by the lane headings they carry."""
    state_path = review / "wri-review.json"
    if not state_path.is_file():
        raise SystemExit(f"{review}: no wri-review.json; read the run with `wri.ts read --out {review}` first")
    state = json.loads(state_path.read_text())
    campaign, run_id = Path(state["campaign"]), state["runId"]
    opening = json.loads((campaign / "controller" / run_id / "opening.json").read_text())
    scope = state.get("scope") or {}
    lanes_dir = review / "lanes"
    reports: dict[int, list[Path]] = {}
    for path in sorted(review.glob("lanes*/*-output/*.md")):
        for m in re.finditer(r"^## lane_(\d{2})\s*$", path.read_text(errors="replace"), re.M):
            reports.setdefault(int(m.group(1)), []).append(path)
    return {
        "id": run_id,
        "review": review,
        "campaign": campaign,
        "commit": opening["source"]["commit"],
        "checkout": state.get("repo"),
        "scope": scope,
        "lanes_dir": lanes_dir,
        "available": available_lanes(lanes_dir / "prompts"),
        "snapshot": (review / "snapshot" / "snapshot-status.json").is_file(),
        "captures": sorted(p.name for p in review.glob("*.txt")),
        "reports": reports,
    }


def shared_prefix(run: dict) -> list[str]:
    """The run's shared instructions, from the first of its prompts that is not an isolated lane's."""
    for n in sorted(run["available"]):
        parsed = parse(run["lanes_dir"], n)
        if not parsed["blind"]:
            return parsed["prefix"]
    raise SystemExit(f"{run['review']}: no open lane's prompt under {run['lanes_dir'] / 'prompts'} carries the shared instructions")


def run_line(run: dict) -> str:
    scope = run["scope"]
    terminal = scope.get("terminal") or {}
    cases = scope.get("cases") or {}
    tier = scope.get("tier", "unknown")
    head = f"- `{run['id']}` ({tier} tier, {'snapshot' if run['snapshot'] else 'no snapshot'}): campaign `{run['campaign']}`; review `{run['review']}`;"
    source = f" source `{run['commit']}`, read in `{run['checkout']}`;"
    outcome = f" terminal `{terminal.get('outcome', 'unknown')}` ({terminal.get('reason') or 'no reason recorded'});"
    counts = (
        f" {len(scope.get('batteries') or [])} batteries; cases {cases.get('verified', '?')} verified,"
        f" {cases.get('unaccepted', '?')} unaccepted, {cases.get('nonResult', '?')} non-results."
    )
    return head + source + outcome + counts


def probe_lines(run: dict) -> list[str]:
    captures = ", ".join(f"`{name}`" for name in run["captures"]) or "none"
    return [
        f"## Run {run['id']} (no snapshot)",
        "",
        f"This run was read at the {run['scope'].get('tier', 'unknown')} tier: {run['scope'].get('why') or 'no reason recorded'}.",
        f"It can answer only from its deterministic captures under `{run['review']}` ({captures}) and from its own",
        "campaign records. It cannot answer a question that needs the snapshot's cases, traces, digest or",
        "views, and it has no lane prompt or lane trigger: where a lane's question needs those, put the",
        "finding in `unsaid` for this run and name what is missing.",
    ]


def sections(prefix: list[str]) -> list[tuple[str, list[str]]]:
    """A run's shared instructions as (heading, lines) in order; the first is its title and identity."""
    out: list[tuple[str, list[str]]] = [(prefix[0], [])]
    for line in prefix[1:]:
        if line.startswith(SECTION_HEADS):
            out.append((line, []))
        else:
            out[-1][1].append(line)
    return out


def heading_key(heading: str) -> str:
    return next((h for h in SECTION_HEADS if heading.startswith(h)), heading)


def runs_preamble(runs: list[dict], prior: list[Path]) -> list[str]:
    snapshot_runs = [r for r in runs if r["snapshot"]]
    split = [sections(shared_prefix(r)) for r in snapshot_runs]
    by_run = [{heading_key(h): (h, body) for h, body in s} for s in split]
    commits = {r["commit"] for r in runs}
    out = [
        f"# Multi-run investigation — {len(runs)} runs",
        "",
        "You are one independent leaf session, with no delegation, coordination or launcher authority.",
        "You read the same lanes in every run named below, and sort what you find by the runs it shows in:",
        "a mechanism that recurs across campaigns is stronger evidence than one run's finding, and a",
        "mechanism absent from a run whose records you read is evidence too. Evidence outranks prose; a",
        "started run is not a completed run; generated output under `campaigns/` or `domains/` is immutable.",
        "",
        "## Runs under review",
        "",
        *[run_line(r) for r in runs],
        "",
        (
            f"Every run was measured at source `{commits.pop()}`: read source in the checkout named for it."
            if len(commits) == 1
            else "The runs were measured at different source commits. Read each run's source at its own commit, in the"
            " checkout named for it; a mechanism at one commit is evidence about another only once you have read the"
            " same lines there (`git diff <one> <other> -- <owner file>` in a checkout that holds both)."
        ),
        "",
    ]
    # A section every snapshot run carries byte for byte, such as an orientation written once for
    # the set, is rendered once; the rest stay under the run they describe.
    shared = set()
    if len(by_run) > 1:
        shared = {k for k in by_run[0] if k not in LAUNCH_ONLY and all(k in s and s[k] == by_run[0][k] for s in by_run[1:])}
    for heading, body in split[0] if split else []:
        if heading_key(heading) in shared:
            out += [heading, *body]
    for run, parts in zip(snapshot_runs, split):
        out += ["", f"## Run {run['id']}", ""]
        for i, (heading, body) in enumerate(parts):
            key = heading_key(heading)
            if key in shared or key in LAUNCH_ONLY:
                continue
            if i == 0:
                # The title's identity lines, less the session sentence the preamble already says.
                body = [line for line in body if not line.startswith("You are one independent leaf session")]
                while body and body[0] == "":
                    body.pop(0)
                out += body
            else:
                out += ["#" + heading, *body]
    for run in runs:
        if not run["snapshot"]:
            out += ["", *probe_lines(run)]
    out += ["", *method_lines(runs, prior)]
    while out and out[-1] == "":
        out.pop()
    return out


def method_lines(runs: list[dict], prior: list[Path]) -> list[str]:
    corpus = sorted({str(r["campaign"].parent) for r in runs})
    lines = [
        "## Multi-run method",
        "",
        "These steps extend the reporting rules above; where the two differ for a multi-run report, these win.",
        "",
        "1. For each assigned lane, read its question against every named run. The assignment says, per run,",
        "   the trigger it started from there, or why it has none, and any earlier report of that lane. An",
        "   earlier report is a lead, not a receipt: re-check each consequential claim against the run's",
        "   source and records before carrying it.",
        "2. Sort every finding into exactly one pile, after checking the other runs' bytes yourself:",
        *[f"   - `{name}`: {text};" for name, text in PILES.items()],
        "   a finding one run's earlier report made and another run's did not examine is examined now in",
        "   that run's records, never left unsorted. A difference in wording is not a difference in",
        "   mechanism; a shared file name is not a shared mechanism. Name the runs, by id and campaign, the",
        "   finding shows in and those it was checked absent from.",
        "3. For each `every` finding whose owner is controller source (`src/`, `tools/`, `.claude/skills/`),",
        f"   count over the recorded corpus ({', '.join(f'`{c}`' for c in corpus)}) the distinct campaigns and",
        "   distinct domains where the same mechanism shows, naming the reader you used and one join it did not",
        "   make. Prefer an exported function over a hand regex. If a count would take more than about fifteen",
        "   minutes, give the cheapest bounded count and say what it misses. Builder product content",
        "   (`correctness-model/`, `agent/`, `reference/`) is counted the same way but never patched: its",
        "   owner is the Builder, and a recurring one points at the controller surface that let it through.",
        "4. End every finding with exactly one typed outcome:",
        *[f"   - `{name}`: {text};" for name, text in OUTCOMES.items()],
        "   only a fix whose shape recurs across campaigns is a `patch`; name a domain-specific one as such.",
        "   Prefer deleting a competing owner, then reusing an existing one, then adding the minimum. A",
        "   prompt sentence is a mitigation, never a guard.",
    ]
    if prior:
        lines += [
            "5. Only after your own sort is done, reconcile with the earlier reading in "
            + ", ".join(f"`{p}`" for p in prior)
            + ". For each of",
            "   its rows your lanes touch, say `confirmed` (your lanes reach the same owner from the bytes),",
            "   `amended` (same link, different owner or scope: say which), `not supported` or `not touched`.",
        ]
    lines += [
        "",
        "Hard rules: resolve every path to its real location before counting, so a symlinked tree is not",
        "counted twice; run no git command inside a campaign workspace (even `git status` writes a lock);",
        "never quote task content, request text, briefs, review or advice prose, trace text, or any domain",
        "text from a campaign record: report counts, ids, digests, paths and line numbers, and describe",
        "mechanisms in your own abstract words.",
        "",
        "## Multi-run report",
        "",
        "Write one report for your whole assignment, headed `# Multi-run: <assignedSession>`, with one",
        "`## lane_NN` section per assigned lane. Under each, write `### Started from` (per run, the trigger",
        "or why there is none), `### Evidence read` (per run, every path), `### Findings` and",
        "`### Not established`, each exactly once and in that order. `### Findings` holds the single word",
        "`none` or one entry per finding, each carrying three lines of its own: `owner: <owner>` from the",
        f"owners the reporting rules list, `pile: <{' | '.join(PILES)}>` and `outcome: <{' | '.join(OUTCOMES)}>`.",
    ]
    if prior:
        lines += ["After the lane sections, write `## Prior reconciliation` with one verdict per row your lanes touch."]
    return lines


def compose_runs(
    runs: list[dict], group: tuple[int, ...], out_dir: Path, preamble: list[str], remote_host: str | None
) -> tuple[str, str]:
    name = session_name(group)
    out = list(preamble) + ASSIGNMENT
    out += [
        f"assignedSession: {name}",
        f"assignedLanes: {', '.join(f'{n:02d}' for n in group)}",
        f"assignedRuns: {', '.join(r['id'] for r in runs)}",
        "assignmentKind: multi-run semantic review",
        "",
    ]
    for n in group:
        first = next(r for r in runs if n in r["available"])
        out += parse(first["lanes_dir"], n)["body"]
        out += [f"Lane {n:02d} in each run:"]
        for r in runs:
            if n in r["available"]:
                where = parse(r["lanes_dir"], n)["startsFrom"].split(":", 2)[-1].strip().rstrip(".")
            elif r["snapshot"]:
                where = "no prompt in this run (its trigger did not fire or it was not selected); read the question against its records anyway, and say if it does not apply"
            else:
                where = "no snapshot; answer from its captures where they can, else `unsaid`"
            leads = r["reports"].get(n, [])
            lead = f" Earlier report: {', '.join(f'`{p}`' for p in leads)}." if leads else ""
            out.append(f"- `{r['id']}`: {where}.{lead}")
        out.append("")
    writes = f"one file at {out_dir / 'native-output' / (name + '.md')}, in exactly the shape the multi-run report section asks."
    out += [authority(writes, remote_host, leads=True), ""]
    return name, "\n".join(out)


def parse_pairs(spec: str) -> list[tuple[int, ...]]:
    return [tuple(int(x) for x in group.split("+")) for group in spec.split(",") if group]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    where = ap.add_mutually_exclusive_group(required=True)
    where.add_argument("--lanes", type=Path, help="<review>/lanes, which holds prompts/lane_NN.md")
    where.add_argument("--runs", type=Path, nargs="+", help="two or more review directories, one per run, read across")
    how = ap.add_mutually_exclusive_group(required=True)
    how.add_argument("--agents", type=int, help="total number of subagents; lane-groups.json decides which lanes share one")
    how.add_argument("--components", type=int, help="at most this many lanes times runs per subagent")
    how.add_argument("--pairs", help="explicit groups, each lanes joined by +, e.g. 1+8,2+34,5")
    ap.add_argument("--groups", type=Path, default=DEFAULT_GROUPS, help="the lane-group file (default: references/lane-groups.json)")
    ap.add_argument("--remote-host", help="ssh host a lane may read, read-only, for evidence not mirrored locally")
    ap.add_argument("--out-dir", type=Path, help="where the composed prompts go (default <lanes>/pairs; required with --runs)")
    ap.add_argument("--prior", type=Path, action="append", default=[], help="with --runs: an earlier reading to reconcile with")
    args = ap.parse_args()

    alone, tree = load_groups(args.groups)
    runs: list[dict] = []
    if args.runs:
        if len(args.runs) < 2 or args.out_dir is None:
            print("--runs needs two or more review directories and an --out-dir", file=sys.stderr)
            return 1
        runs = [read_run(r.resolve()) for r in args.runs]
        unbuilt = [str(r["review"]) for r in runs if r["snapshot"] and not r["available"]]
        if unbuilt:
            print(f"no lane prompts under {', '.join(unbuilt)}; build them with build-manifest.ts --transport native first", file=sys.stderr)
            return 1
        available = set().union(*(r["available"] for r in runs))
        kept = sorted(available & alone)
        if kept:
            print(f"note: lanes {kept} run alone and stay per run; compose them with --lanes <review>/lanes", file=sys.stderr)
        available -= alone
        out_dir = args.out_dir.resolve()
        lanes = None
    else:
        lanes = args.lanes.resolve()
        out_dir = (args.out_dir or lanes / "pairs").resolve()
        available = available_lanes(lanes / "prompts")
    if not available:
        print("no single-lane prompts to group; run build-manifest.ts --transport native first", file=sys.stderr)
        return 1

    if args.pairs:
        plan = [(g, "named by the operator") for g in parse_pairs(args.pairs)]
        named = [n for g, _ in plan for n in g]
        problems = []
        if len(named) != len(set(named)):
            problems.append("a lane appears in more than one group")
        for g, _ in plan:
            if (len(g) > 1 or runs) and set(g) & alone:
                problems.append(f"group {g} holds lane(s) {sorted(set(g) & alone)}, which run alone{' and per run' if runs else ''}")
            problems += [f"lane {n} has no prompt" for n in g if n not in available]
        if problems:
            print("\n".join(problems), file=sys.stderr)
            return 1
        # A lane with a prompt that no group names runs alone, so no owed lane goes unassigned.
        plan += [((n,), "runs alone") for n in sorted(available - set(named))]
    elif args.components is not None:
        if args.components < 1:
            print("--components must be at least 1", file=sys.stderr)
            return 1
        plan = plan_agents(alone, tree, available, per_agent=args.components // max(1, len(runs)))
    else:
        if args.agents < 1:
            print("--agents must be at least 1", file=sys.stderr)
            return 1
        plan = plan_agents(alone, tree, available, agents=args.agents)
        if len(plan) < args.agents:
            print(f"note: {len(available)} lanes fill only {len(plan)} subagents, not {args.agents}", file=sys.stderr)
    for g, reads in plan:
        if len(g) >= WIDE_GROUP:
            print(f"note: {len(g)} lanes in one subagent ({reads}); reports get thin and the lanes stop being independent", file=sys.stderr)

    out_dir.mkdir(parents=True, exist_ok=True)
    rows = [{"session": session_name(g), "lanes": list(g), "reads": reads} for g, reads in plan]
    if runs:
        rows = [{**row, "runs": [r["id"] for r in runs]} for row in rows]
    (out_dir / "groups.json").write_text(json.dumps(rows, indent=1) + "\n")
    preamble = runs_preamble(runs, [p.resolve() for p in args.prior]) if runs else []
    failed = False
    for g, reads in plan:
        if runs:
            name, text = compose_runs(runs, g, out_dir, preamble, args.remote_host)
            blind = False
        else:
            name, text, blind = compose(lanes, g, out_dir, args.remote_host)
        (out_dir / f"{name}.md").write_text(text)
        bad = check(text, g, blind)
        failed |= bool(bad)
        print(name, json.dumps({"lanes": list(g), "reads": reads, "chars": len(text), "problems": bad}))
    print(f"{len(plan)} prompts for {sum(len(g) for g, _ in plan)} lanes{f' x {len(runs)} runs' if runs else ''} in {out_dir}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
