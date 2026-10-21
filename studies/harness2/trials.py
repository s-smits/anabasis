"""WorkBuddy-Bench Code read by Harness²'s own readers, one JSON line each, for `run.ts`.

`tasks` prints the test half, as Harness² picks it: `select` reads the Code tasks from the split
file `scripts/split_tasks.py` wrote. `trials` prints every trial of a job folder with its score:
`_trials_in` finds each task's trials across the folder's runs (resolving Harbor's 32-character
trial names), and `score_from_payload` reads the verifier's `score.json` by the benchmark scorer's
precedence, null where it gives none. A null is a non-result and is counted apart, never as a zero.
So both arms of a comparison are picked and scored by the functions Harness² scores its own
rollouts by, and porting their precedence to TypeScript would have made a second reader of one
file. `run.ts` runs this in Harness²'s own venv:

    .venv/bin/python -I trials.py tasks <split file>
    .venv/bin/python -I trials.py trials <job folder> <split file>
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

from harness2.benchmarks.tasks import discover, select
from harness2.benchmarks.workbuddy import _json_or_none, _run_dirs, _trials_in, score_from_payload

SUBSET = "code"


def tested(split: Path) -> list[str]:
    return select(discover("wb", SUBSET), "test", split, benchmark=f"wb-{SUBSET}")


def trials(jobs: Path, split: Path) -> None:
    for task in tested(split):
        for trial in _trials_in(_run_dirs(jobs), task, SUBSET):
            payload = _json_or_none(trial / "verifier" / "score.json")
            score = None if payload is None else score_from_payload(payload)
            print(json.dumps({"task": task, "trial": trial.name, "path": str(trial), "score": score}))


if __name__ == "__main__":
    if len(sys.argv) == 3 and sys.argv[1] == "tasks":
        for task in tested(Path(sys.argv[2])):
            print(json.dumps(task))
    elif len(sys.argv) == 4 and sys.argv[1] == "trials":
        trials(Path(sys.argv[2]), Path(sys.argv[3]))
    else:
        sys.exit("usage: trials.py tasks <split file> | trials <job folder> <split file>")
