# Prompt Shapes

Use this mode when choosing, vetting, or expanding the one-line run prompt, or when predicting what
queries the resulting Built Harness must handle. The run input is one line plus optional `--context`
paths; the system owns everything after it.

## Classify the line

Pick one shape:

- **A — field of tasks.** It names a kind of work and no single instance, such as “writes duty
  rosters”. Expect varied instances at rising difficulty.
- **B — single build.** It names one product and its components. Expect every named component to
  remain while conditions, constraints, sequences, quantities, and failures vary.
- **C — site plus agent.** It supplies or presumes a context artifact and asks for work inside it.
  Expect every task to remain anchored to the supplied site and verified against its facts.

If the line fits none, it usually contains more than one request; narrow or split it before launch.
Ten worked examples live in `docs/initial-prompts.md`; the Builder's active shape rules live in the
representation block of `src/author/builder-session.ts`.

## Vet before launch

1. Keep the request one line. Detail belongs in its nouns or explicit `--context`, not a custom
   driver.
2. Shape C requires the actual context paths and wording that says they are the context.
3. Shape B must name components that must survive into the task family; implied components are not
   protected anchors.
4. State an in-use meaning—respond, remain feasible, reach an end state—so the battery measures
   operation under conditions rather than assembly alone.

## Predict the query field

Before launch, write four to six representative queries:

- A: varied instances across the domain's difficulty axes;
- B: the full build plus changed constraints, events, failures, or quantities;
- C: different jobs at the same supplied site, including redesign and consequences of changes.

After the run, compare these predictions with recorded task families. A missing family is a Builder
or rule gap, not permission to hand-edit the generated bundle. Do not stuff the query list into the
one-line prompt, and do not treat it as measured evidence. When a run keeps prediction notes, record
the list in `notes/predicted-improvements_run<NN>.md`.
