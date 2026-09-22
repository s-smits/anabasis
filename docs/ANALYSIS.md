# Related public systems

A survey of public work near Anabasis, taken on 15 August 2026 across recent arXiv papers, open-source
repositories and company documentation.

Read it as research, not as evidence. The citations were collected in one pass and were not
independently checked against the papers and repositories they name. Private or internal systems at
the large labs would not appear here at all, so this document says nothing about what exists
unpublished. The field is moving quickly enough that the survey should be repeated monthly rather
than trusted for a year: HarnessOpt-Bench appeared on 6 August, HSI on 9 August, SBCO on 10 August
and EvolveNet on 5 August 2026.

## The finding

No publicly documented system was found that matches Anabasis end to end. A large number of systems match
major parts of it.

The part that is no longer unusual is the self-improving harness itself. In 2026 that is a research
category with several entries: Meta-Harness searches harness code from traces; Self-Harness does
weakness mining, bounded harness changes and regression validation; HarnessFix performs trace-level
attribution and scoped harness repair; NeoSigma's `auto-harness` mines failures, edits the agent,
maintains a regression suite and gates changes; Canvas's `meta-agent` optimises whole harness
programs, including evaluator harnesses; Adaptive Auto-Harness evolves harnesses over open-ended
task streams instead of a fixed one-shot benchmark. ([1][1])

## What was not found together in one loop

- **The evaluation is generated from the user's request.** Anabasis is not handed TauBench, TerminalBench
  or SWE-bench and told to optimise against it. The Builder authors the harness and the
  task and evaluation side. Meta-Harness, Self-Harness, HarnessFix, Canvas meta-agent, NeoSigma,
  RHO, A-Evolve and Adaptive Auto-Harness each start from an externally supplied evaluation
  environment or task stream. ([1][1])
- **Harness evolution and evaluation evolution are separate experimental axes.** Anabasis can rebuild the
  harness from recorded advice, or climb by changing task difficulty with the harness frozen, and the
  source enforces different identity invariants for `build` and `climb`. Adaptive
  task-generation work exists, Socratic-SWE in particular, but there the adaptive curriculum
  generates training tasks for the solver rather than acting as a separate adoption-controlled
  evaluation axis around an adopted harness. ([2][2])
- **Generated verification does not own truth through a model.** Anabasis keeps the generated
  evaluator and verifier, deterministic host scoring, and the Main Judge census around them, while
  adoption stays code-owned. That separation is stricter than the usual design in which a model
  judge supplies the reward. A Judge disagreement enters only through a finding and cannot modify
  a score or an adoption.
- **Evaluation saturation is attacked explicitly.** When the solver keeps succeeding, the
  difficulty machinery climbs, can detect a saturated unchanged harness, and eventually reopens the
  evaluation or the harness. The saturation rule exists for the orthogonal failure: a high score
  may mean the generated evaluation narrowed around what the harness already does. Failure-driven
  optimisers are common; treating success itself as evidence that the exam may be inadequate is
  not.
- **Adoption is a governed experiment rather than a rewritten prompt.** Current and candidate
  identities, held candidates, task freshness, a fixed harness during a climb, family regression
  checks, recorded evidence and explicit adoption sit in one controller. The strongest modern
  harness-optimisation work resembles this; Anabasis applies it while the evaluation is also endogenous.

## The closest systems found

| System | How close to Anabasis | The missing piece |
| --- | --- | --- |
| **autocontext** | The closest product-level concept. It starts from a plain-language goal, can generate or select a scenario and a verifier, runs several improvement roles, gates results, keeps knowledge, and can propose tooling or harness changes. ([3][3]) | No build-versus-climb experimental separation, no generated deterministic verifier behind an advisory judge wall, no frozen-harness capability sequence. Its durable product is accumulated knowledge, playbooks and tools rather than a jointly governed adopted harness and evaluation. |
| **OpenComputer** | The closest evaluation-builder half. It authors verifier endpoints, smoke-tests and repairs them, generates machine-checkable tasks, and runs an auditable evaluation harness. ([4][4]) | It builds evaluation worlds for computer-use agents. It does not also evolve the target agent harness through rebuild, adoption and climb. |
| **NeoSigma auto-harness** | A very close repair loop: run the benchmark, inspect failures, edit the harness, maintain a live evaluation suite, gate on regression and full tests, repeat. ([5][5]) | Benchmark and evaluator are supplied. It does not construct the exam from the original user intent, and it does not climb it. |
| **Canvas meta-agent** | Whole-program harness search from execution traces with held-out acceptance, and it can optimise evaluator harnesses. ([6][6]) | Agent and evaluator harnesses are optimisation targets against external benchmarks. It does not construct and evolve a domain evaluation from an arbitrary request. |
| **Self-Harness** | Weakness mining, minimal harness proposals, regression validation. Philosophically close to Anabasis's advice-driven rebuild. ([7][7]) | A fixed Terminal-Bench evaluation, no Builder-Correctness Model evaluator or battery, no climb. |
| **HarnessFix** | The closest analogue to Anabasis's owner routing: it compiles trajectories, attributes failures to harness layers, consolidates flaw records, chooses scoped repair operators, then validates patches. ([8][8]) | The evaluation is again external and fixed. |
| **Adaptive Auto-Harness / A-Evolve** | Persistent self-improvement, several harness branches, task-wise routing, continual adaptation on open-ended streams. A-Evolve states zero-manual-engineering harness evolution as its goal. ([9][9]) | The stream supplies the tasks and rewards. These systems adapt to an external world instead of also constructing the measuring instrument. |
| **SBCO** | Close on another axis: it jointly learns a decomposed verifier bank and a harness policy from verified feedback without human labels. ([10][10]) | A domain-specific planning optimiser, with no arbitrary-request evaluation construction and no v4-style curriculum or adoption machinery. |

## Two worth watching

**autocontext** deserves the closer read. Its public documentation states that it can take a
plain-language goal, generate the scenario and the verifier, run a self-improving multi-role loop,
gate changes and keep what survives. ([3][3]) Conceptually that is nearer to Anabasis than Meta-Harness or
Self-Harness. Its public architecture still points somewhere else: construct an evaluable scenario,
then improve strategies, knowledge and tools against it. Anabasis constructs a measuring instrument and an
agent together, distrusts both, audits the instrument independently, moves its difficulty while the
agent is frozen, rebuilds the agent from recorded advice, and lets only deterministic
controller evidence decide which state becomes canonical.

**OpenComputer** is close to the mirror image of Anabasis: verifier authoring, live smoke execution,
verifier repair, task generation, deterministic evaluation, with a stated preference for programmatic
state verification over model judgement. ([4][4]) If OpenComputer added autonomous target-harness
improvement, and NeoSigma or Canvas added automatic evaluator and curriculum generation, they would
converge on the same place from opposite directions.

The field is also arriving at several Anabasis design choices on its own. A July paper, Self-Evolving Agent
Harnesses via Gated Semantic Quality-Diversity, separates model-generated diagnosis and patches from
deterministic sampling, measurement and significance testing, so the model proposes and code credits
the improvement. ([11][11]) A July continual-learning study found that optimiser gains compounded
only when regression control was part of the loop. ([12][12]) Anchor addresses evaluator-generation
drift by generating instruction, environment, solution and verifier from one specification, which is
another answer to the problem Anabasis meets whenever tasks, public contracts and verifiers drift apart.
([13][13])

## How to state the position

Not: Anabasis invented self-improving agent harnesses. That would be false in 2026.

Rather: Anabasis is a self-improving agent whose evaluation harness is endogenous. From an arbitrary
request it constructs an agent and its verifiable exam, then evolves the agent and the exam
separately under frozen-variable experiments, deterministic evidence and adoption authority,
semantic diagnosis, and explicit protection against both regression and evaluation saturation.

No public implementation of that whole combination was found. The ingredients exist almost
one for one around the world, mostly in separate projects. Anabasis currently looks less like a new
primitive and more like a composition of four research lines — auto-harness optimisation, automatic
verifier and evaluation construction, adaptive curriculum generation, and evaluator governance —
inside one closed controller. ([8][8])

[1]: https://arxiv.org/abs/2603.28052 "Meta-Harness: End-to-End Optimization of Model Harnesses"
[2]: https://arxiv.org/abs/2606.07412 "Socratic-SWE: Self-Evolving Coding Agents via Trace-Derived Agent Skills"
[3]: https://autocontext.ai/docs "Introduction | autocontext docs"
[4]: https://github.com/echo0715/OpenComputer "OpenComputer"
[5]: https://github.com/neosigmaai/auto-harness "neosigmaai/auto-harness"
[6]: https://github.com/canvas-org/meta-agent "canvas-org/meta-agent: continual harness optimization"
[7]: https://arxiv.org/abs/2606.09498 "Self-Harness: Harnesses That Improve Themselves"
[8]: https://arxiv.org/abs/2606.06324 "From Failed Trajectories to Reliable LLM Agents: Diagnosing and Repairing Harness Flaws"
[9]: https://arxiv.org/abs/2606.01770 "Adaptive Auto-Harness: Sustained Self-Improvement for Agentic System Deployment on Open-Ended Task Streams"
[10]: https://arxiv.org/abs/2608.10157 "SBCO: Self-Supervised, Verifier-Grounded Harness Optimization For Planning Agents"
[11]: https://arxiv.org/abs/2607.13683 "Self-Evolving Agent Harnesses via Gated Semantic Quality-Diversity"
[12]: https://arxiv.org/abs/2607.14004 "Do Agent Optimizers Compound? A Continual-Learning Evaluation on Terminal-Bench 2.0"
[13]: https://arxiv.org/abs/2605.26321 "Anchor: Mitigating Artifact Drift in Agent Benchmark Generation"
[14]: https://arxiv.org/abs/2608.06301 "HarnessOpt-Bench: Evaluating LLMs at Harness Optimization"
