Read this reference to decide whether code or a model owns a given decision, especially before
introducing a limit, classifier, or file-access restriction. It explains the rationale behind
`AGENTS.md` section 2.

## 2. The stance: code owns the conditions, models own the content

Code retains authority over a decision whenever a model cannot observe the relevant facts, whenever
the model itself is the object of evaluation, or whenever a parameter must remain identical across
both arms of a comparison. Models retain authority over domain content because static code cannot
reason about an unseen technical domain. The seven consequences and their justifications are:

1. **Facts rather than directives.** A model given a prescribed course tends to follow the
   instruction even when the evidence contradicts it.
2. **Facts rather than targets.** An author given a numeric target or difficulty zone optimises
   directly towards that target, and an author shown each answer's margin from a resource limit tends
   to shift task limits rather than task substance. The Examiner therefore receives only the
   reference harness's measured outcomes and the solve budget (section 3, "What the Examiner
   reads").
3. **Builder freedom.** The sole content restriction on the Builder is that no part of a harness may
   name a specific task, copy task text, or embed an answer. A harness program may search candidate
   solutions against the public rules, while the solver remains responsible for writing and
   submitting the final answer (`src/builder/prompt.ts`). Because a single compute budget prices
   everything a harness does, secondary resource limits add no useful constraint.
4. **No content classifiers in code.** Code validates declared structural schemas, whereas code
   attempting to judge what a harness or task ought to contain substitutes a brittle heuristic for a
   model decision.
5. **Code owns all execution conditions.** The Builder may request a campaign move, and code decides
   whether admission conditions allow it to start. Whenever a model's output informs a host decision
   (such as a Referee ruling), code specifies the required evidence structure and refuses outputs
   that omit it.
6. **Permissive defaults within strict boundaries.** The wall protects hidden values, credentials,
   and per-seat state. Reads remain open except for explicitly blocked protected roots, and each
   seat writes freely within its own root directory, excluding the host's private folder inside it
   (`SolveDirs`, `src/tools/command.ts`). Every narrower grant creates an additional sandbox policy
   to maintain across macOS and Linux; historical failures (`7f0add79:docs/plan.md`, rows B10, B12,
   B17) show that overly narrow grants repeatedly terminated valid solves while broad grants leaked
   no hidden values. Narrow a grant only where concurrent writes would collide, such as two solves
   writing the same path in a shared `/tmp`. Each sandbox policy is verified by a wall test once per
   process (`walledBase`, `probeWall`).
7. **Prefer the simple mechanism.** Every added mechanism increases the cost of reading, verifying,
   and reversing future changes, so a simple design whose events can be audited directly outperforms
   a complex one that cannot be verified (rule 13). The sole exception is evaluation integrity
   (rules 3 to 8), because a single false promotion costs more than the complexity saved.
