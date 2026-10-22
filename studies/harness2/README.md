# Anabasis on WorkBuddy-Bench Code, then against Harness²

**First claim.** Under a fixed build budget, Anabasis produces a frozen harness that improves
performance on an independently written benchmark, without access to the benchmark's tasks or
grades during its campaign.

A campaign climbs on an exam its own Examiner writes and its own checks grade. A climb that
carries over to an exam nobody in the loop wrote is the strongest external check of it. Anabasis's
distinctive property here is learning without benchmark-provided grades: it still learns from
verdicts, but from checks it generated itself. The second question, once the first has an answer,
is how a harness built that way compares with Harness², which adapts on each scored task.

This is a protocol. No benchmark task has run under it. Its level is kept in `docs/plan.md`
(row X1). How to run it is under "Running it".

## What Harness² is

Harness² (Google Research, `google-research/harness2`, read at commit `1cfe254e` of 13 October 2026;
paper arXiv 2610.14224) improves the harness around a fixed executor model on each task of a
benchmark while it solves that task.

- **Task-level recursion.** For one task it runs the base harness, proposes edits, probes them by
  running them on the same task, composes refined harnesses from the contrasts between runs, and
  delivers. With `--k K` that is `4K` rollouts and `3K` improver sessions per task (the help text
  of `--k`, `harness2/cli/_common.py`). At `K > 1` a selector model chooses one of the final
  deliverables, blind to which harness made it.
- **Harnessing-level recursion.** After each task it keeps the adopted harness and the lessons the
  contrasts supported in a library per domain. Tasks of a domain run as one ordered stream and read
  only earlier entries; the library starts empty for each stream, so a stream's task outcomes
  depend on one another.
- **No grade reaches the optimiser.** A guard refuses any working directory holding a grader
  verdict, rubric or score (`assert_no_grader_verdicts`). The benchmark's verifier scores only the
  delivered output.
- **Roles.** Editor and selector: Claude Opus 4.8 under OpenCode at high effort. Executors:
  Gemini 3.5 Flash and GLM-5, each under OpenCode and under Codex.

On WorkBuddy-Bench the paper splits each subset in half by category and reports the test halves:
40 of the 80 Code tasks. A task's score is the share of its verifier's checks that pass, hidden
tests and file checks for Code. The train halves are used only by Meta-Harness, a separate offline
search method. Each number is a mean over three streams in shuffled order, with the standard
deviation over streams in brackets (paper, Table 1, Code column):

| Executor | Base | Meta-Harness (offline, train half) | Harness² `k=1` | Harness² `k=5` |
| --- | --- | --- | --- | --- |
| Gemini 3.5 Flash, OpenCode | 73.4 (3.6) | 75.5 (1.7) | 76.5 (1.3) | 80.8 |
| Gemini 3.5 Flash, Codex | 74.0 (1.7) | 74.6 (3.3) | 79.4 (3.6) | 81.0 |
| GLM-5, OpenCode | 58.4 (5.2) | 69.0 (1.2) | 77.1 (2.7) | 81.9 |
| GLM-5, Codex | 56.8 (2.7) | 76.8 (1.9) | 74.9 (1.5) | 77.2 |

The `k=5` column adds the paper's "+ Recursion" change to the `k=1` mean; the paper prints no
deviation for it.

## Exposure, named exactly

| Arm | Benchmark tasks seen while building | Benchmark grades seen | Adapts on the scored task | Frozen before scoring |
| --- | --- | --- | --- | --- |
| Starter | none | none | no | yes |
| Description only | none: a prompt built from the benchmark's public description | none | no | yes |
| Unlabelled training examples | the train half's task inputs, given to the Examiner as examples, without tests, rubrics or solutions | none | no | yes |
| Harness² | the test half, one task at a time, as it is scored | none | yes | no |
| Meta-Harness | the train half | the train half's | no | yes |

The two Anabasis arms differ only in the examples, so their difference measures what knowledge of
the target distribution adds. No pair in this table isolates what the benchmark's grades are worth:
Meta-Harness differs from Anabasis in its optimiser and its tasks as well as its labels. That
question needs one learning procedure run with and without grades, and is left out here.

## Stage 1: does the climb transfer?

Three arms, the same 40 Code test tasks, scored by the benchmark's own verifier:

| Arm | What is scored |
| --- | --- |
| S. Starter | pi's coding agent as pi releases it, the first reference of every campaign |
| D. Description only | The reference harness at the typed ending of a fresh campaign opened from the description prompt |
| U. Unlabelled training examples | The same, from a campaign whose Examiner also reads the train half's task inputs |

Both learned harnesses are frozen at their campaign's ending and never edited after. A campaign
that ends without a promotion has the starter as its reference, and scores as S: that is a
result, reported as such.

S is pi's starter, not the OpenCode base the paper reports, and its score on these tasks is
unknown. A gain over a weaker starter is easier to show, so S's absolute score is printed beside
the paper's OpenCode base (73.4 with Gemini 3.5 Flash) for context, and the claim is worded as a
gain over pi's starter.

**One runtime from practice to scoring.** A harness that learns under one executor and is scored
under another can lose its tools and middleware in the move, and a poor score would then have
several causes. So stage 1 practises and scores under the same runtime: pi with the harness
unchanged (guide, programs and tools), the same solver model through the same provider, inside
WorkBuddy's container through a Harbor agent that runs pi. The starter is scored the same way, so
the three arms differ only in the harness. The solver is Gemini 3.5 Flash through the OpenRouter
backend (`src/agent/backends/models.ts`), in the campaigns and in the container alike. pi's catalogue
prices it ($1.50 in, $9 out per million tokens) with a context of 1,048,576 tokens, so the meter
and the default solver window both accept it. GLM-5 is listed with a 198,000-token context and
would need a `--solver-window` below that. Harness²'s WorkBuddy runner gives its solver the effort
`high` (`OPENCODE_VARIANT`, `harness2/benchmarks/workbuddy.py`, and `reasoning_effort` in the
models file `harness2/install.py` writes), so the campaigns run the solver at `--solver-effort
high`, and the container's agent asks the same. Whether WorkBuddy's verifier and its Harbor runtime accept an executor
that Harness²'s setup did not configure was the first question. Harness²'s setup writes Vertex
routes alone (`workbuddy_models`, `harness2/install.py`), so the study's setup runs every other step
of it and writes its own route to the OpenRouter model. On 21 October WorkBuddy's own dry run
resolved a job of the study's shape with that route, the `anabasis-pi` harness and the job's proxy,
against a placeholder task. No container has run it yet. pi also has a Vertex provider, if the
provider is to match Harness²'s too.

**The task interface still differs.** A campaign's solver reads a task's JSON inputs, writes
`answer.json` and calls `submit`; a WorkBuddy solver reads `instruction.md` in a repository and
leaves a diff in it. A harness whose guide or tools speak of `answer.json` meets a task in another
shape at scoring, and that gap remains even with the runtime held fixed. D's and U's prompts
therefore ask for tasks whose answer is a patch to a repository given in the inputs, so that what a
harness learns is about patches, and the gap is reported with the scores. The other way to close
it is to put each WorkBuddy test task through Anabasis's own solve path, with the solver's diff
then applied and scored in WorkBuddy's container. That keeps every solve identical to a
campaign's, but the solver then works without the container's installed environment. The
container route comes first, because the environment is part of what the benchmark measures.

**The solve budget matches.** The benchmark's executor took 29.6 steps per Code task under OpenCode
at base, and Anabasis's default solve is 20 model turns and 30 minutes (`LIMITS`,
`tools/d2/campaign.ts`), fixed in a campaign's setting. D and U open with the turn limit and wall
the container will give each scored solve, so a harness is built for the budget it is scored at.

**The build budget is fixed** before either campaign opens: the same total in dollars
(`--budget`), the same Builder and Examiner model (Claude Opus 4.8, Harness²'s editor), the same
patience. A campaign
that ends on its budget and one that ends on its patience are both read at their ending.

**Network.** Every Anabasis seat can reach the network (`AGENTS.md`, section 10). A seat's wall can
only open or close the network as a whole (`network`, `src/wall/base.ts`), so for D and U
the host blocks `huggingface.co`, `hf.co`, `*.hf.co` and the benchmark's GitHub repositories by DNS
or an egress rule, as Harness² advises for its own executor, and the container is blocked the same
way in every arm. In Harness²'s own validation a Codex rollout on JobBench downloaded its task's
rubric unasked. The restrictions are reported with the results.

**Domain fit.** An Anabasis task is a JSON input with hidden values, its answer is `answer.json`,
and its checks run in verifier cells with the network closed (`src/kernel/task.ts`,
`src/kernel/verify.ts`). A Code task in WorkBuddy is a diff against a real repository, judged by
hidden tests. For D or U to practise on anything like it, the Examiner has to draft an exam whose
tasks carry a small repository in their inputs and whose checks apply a patch and run tests inside
a cell. Whether a drafted exam can do that, and whether the cells hold the interpreters it needs, is
unverified. If it cannot, the Code subset is the wrong place to start, and the Office subset, whose
deliverables are files on disk, is the next candidate.

## Stage 2: against Harness²

Once stage 1 has a result, Harness² `k=1` joins, rerun on the same 40 tasks rather than read from
the paper. It runs on its own executor (OpenCode), since it cannot run on pi, so this comparison
crosses runtimes, and it is read only against the OpenCode base rerun beside it. To set a learned
Anabasis harness on OpenCode beside it, the harness is translated into Harness²'s editable tree
(the guide into the always-on files, programs into `scripts/` or skills, `tools.ts` into an OpenCode
plugin where one is possible) through a patch kept in `wb/` that lets a run start from a given tree.
That result is reported as the transfer of an exported Anabasis harness, with what the translation
dropped listed beside it. The export reproducing the starter's score shows the export path works,
and nothing about whether learned tools keep their behaviour.

Harness² `k=5`, Meta-Harness and Harness² started from an Anabasis harness wait until stage 2 has
read.

## Metric and statistics

- **Primary result.** The difference in mean benchmark score between two arms, in percentage
  points, with its uncertainty. The share of a gap closed is not reported, since it is unstable
  where the gap is small.
- **Closeness.** A claim that one arm "gets close" to another needs a margin fixed before the
  arm's first scored solve. Failing to find a difference does not show the two are close.
- **Solve variation and build variation are kept apart.** Each frozen harness is scored in three
  streams, which measures solve variation for that harness. One campaign per arm is a pilot. A claim
  about the method needs independent campaigns of each arm under the same build budget, and its
  uncertainty is read across campaigns.
- **Intervals.** For a frozen harness every solve runs in a fresh container, so tasks are
  resampled independently. Harness²'s outcomes within a stream are dependent through its library,
  so its uncertainty is read by keeping each stream whole, and its three streams are reported one
  by one.
- **Paired test.** Each task's difference in mean score between two arms, read with the one-sided
  paired sign-flip test a campaign uses (`flipP`, `src/kernel/compare.ts`). `flipP` builds its
  distribution over integer margins, so each difference is first put in whole units: hundredths of
  a task's score, summed over its three streams. S scored twice, in two sets of streams, is the
  A/A: it should read no step, and its spread is the noise every other pair has to beat.

## Economy, apart from quality

Each arm reports its score beside its cost to serve N tasks: build cost plus N times the serving
cost per task, counting every Builder, Examiner, editor, probe and selector call, in rollouts,
sessions and dollars where the bill records them. A frozen Anabasis harness pays its build once
and one rollout per task; Harness² pays `4k` rollouts and `3k` improver sessions on every task.
A claim that harness refinement beats spending the same inference another way also needs the
paper's control: the base harness run `k` times with the same selector choosing one deliverable
(paper, appendix C, "Best-of-k").

## Order of work

1. **Without a model.** `run.ts setup`, then, on the operator's word that WorkBuddy-Bench's
   licence is accepted, `run.ts setup --dataset`, which fetches the Code subset and writes the
   paper's split.
2. **Without a model.** `run.ts bundle` for the starter, then `run.ts check`: one test task in its
   container through the job's proxy, the solver dry. Then read whether a verifier cell can apply a
   patch and run a test (domain fit). Either failing stops stage 1 as written.
3. **Paid, on the operator's word.** S in two sets of three streams on the 40 tasks: the A/A.
4. **Paid, on the operator's word.** Campaigns D and U, each opened fresh at a published commit and
   run to a typed ending under the fixed build budget (`AGENTS.md`, section 10, item 9); then their
   frozen harnesses scored in three streams each.
5. Stage 2, on the operator's word.

## Running it

`run.ts` is the one entry point; its head comment lists the verbs and their flags. Everything the
benchmark brings stays in the ignored `studies/external/`:

- `harness2/` is Harness² at its pin. `run.ts setup` installs it in its own venv and runs its own
  setup steps for WorkBuddy-Bench (`clone`, `patch` and `overlays`, `harness2/install.py`), which
  leave WorkBuddy-Bench at Harness²'s pin in `harness2/dependencies/workbuddy-bench/`, with
  Harness²'s patch applied. That pin runs Harbor 0.18.0.
- The study then adds what `wb/README.md` lists, writes its route to the solver, and installs
  WorkBuddy-Bench's own environment.
- `harness2-work/` holds each arm's mount (`run.ts bundle`, `bundleArm`), the free checks, and the
  job folders of every scored run.

An arm is a frozen harness, the starter or a kept one, bundled once with the container solver
compiled for the container (`../shared/bundle.ts`). WorkBuddy's runner starts every trial in a
fresh container. In it, the study's Harbor agent (`../shared/harbor/pi_agent.py`) runs the solver
(`../shared/pi-solve.ts`), which answers with pi's coding tools inside the harness. The solver
reaches the model through the job's own proxy on the host, as Harness²'s OpenCode arm does, so
the provider's key never enters a container. It leaves its trace, its ATIF trajectory and its
result in the trial's `agent/` folder. Docker must run on the host, and a scored run takes hours,
so it runs on a runner with room, never under a live campaign.

`run.ts score` records each run in the tracked `studies/runs/harness2/<run>/<arm>/`: the terms
(commit, pins, arm, solver, limits, streams, tasks), the job it ran, and every trial with its
score, ending, bill, turns, calls and seconds. The scores are read by Harness²'s own reader in
its venv (`trials.py`), and the spend from the solver's own trace by the kernel's readers
(`../shared/scores.ts`). `run.ts read` sets two arms beside each other, or one arm's streams split
in two, the A/A, as "Metric and statistics" says.

## Predictions

None is recorded yet. Each paid step commits its prediction here before its first solve. The
authoring session proposes, for step 4: "D's mean over three streams is above S's on more of the
40 tasks than it is below, and U's mean is at least D's." The operator may replace it.

## Decisions waiting for the operator

- Whether to run at all, the build budget per campaign, the cap per scoring run, and which
  provider account pays.
- Accepting WorkBuddy-Bench's licence, a custom Tencent licence with a territorial limitation,
  and whether it allows the study's trajectories, which quote each task's instruction, to be
  committed under `studies/runs/harness2/`. Until it is settled a run's record keeps its scores,
  bills and terms, and its trajectories stay in the ignored clone.
- The closeness margin, if a "gets close" claim is wanted.
- The wording of D's prompt and the choice of U's examples.
