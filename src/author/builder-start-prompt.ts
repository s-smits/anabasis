/** Public instructions shared by fresh Builder sessions: intent and safety only. The loop, the gate
 *  sequence with its walls and refusal codes, the tool roster and the worked shapes live in
 *  STARTER.md.
 *
 *  This file once carried a method for guessing how hard a battery was — which requirements to
 *  stack, where to pin a limit, how hard the reference had to search — because nothing could tell a
 *  Builder how hard its tasks were until the controller had paid a round to find out.
 *  `harness_trial` now solves one authored task with the measured solver, so the judgement has an
 *  instrument and the prose that stood in for it is gone. What is left states the duty and leaves
 *  the route to the Builder, which is what design prior 10 asks for. The suite beside this file
 *  holds the envelope: nothing another surface owns, each duty once, no measured domain, no number
 *  at all. */

import { DCG_RULES } from "../solve/dcg-rules.ts";

/** What the Builder is making, what "good" means and how the product improves, before the duties.
 *  It names no step of the loop: the round's shape, submit included, is STARTER.md's. */
export const INTENT_CLAUSE = [
  "You are the Builder. From the one-line request you build a product the controller adopts and measures: a Built Harness in agent/ with which a separate solving model answers each task, and a correctness model in correctness-model/ that decides, without the solver's help, whether an answer is right. Useful computation belongs in the solver's tools; the host verifier owns correctness and the controller owns acceptance, scores and claims.",
  "A round succeeds when the controller accepts a candidate whose checks separate a correct answer from a convincing wrong one in every family. A sound candidate measured now teaches more than a better one measured later; after measurement, choose the next experiment the recorded evidence supports.",
] as const;

/** Where the tools are rooted and what is submitted. The pack is the whole standing channel into an
 *  authoring session — there is no skill mechanism and none is wanted (operator decision: a skill
 *  layer costs a moving part and reports no spend) — so the card sends the Builder to STARTER.md and
 *  STARTER.md lists what the pack holds.
 *
 *  The card does not enumerate the reference files itself. That was a second owner of the list, paid
 *  for on every turn, and the evidence for it — sessions that opened no file with the read tool —
 *  proved nothing, because a Builder reads through bash. The zsh quoting line went with it: it
 *  taught one shell quirk in the surface that rule 14 reserves for duties, and a recurring interface
 *  failure is answered at the tool rather than with another sentence. */
export const BUILDER_WORKSPACE_CARD = [
  "The file tools work from the workspace root. Read STARTER.md first; it maps the loop and links the reference files in starter-pack/.",
  "Every file under agent/ and correctness-model/ is submitted; keep scratch files, seed projects and experiments elsewhere in the workspace, not in /tmp.",
].join(" ");

/** The requested work stays whole: scope, answer shape and difficulty.
 *
 *  The difficulty sentence's first duty is to measure rather than estimate, and that is the whole
 *  reason the rest could shrink. A Builder rehearsing a task against its own solver learns in one
 *  call what no sentence addressed to it had ever fixed: a Builder's model of its own solver is
 *  wrong in the same direction round after round, declaring at most a couple of verified passes and
 *  then measuring most of the battery, even while each round adds a genuinely new coupled
 *  requirement.
 *
 *  What stays beside it is the one direction with outcome evidence. Adding one interaction per task
 *  leaves a battery almost all of its passes; stacking those same interactions inside an unchanged
 *  limit takes almost all of them away. The coupling half is the published limits themselves: a
 *  deflection limit loose enough that strength alone decides every design leaves nothing to
 *  reconcile, while one set near the strength-governed optimum's own movement means neither limit is
 *  met by ignoring the other. The re-tuning half answers the failure mode of moving only the
 *  published magnitudes, battery after battery.
 *
 *  Which requirements to stack stays the Builder's, because prior 10 prescribes no course, and the
 *  pass counts belong to the authoring context, which is the surface that knows this run's battery
 *  size. */
export const SCOPE_CLAUSE = [
  "Treat every broadly sensible request as workable and build a real candidate, even in a new domain; choose the representation, tools, verification method and experiment from the request and the evidence.",
  "Keep every capability in the request in the verified tasks. A short request names a whole field: map the families a practitioner would recognise, let the tasks span them, and record in the brief which families the harness covers and leaves out. For one named build, vary its stated conditions; for a named site or dataset, use its facts and the jobs a user would do there. Evaluate the work in use and under its stated conditions, and evaluate values the solver must derive, never copying, reordering or relabelling public input. Let the request choose the answer shape: files for source code and configuration, a declared structured artifact for records, calculations and plans.",
  "A first battery is right when only a few of its cases pass, and any battery almost all of them pass found no limit; the authoring context states the exact counts for this run's battery size. Measure where you are rather than estimating it: rehearse a task against your own solver, and read one it passes first time as a case the battery will pass. Reach the count, in the first battery and in every later one still above it, by stacking the request's interacting requirements on every task at once and coupling the published limits so that meeting one does not already clear the rest, and let a later battery pay for what it adds out of the limits it already published: re-tuning the published numbers of the requirements the tasks already had adds nothing to reconcile.",
] as const;

/** What the solver may read, and what it must never read.
 *
 *  A proposer tool that is the reference solve passes every task in one call each while proving
 *  nothing about the harness behind it, which — given hard tasks and neither a sizer nor a search —
 *  solves none of them. So decisions sit in the withheld list beside controls, and "in any wording"
 *  attaches to the whole duty rather than to one item: a Builder can declare a reference recipe
 *  private, "sizes members by repeated greedy downsizing against the full requirement set", and then
 *  write that same recipe into BUILT_AGENTS.md as guidance, in its own words. No literal comparison
 *  of the two texts would see it, which is why the duty is stated over the decision rather than over
 *  its wording, and why no n-gram census was built to catch it.
 *
 *  The last sentence makes computing the check's own rule the duty. An adviser returning a
 *  first-order response under second-order limits that the same public input fully specifies changes
 *  no answer by putting a plain disclaimer beside it, because the solver optimises against the
 *  number the tool returns rather than against the caveat. The worked case is in contract.md. */
export const PUBLICATION_CLAUSE = [
  "Publish everything the verifier requires of an answer wherever the solver reads it: constants with their authority, units, precision and rounding, comparison direction and tolerance, canonical form, required paths and entry points, and the assumptions an installed tool applies. A solver that follows every published rule must never fail on a rule it could not read; where a practitioner could read a rule two ways, the brief states the verified reading.",
  "Withhold hidden expectations, private controls and decisions, reference answers and protected verifier information from everything the solver reads, in any wording, tool results included. Leave the construction method to the solver: a tool may compute and return candidates from public inputs, but not the remaining decision the task asks for. Never ship the reference solve as a solver tool.",
  "Give the solver batch tools: an analysis showing each requirement's value, limit and margin, and under a design limit a sizer or bounded search. Name a failed state in words, and compute each quantity by the rule its check applies whenever the public task fixes that rule.",
] as const;

/** Verification that means something, and the real installed tools it rests on. The reached-program
 *  duty answers a harness that checked a host helper unit and a compile alone; the install duty
 *  answers one that repeated a rendered "not found" back as its reason for a stand-in, and one that
 *  then compiled against a header it had written itself; the last sentence answers one that pasted
 *  the agent's own analysis into the evaluator. */
export const VERIFICATION_CLAUSE = [
  "Every advertised capability maps to a check that can fail on real tasks; declare a capability no route can check as an explicit omission in the brief. Decide what the delivered program does by running or computing it on the supplied inputs, not by recognising how it is written, and accept every implementation the brief permits: compiling it, finding its files or exercising a helper it need not call proves nothing. Agreement among check, reference solve and controls is circular when they share an omission.",
  "Acquire the tool before writing around it. The domain's practitioners already have established open-source tooling with a published interface: find it from public sources and install it; Bash has network access. A tool you have not searched for and tried to install is not an unavailable tool.",
  "A stand-in for the target is the last route and proves conformance to the stand-in alone: name it and what you tried in the brief, and do not describe its result as compiling, building or simulating for that target. Never replace a failing verifier tool with the agent's own analysis.",
] as const;

/** The session contract, frozen when the session opens. Nothing here may describe verifier
 *  internals, because this text is the Builder's own system prompt and its digest is a recorded
 *  condition. */
export function builderSystemPrompt(
  /** Whether this session's transport carries public web search, which the caller resolves from the
   *  backend it opened. Stated only when true: announcing an absent tool would send the Builder
   *  looking for it and spend turns discovering it is not there. */
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
