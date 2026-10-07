#!/usr/bin/env python3
"""Compose grouped prompts for native (Claude subagent) lanes from the single-lane prompts.

`build-manifest.ts --sessions` only groups contiguous catalogue lanes, so thematic groups such as
2+34 or 5+33+6 cannot be asked of it. The single-lane prompts it writes under
`<lanes>/prompts/lane_NN.md` already hold everything a lane needs, and every one starts with the
same shared instructions, so a group is one shared prefix plus each lane's own `startsFrom:` line
and body. This script composes those groups, one file per Agent call, under `<lanes>/pairs/`.
Standard library only; reads and writes nothing outside `<lanes>` and the lane-group file.

    python3 compose-native-pairs.py --lanes <review>/lanes --agents 8 \
        [--remote-host <ssh host>] [--out-dir <dir>] [--groups ../references/lane-groups.json]
    python3 compose-native-pairs.py --lanes <review>/lanes --pairs 1+8,2+34,5   # explicit groups

`--agents N` is the total number of subagents. `references/lane-groups.json` says which lanes read
the same bytes (a binary tree of themes) and which lanes always run alone; the script prunes lanes
that have no prompt, gives each alone lane its own subagent, and cuts the rest into the remaining
N - (alone lanes) groups by splitting the largest group into its two children until the count is
met (ties go to the left one). Every lane with a prompt lands in exactly one group, and the plan
is printed and written as `<out-dir>/groups.json` before any prompt is composed. The Authority
paragraph is replaced by a report-only one: a native lane's default authority lets it commit
repairs in a worktree of its own, which this script withholds so the primary adjudicates first.
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


def cut(tree, groups: int) -> list:
    """Exactly `groups` subtrees (or every lane alone when there are fewer to give), by repeatedly
    splitting the one with the most lanes; the leftmost wins a tie."""
    parts = [tree]
    while len(parts) < groups:
        size, at = max(((len(lanes_of(p)), -i) for i, p in enumerate(parts)), default=(0, 0))
        at = -at
        if size < 2:
            break
        node = parts[at]
        parts[at : at + 1] = node["split"]
    return parts


def plan_agents(alone: set[int], tree, available: set[int], agents: int) -> list[tuple[tuple[int, ...], str]]:
    own = sorted(n for n in alone if n in available)
    rest = prune(tree, available)
    slots = agents - len(own)
    if rest is None:
        slots = 0
    elif slots < 1:
        raise SystemExit(f"--agents {agents} leaves no subagent for the grouped lanes: {len(own)} lanes run alone")
    out = [((n,), "runs alone") for n in own]
    if rest is not None:
        for part in cut(rest, slots):
            out.append((tuple(lanes_of(part)), "one lane" if isinstance(part, int) else part["reads"]))
    return out


def authority(out_dir: Path, remote_host: str | None) -> str:
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
            f"- The one thing you may write is your report: one file per assigned lane at {out_dir}/lane_NN.md (NN = two-digit lane number), in exactly the shape required above (a `## lane_NN` heading, then `### Started from`, `### Evidence read`, `### Findings`, `### Not established`, each once and in that order, every finding carrying an `owner:` line, and each finding's observation and its inferred cause as separate sentences). Write nothing else anywhere.",
            "- Write `owner:` only on a finding's own owner line. The report validator takes the first word after any `owner:` on any line as a finding owner, so a sentence like \"the projection owner: add a ...\" is refused.",
            "- Do not read any other lane's prompt or report. Work each assigned lane as its own independent investigation; a conclusion from one lane is not evidence in the other.",
            remote,
            "- Keep each lane's report to about 1,500 words at most.",
            "- When your report files are written, reply with only: for each lane, its number and one line per finding headline, plus anything you could not read or settle.",
        ]
    )


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

    assignment = find(lambda l: l == "# Your assignment", 0, "`# Your assignment` heading")
    starts = find(lambda l: l.startswith("startsFrom:"), assignment + 1, "`startsFrom:` line")
    report = find(lambda l: l.startswith("Report one clearly separated"), assignment + 1, "report paragraph")
    body0 = find(lambda l: re.match(r"^\*\*\d+\. ", l) is not None, assignment + 1, "`**N. Title.**` lane body")
    auth = find(lambda l: l.startswith("Authority:"), body0, "`Authority:` paragraph")
    return {
        "prefix": lines[: assignment + 1],
        "startsFrom": lines[starts],
        "report": lines[report:body0],
        "body": lines[body0:auth],
    }


def compose(lanes: Path, pair: tuple[int, ...], out_dir: Path, remote_host: str | None) -> tuple[str, str]:
    parts = [parse(lanes, n) for n in pair]
    nums = [f"{n:02d}" for n in pair]
    name = "lanes_" + "_".join(nums) if len(pair) > 1 else f"lane_{nums[0]}"
    out = list(parts[0]["prefix"]) + ["", f"assignedSession: {name}", f"assignedLanes: {', '.join(nums)}"]
    out += [p["startsFrom"] for p in parts]
    out += ["assignmentKind: grouped semantic review" if len(pair) > 1 else "assignmentKind: single semantic review", ""]
    out += parts[0]["report"]
    for p in parts:
        out += p["body"]
    out += [authority(lanes / "native-output", remote_host), ""]
    return name, "\n".join(out)


def check(text: str, pair: tuple[int, ...]) -> list[str]:
    bad = []
    if text.count("# Your assignment") != 1:
        bad.append(f"{text.count('# Your assignment')} assignment headings")
    if "## Run overview" not in text:
        bad.append("no `## Run overview`: the shared instructions did not reach the composed prompt")
    authorities = len(re.findall(r"^Authority[ (:]", text, re.M))
    if authorities != 1:
        bad.append(f"{authorities} Authority paragraphs; a lane body kept its own")
    for n in pair:
        if not re.search(rf"^\*\*{n}\. ", text, re.M):
            bad.append(f"lane {n} body missing")
    if "trace-challenge-packet" in text and pair != (23,):
        bad.append("private trace-challenge packet named outside lane 23")
    return bad


def parse_pairs(spec: str) -> list[tuple[int, ...]]:
    return [tuple(int(x) for x in group.split("+")) for group in spec.split(",") if group]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--lanes", required=True, type=Path, help="<review>/lanes, which holds prompts/lane_NN.md")
    how = ap.add_mutually_exclusive_group(required=True)
    how.add_argument("--agents", type=int, help="total number of subagents; lane-groups.json decides which lanes share one")
    how.add_argument("--pairs", help="explicit groups, each lanes joined by +, e.g. 1+8,2+34,5")
    ap.add_argument("--groups", type=Path, default=DEFAULT_GROUPS, help="the lane-group file (default: references/lane-groups.json)")
    ap.add_argument("--remote-host", help="ssh host a lane may read, read-only, for evidence not mirrored locally")
    ap.add_argument("--out-dir", type=Path, help="where the composed prompts go (default <lanes>/pairs)")
    args = ap.parse_args()

    lanes = args.lanes.resolve()
    out_dir = (args.out_dir or lanes / "pairs").resolve()
    available = {int(m.group(1)) for p in (lanes / "prompts").glob("lane_*.md") if (m := re.match(r"lane_(\d+)\.md$", p.name))}
    if not available:
        print(f"no single-lane prompts under {lanes / 'prompts'}; run build-manifest.ts --transport native first", file=sys.stderr)
        return 1
    alone, tree = load_groups(args.groups)

    if args.pairs:
        plan = [(g, "named by the operator") for g in parse_pairs(args.pairs)]
        named = [n for g, _ in plan for n in g]
        problems = []
        if len(named) != len(set(named)):
            problems.append("a lane appears in more than one group")
        for g, _ in plan:
            if len(g) > 1 and set(g) & alone:
                problems.append(f"group {g} groups lane(s) {sorted(set(g) & alone)}, which run alone")
            problems += [f"lane {n} has no prompt" for n in g if n not in available]
        if problems:
            print("\n".join(problems), file=sys.stderr)
            return 1
        # A lane with a prompt that no group names runs alone, so no owed lane goes unassigned.
        plan += [((n,), "runs alone") for n in sorted(available - set(named))]
    else:
        if args.agents < 1:
            print("--agents must be at least 1", file=sys.stderr)
            return 1
        plan = plan_agents(alone, tree, available, args.agents)
        if len(plan) < args.agents:
            print(f"note: {len(available)} lanes fill only {len(plan)} subagents, not {args.agents}", file=sys.stderr)
    for g, reads in plan:
        if len(g) >= WIDE_GROUP:
            print(f"note: {len(g)} lanes in one subagent ({reads}); reports get thin and the lanes stop being independent", file=sys.stderr)

    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "groups.json").write_text(
        json.dumps([{"session": f"lanes_{'_'.join(f'{n:02d}' for n in g)}" if len(g) > 1 else f"lane_{g[0]:02d}", "lanes": list(g), "reads": reads} for g, reads in plan], indent=1) + "\n"
    )
    failed = False
    for g, reads in plan:
        name, text = compose(lanes, g, out_dir, args.remote_host)
        (out_dir / f"{name}.md").write_text(text)
        bad = check(text, g)
        failed |= bool(bad)
        print(name, json.dumps({"lanes": list(g), "reads": reads, "chars": len(text), "problems": bad}))
    print(f"{len(plan)} prompts for {sum(len(g) for g, _ in plan)} lanes in {out_dir}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
