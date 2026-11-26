# Studies

This directory holds evaluations of Anabasis conducted outside a campaign's own held-out comparisons: external transfer against another system on a published benchmark, or controlled ablations with one mechanism disabled. Each study lives in its own subdirectory named after the comparison and begins with a pre-registered protocol written before the first solve.

A campaign promotes solely through its held-out comparison (`AGENTS.md`, rule 1). A study promotes no harness, alters no reading, and steers no campaign. It answers a separate question (such as whether a harness built without seeing a benchmark transfers to it), and any resulting claim follows the evidence rungs in `AGENTS.md` §9.

## Layout of a study directory

- `README.md`: the pre-registered protocol stating the research question, arms, information boundaries, held-constant conditions, scoring metric, statistical test, and known confounds before any solve runs.
- Pre-registered predictions: count-based falsifiable criteria committed before solve 1 (`AGENTS.md` §10).
- Opening prompts, where an arm launches a fresh campaign.
- Adapter code, held to the same lint, formatting, and size policies as the rest of the repository. Reusable host mechanisms belong in `src/` or `tools/` instead of inside a study folder.
- External-system entry point (`run.ts`): `setup` clones the peer system into `external/<system>/` at a pinned commit and applies any local edits from an explicit `git diff` beside `run.ts`. Scoring runs inside the peer system's own evaluation environment instead of re-implementing its grader.
- Result summaries: exact counts, conditions, commit SHA, and runner profile.

Two sibling directories serve every study. `shared/` holds code reused across multiple studies. `runs/<study>/` stores tracked per-run records (job terms, per-task scores and trajectories, spend, commit, and runner) so results remain auditable, including failed or interrupted attempts (`AGENTS.md` §10).

## Local clones and wall containment

Peer codebases, downloaded benchmarks, and raw benchmark job directories live under gitignored `studies/external/<system>/` so new studies need no `.gitignore` edits. Keeping clones inside the checkout places them behind every seat's OS isolation wall (which denies the repository and its worktrees), preventing blind arms from reading benchmark tests or rubrics. Clones placed outside the checkout would lack that wall.

Each clone belongs to one worktree and disappears on worktree removal, `git clean -fdx`, or idle retirement. Copy finished run records into `runs/` before cleanup; `run.ts setup` reproduces the clone.

## Excluded from study directories

- Campaign logs, raw traces, and kept harnesses. They remain in `.ana/` and `data/runs/`, which hold hidden task values behind the wall.
- Peer source trees, benchmark tasks, rubrics, and hidden tests. Benchmarks carry their own licences and stay inside the ignored clone; each study protocol states before committing whether benchmark licences allow publishing trajectories that quote task prompts.
- Credentials, provider accounts, host names, or operator-local machine paths.

Study status (`planned`, `present in source`, and higher rungs) is tracked once in `docs/plan.md` instead of repeated here.
