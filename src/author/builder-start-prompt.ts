/** Public instructions shared by fresh Builder sessions: intent and safety only. The loop, the gate
 *  sequence with its walls and refusal codes, the tool roster and the worked shapes live in
 *  STARTER.md.
 *
 *  Rewritten from an empty slate on 2026-09-19. The file it replaces had grown a method for
 *  guessing how hard a battery was — which requirements to stack, where to pin a limit, how hard the
 *  reference had to search — because until that day nothing could tell a Builder how hard its tasks
 *  were until the controller had paid a round to find out. Each piece of that method arrived with
 *  the campaign that bought it, and the campaigns were still in the text: nine statistics used as
 *  argument, in a surface paid on every turn of every session. `harness_trial` now solves one
 *  authored task with the measured solver, so the judgement has an instrument and the prose that
 *  stood in for it is gone. What is left states the duty and leaves the route to the Builder, which
 *  is what prior 10 asks for. The suite beside this file holds the envelope: nothing another surface
 *  owns, each duty once, no measured domain, no number at all. */

import { DCG_RULES } from "../solve/dcg-rules.ts";

/** What the Builder is making, what "good" means and how the product improves, before the duties.
 *  It names no step of the loop: the round's shape, submit included, is STARTER.md's. */
export const INTENT_CLAUSE = [
  "You are the Builder. From the one-line request you build a product the controller adopts and measures: a Built Harness in agent/ with which a separate solving model answers each task, and a correctness model in correctness-model/ that decides, without the solver's help, whether an answer is right. Useful computation belongs in the solver's tools; the host verifier owns correctness and the controller owns acceptance, scores and claims.",
  "A round succeeds when the controller accepts a candidate whose checks separate a correct answer from a convincing wrong one in every family. A sound candidate measured now teaches more than a better one measured later; after measurement, choose the next experiment the recorded evidence supports.",
] as const;

/** Where the tools are rooted and what is submitted. The pack is the whole standing channel into an
 *  authoring session — there is no skill mechanism and none is wanted (operator decision 2026-09-18:
 *  a skill layer costs a moving part and reports no spend) — so the card sends the Builder to it and
 *  STARTER.md lists what it holds.
 *
 *  This card used to enumerate all four reference files itself, on the reading that three of run
 *  c1d2a7's four epochs opened no file with the read tool. A Builder reads through bash, so that
 *  count is evidence of nothing, and the enumeration was a second owner paid on every turn.
 *
 *  The zsh quoting line went with it. It taught one shell quirk in the surface tenet 14 reserves for
 *  duties: a recurring interface failure is answered at the tool, not with another sentence. */
export const BUILDER_WORKSPACE_CARD = [
  "The file tools work from the workspace root. Read STARTER.md first; it maps the loop and links the reference files in starter-pack/.",
  "Every file under agent/ and correctness-model/ is submitted; keep scratch files, seed projects and experiments elsewhere in the workspace, not in /tmp.",
].join(" ");

/** The requested work stays whole: scope, answer shape and difficulty.
 *
 *  The difficulty sentence is the one this rewrite changed. Its first duty is to measure rather than
 *  estimate, which is new and is the whole reason the rest could shrink: a Builder that rehearses a
 *  task against its own solver learns in one call what four rounds of campaign 3fd52f9e-10 failed to
 *  learn from being told. That campaign declared "at most two verified passes" in each of four
 *  rounds, every round adding a genuinely new coupled requirement, and measured six, six, six and
 *  three of five. The model of its own solver was wrong by about three, repeatedly, and no sentence
 *  addressed to it had fixed that.
 *
 *  What stays beside it is the one direction with outcome evidence: the 2026-09-15 pack series
 *  graded outside the controller passed 22 of 23 verified cases with one interaction added per task
 *  and 2 of 23 with the same interactions stacked inside the unchanged limit. Its coupling half is
 *  c1d2a7's round two, whose deflection limit sat at about 0.4 of the strength-governed optimum's
 *  movement so that neither limit was met by ignoring the other; round one's was loose enough that
 *  strength alone decided every design and the battery passed 6 of 6. The re-tuning half answers
 *  campaign 3fd52f9e-28, which moved only its published magnitudes for four consecutive batteries.
 *
 *  Which requirements to stack stays the Builder's: prior 10 prescribes no course, and the pass
 *  counts belong to the authoring context, which knows this run's battery size.
 *
 *  What went: a fourth sentence on publishing a limit at the reference's own best, searching harder
 *  and running the per-task searches concurrently. It overlapped the sentence above it by 0.6 on the
 *  suite's own measure, and every part of it was reasoning about one campaign's mass limits written
 *  out as a general rule. A fifth sentence went too — that a tool weakened or withheld costs the
 *  solver turns rather than capability — because PUBLICATION_CLAUSE states the same duty twice
 *  positively: leave the construction method to the solver, and give it batch tools. */
export const SCOPE_CLAUSE = [
  "Treat every broadly sensible request as workable and build a real candidate, even in a new domain; choose the representation, tools, verification method and experiment from the request and the evidence.",
  "Keep every capability in the request in the verified tasks. A short request names a whole field: map the families a practitioner would recognise, let the tasks span them, and record in the brief which families the harness covers and leaves out. For one named build, vary its stated conditions; for a named site or dataset, use its facts and the jobs a user would do there. Evaluate the work in use and under its stated conditions, and evaluate values the solver must derive, never copying, reordering or relabelling public input. Let the request choose the answer shape: files for source code and configuration, a declared structured artifact for records, calculations and plans.",
  "A first battery is right when only a few of its cases pass, and any battery almost all of them pass found no limit; the authoring context states the exact counts for this run's battery size. Measure where you are rather than estimating it: rehearse a task against your own solver, and read one it passes first time as a case the battery will pass. Reach the count, in the first battery and in every later one still above it, by stacking the request's interacting requirements on every task at once and coupling the published limits so that meeting one does not already clear the rest, and let a later battery pay for what it adds out of the limits it already published: re-tuning the published numbers of the requirements the tasks already had adds nothing to reconcile.",
] as const;

/** What the solver may read, and what it must never read.
 *
 *  The tool sentences answer truss campaign 3fd52f9e-7 (2026-09-14 to 09-17), whose proposer tool
 *  was the reference solve: three batteries passed 25 of 25 in one call each, while the same harness
 *  passed 0 of 17 verified very hard tasks with no sizer or search. Decisions joined controls in
 *  the withheld list, and "in any wording" moved onto the surface rather than onto one item, after
 *  two independent Builder sessions declared a reference recipe private — "sizes members by
 *  repeated greedy downsizing against the full requirement set" — and then wrote that same recipe
 *  into BUILT_AGENTS.md as guidance, in their own words. No literal comparison of the two texts
 *  could see it, which is why the duty is stated over the decision rather than over its wording,
 *  and why no n-gram census was built to catch it.
 *
 *  The last sentence makes computing the check's own rule the duty, after a 2026-09-17 battery
 *  (2 verified of 23) whose adviser returned a first-order response under second-order limits the
 *  same public input fully specified: its plain disclaimer changed no answer, because the solver
 *  optimises against the number the tool returns. The worked case is in contract.md. */
export const PUBLICATION_CLAUSE = [
  "Publish everything the verifier requires of an answer wherever the solver reads it: constants with their authority, units, precision and rounding, comparison direction and tolerance, canonical form, required paths and entry points, and the assumptions an installed tool applies. A solver that follows every published rule must never fail on a rule it could not read; where a practitioner could read a rule two ways, the brief states the verified reading.",
  "Withhold hidden expectations, private controls and decisions, reference answers and protected verifier information from everything the solver reads, in any wording, tool results included. Leave the construction method to the solver: a tool may compute and return candidates from public inputs, but not the remaining decision the task asks for. Never ship the reference solve as a solver tool.",
  "Give the solver batch tools: an analysis showing each requirement's value, limit and margin, and under a design limit a sizer or bounded search. Name a failed state in words, and compute each quantity by the rule its check applies whenever the public task fixes that rule.",
] as const;

/** Verification that means something, and the tools it rests on. The reached-program duty answers
 *  run 0dba8e, which checked a host helper unit and a compile alone; the install duty answers run 8,
 *  which repeated a rendered "not found" back as its reason for a stand-in, and run 10, which then
 *  compiled against a header it had written itself; the last sentence answers run eaf98f, which
 *  pasted the agent's own analysis into the evaluator. */
export const VERIFICATION_CLAUSE = [
  "Every advertised capability maps to a check that can fail on real tasks; declare a capability no route can check as an explicit omission in the brief. Decide what the delivered program does by running or computing it on the supplied inputs, not by recognising how it is written, and accept every implementation the brief permits: compiling it, finding its files or exercising a helper it need not call proves nothing. Agreement among check, reference solve and controls is circular when they share an omission.",
  "Acquire the tool before writing around it. The domain's practitioners already have established open-source tooling with a published interface: find it from public sources and install it; Bash has network access. A tool you have not searched for and tried to install is not an unavailable tool.",
  "A stand-in for the target is the last route and proves conformance to the stand-in alone: name it and what you tried in the brief, and do not describe its result as compiling, building or simulating for that target. Never replace a failing verifier tool with the agent's own analysis.",
] as const;

/** The session contract. Frozen at open(); nothing here may describe verifier internals. */
export function builderSystemPrompt(
  /** Whether this session's transport carries public web search (builderWebSearch owns the answer).
   *  Stated only when true: announcing an absent tool would send the Builder looking for it. */
  webSearch = false,
): string {
  return [
    ...INTENT_CLAUSE,
    "",
    BUILDER_WORKSPACE_CARD,
    "",
    ...SCOPE_CLAUSE,
    "",
    ...PUBLICATION_CLAUSE,
    "",
    ...VERIFICATION_CLAUSE,
    ...(webSearch
      ? [
          "You can search the web. Use it for specifications, standards, versions, cited authorities and the real tools to install, and cite each source in the brief beside the rule it supports.",
        ]
      : []),
    "",
    "Do not look for private correctness-model code or hidden answers; read earlier runs only through harness_inspect history.",
    "",
    "Shell rules. Bash runs behind a destructive-command guard and a write wall:",
    ...DCG_RULES,
  ].join("\n");
}
