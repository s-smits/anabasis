/**
 * What the Builder's system prompt is allowed to be, stated as properties rather than as a list of
 * its own sentences.
 *
 * Until 2026-09-19 this suite held about sixty `toContain` calls, one per clause, each with a
 * comment naming the campaign that bought it. That made the prompt unrewritable: changing a word
 * meant editing the assertion that quoted it, so the suite could only ever confirm the text it was
 * written against. It proved the prompt was the prompt.
 *
 * The properties below are the invariants those sentences were approximating: the prompt states
 * nothing another surface owns, says each duty once, carries no measured domain, and fits the turn
 * budget. Inside that envelope the wording is the author's. Where a clause exists for a recorded
 * reason, the reason lives in the producer's comment, which is where it is read when the clause is
 * being changed.
 */
import { describe, expect, it } from "bun:test";

import { readFileSync } from "../src/meta/filesystem.ts";
import { join } from "../src/meta/path.ts";
import { STARTER_DOC, STARTER_ENTRY, STARTER_LADDER } from "./helpers/starter-contracts.ts";
// The producer's own module. builder-session.ts re-exports the prompt, but a prompt test that names
// the barrel says the session owns the prompt text.
import {
  INTENT_CLAUSE,
  PUBLICATION_CLAUSE,
  SCOPE_CLAUSE,
  VERIFICATION_CLAUSE,
  builderSystemPrompt,
} from "../src/author/builder-start-prompt.ts";
import { MEMORY_FILE, SCRATCHPAD_FILE } from "../src/author/builder-memory.ts";
import { renderBatteryContract } from "../src/run/climb-readout.ts";
import { DCG_RULES } from "../src/solve/dcg-rules.ts";
import { DEFAULT_HARNESS_SETTINGS } from "../src/truth/harness-config.ts";
import { CENSUS_LANES } from "../src/truth/run-controls.ts";

const flat = (text: string) => text.replace(/\s+/g, " ");
const bytes = (text: string) => new TextEncoder().encode(text).byteLength;

/** src/ as one text: a taught refusal code is held to a literal the source still emits, and a wall
 *  the prompt must not state is read from the settings rather than from a list kept by hand. */
const SRC_DIR = join(import.meta.dir, "../src");
const SOURCE_TEXT = [...new Bun.Glob("**/*.ts").scanSync(SRC_DIR)]
  .map((name) => readFileSync(join(SRC_DIR, name), "utf8"))
  .join("\n");

const PROMPT = builderSystemPrompt(true);

/** Sentences of the composed prompt, for the properties that read one duty at a time. */
const SENTENCES = PROMPT.split(/(?<=[.:])\s+/)
  .map(flat)
  .filter((line) => line.length > 40);

const words = (line: string) => new Set(line.toLowerCase().match(/[a-z]{4,}/g) ?? []);

function overlap(left: Set<string>, right: Set<string>): number {
  const shared = [...left].filter((word) => right.has(word)).length;
  return shared / Math.min(left.size, right.size);
}

describe("Builder start prompt", () => {
  /** The prompt is paid on every turn of every authoring session; STARTER.md is paid once. The
   *  rewrite of 2026-09-15 moved the loop, the gates and the walls there and left intent and safety
   *  here (tenet 14), against a ceiling of a third of the composed prompt it replaced.
   *
   *  The ceiling below is lower than that third, and the reduction is the point of this pass. Until
   *  2026-09-19 the Builder could not see how hard its battery was until the controller measured it
   *  and paid for a whole round, so the prompt carried a method for guessing: which requirements to
   *  stack, where to pin a limit, how hard the reference had to search, each with the campaign that
   *  bought it. `harness_trial` now solves one authored task with the measured solver and returns a
   *  verdict, so that judgement has an instrument and the prose that substituted for it can go. */
  it("fits the turn budget with the slack the rehearsal bought", () => {
    expect(bytes(`${PROMPT}\n`)).toBeLessThanOrEqual(6_100);
  });

  it("delivers every clause exactly once, intent first and shell rules last", () => {
    const lines = [
      ...INTENT_CLAUSE,
      ...SCOPE_CLAUSE,
      ...PUBLICATION_CLAUSE,
      ...VERIFICATION_CLAUSE,
      ...DCG_RULES,
    ];
    for (const line of lines) expect(PROMPT.split(line).length - 1, line).toBe(1);
    const at = (line: string) => PROMPT.indexOf(line);
    expect(at(INTENT_CLAUSE[0])).toBe(0);
    expect(at(SCOPE_CLAUSE[0])).toBeGreaterThan(at(INTENT_CLAUSE[1]));
    expect(at(DCG_RULES.join("\n"))).toBeGreaterThan(at(VERIFICATION_CLAUSE[0]));
  });

  /** Two independent Builder sessions declared their reference's sizing recipe private and then
   *  wrote the same recipe into BUILT_AGENTS.md as guidance, in their own words — no literal
   *  comparison of the two texts could see it, and none did. So the withheld list holds decisions
   *  beside controls, and "in any wording" sits on the surface rather than on one item: what is
   *  withheld is the decision, and a paraphrase of it publishes it as surely as its row. */
  it("withholds a private decision from every wording, not only from its row", () => {
    expect(PROMPT).toContain("private controls and decisions");
    expect(PROMPT).toContain("from everything the solver reads, in any wording, tool results included");
  });

  /** Every number a Builder may act on has an owner elsewhere: the walls are its own
   *  `agent/config.yaml`, the pass counts are the authoring context's, the gate budgets are
   *  STARTER.md's. A number here is therefore either a second owner or a campaign statistic used as
   *  argument — nine of the sentences this pass removed were the latter. The property is cheaper to
   *  hold than the eleven absence assertions it replaces, and it cannot go stale when a wall moves. */
  it("states no number, because every number it could state is owned elsewhere", () => {
    expect(PROMPT).not.toMatch(/\d/);
    for (const wall of Object.values(DEFAULT_HARNESS_SETTINGS).flatMap((group) => Object.values(group))) {
      expect(PROMPT, String(wall)).not.toContain(String(wall));
    }
  });

  /** The loop, the gate sequence, the refusal codes and the tool-call shape have one owner, the
   *  starter files. Codes are read back out of src/ so the exclusion follows the source: a code this
   *  prompt names is a code it would have to be kept in step with. */
  it("leaves the loop, the gates, the codes and the tools to the starter", () => {
    const codes = new Set(
      [...SOURCE_TEXT.matchAll(/"([a-z]+(?:-[a-z0-9]+){2,})"/g)].map(([, code]) => code ?? ""),
    );
    for (const code of codes) expect(PROMPT, code).not.toContain(code);
    expect(PROMPT).not.toMatch(/[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+/);
    // One tool is named, the one that reaches earlier runs; naming it cost less than the
    // circumlocution (operator decision 2026-09-16). The rest of the roster is the starter's.
    expect(PROMPT.match(/harness_\w+|correctness_check|\bsubmit\b/g)).toEqual(["harness_inspect"]);
    for (const owned of [
      "runtime.tools.run",
      "tasks.json",
      "check-program/v1",
      "taskConditioned",
      "Wilson",
      MEMORY_FILE,
      SCRATCHPAD_FILE,
    ]) {
      expect(PROMPT, owned).not.toContain(owned);
    }
  });

  /** A worked domain in a Builder-visible surface is an answer, not a calibration: the loop measures
   *  these domains. Run 8 (2026-08-28) repeated a rendered "not found on verification PATH"
   *  back as its reason for a stand-in, and run 10 compiled against a board header it had written
   *  itself, so the install duty stays while the domain that taught it does not. */
  it("names no domain, tool or campaign the loop has measured", () => {
    for (const named of [
      "arduino-cli",
      "pio",
      "python3",
      "PlatformIO",
      "board",
      "firmware",
      "sensor",
      "peripheral",
      "radio",
      "fspl",
      "path loss",
      "hdmi",
      "displayport",
      "consumer hardware",
      "truss",
      "steel",
      "mass",
      "deflection",
      "Eurocode",
      "roof",
      "census",
    ]) {
      expect(PROMPT.toLowerCase(), named).not.toContain(named.toLowerCase());
    }
  });

  /** One duty, one owner. The removed comments recorded this failure three times by hand — a duty
   *  stated in the workspace card, again in the clause body and again in the closing paragraph —
   *  and each time the repetition was found only when someone needed the bytes back. */
  it("states each duty once", () => {
    for (const [index, sentence] of SENTENCES.entries()) {
      for (const other of SENTENCES.slice(index + 1)) {
        expect(overlap(words(sentence), words(other)), `${sentence}\n~~\n${other}`).toBeLessThan(0.55);
      }
    }
  });

  /** The difficulty judgement has an instrument now, so the prompt points at measuring rather than
   *  carrying a recipe. What remains is the one direction with outcome evidence behind it — the
   *  2026-09-15 pack series passed 22 of 23 with one interaction added per task and 2 of 23 with the
   *  interactions stacked inside the unchanged limit — and the counts stay with the authoring
   *  context that knows this run's battery size (AGENTS.md prior 10: no course is prescribed). */
  it("points at measurement for difficulty and prescribes no course", () => {
    expect(PROMPT).toContain("measure");
    for (const recipe of [
      "run the independent per-task searches concurrently",
      "publish the limit at its best with no slack",
      "A stronger search tightens the limit",
      "for as long as it needs",
    ]) {
      expect(PROMPT, recipe).not.toContain(recipe);
    }
    expect(flat(renderBatteryContract(25))).toContain(
      "Author the first battery above what you believe the harness handles",
    );
  });

  /** Run pr179-2ea118a-truss reached the settlement clause eleven minutes in, was refused,
   *  resubmitted the same tree four seconds later and settled with no battery. A Builder told that
   *  "verifier-required" is an available answer reaches for it, so the clause is controller-owned
   *  and arrives only in the refusal that needs it. Two segments, so the code sweep above — which
   *  reads kebab literals of three or more — does not see it. */
  it("names no settlement the controller alone may declare", () => {
    for (const surface of [PROMPT, STARTER_DOC, STARTER_ENTRY]) {
      expect(surface).not.toContain("verifier-required");
    }
  });

  /** A capability the transport carries is still one the Builder has to be told about: runs w28 and
   *  w30 made zero searches beside a working WebSearch tool. So the sentence is announced where the
   *  transport has it and withheld where it does not, and both halves are asserted, because a
   *  prompt that promises search on a transport without it sends the Builder after a tool that
   *  will not answer. */
  it("announces public web search only when the transport carries it", () => {
    expect(builderSystemPrompt(true)).toContain("You can search the web.");
    expect(builderSystemPrompt(false)).not.toContain("You can search the web.");
  });
});

const STAGES = [
  "1. Bundle contract.",
  "2. Validation.",
  "3. Conformance.",
  "4. Control census.",
  "5. Grounding.",
  "6. F2 reference solve.",
  "7. Family transplant.",
] as const;

describe("STARTER.md gate map", () => {
  it("keeps the entry a map to the loop, the gates and the reference files", () => {
    expect(bytes(STARTER_ENTRY)).toBeLessThan(6_800);
    for (const link of [
      "starter-pack/difficulty-ladder.md",
      "starter-pack/contract.md",
      "optional worked examples",
    ]) {
      expect(STARTER_ENTRY, link).toContain(link);
    }
    expect(STARTER_ENTRY.indexOf("## Loop")).toBeLessThan(STARTER_ENTRY.indexOf("## Gates"));
    let at = STARTER_ENTRY.indexOf("## Gates");
    for (const stage of STAGES) {
      const next = STARTER_ENTRY.indexOf(`**${stage}**`);
      expect(next, stage).toBeGreaterThan(at);
      at = next;
    }
  });

  /** One direction for the first battery, stated once. Until 2026-09-18 the entry read "Take a
   *  first battery from easy to hard" while the authoring context the same Builder holds said
   *  "above what you believe the harness handles": two owners pointing opposite ways at the decision
   *  that sets a campaign's whole climb, and the entry is the one read first. */
  it("points the first battery at the top tier and leaves the counts to the prompt", () => {
    const starter = flat(STARTER_ENTRY);
    expect(starter).toContain(
      "Take the first battery from the **frontier** row, above what you believe the harness handles",
    );
    for (const downwards of ["easy to hard", "start easy", "from easy"]) {
      expect(starter, downwards).not.toContain(downwards);
    }
    for (const count of ["verified cases to pass", "finds no limit", "of 25"]) {
      expect(starter, count).not.toContain(count);
    }
    // The rehearsal is the entry's, because it is a step in the loop: the instrument that tells the
    // Builder its battery is too easy before the controller pays a round to find out.
    expect(starter).toContain("solves that task blind with your own agent");
  });

  /** What a later battery is, which the entry did not say. Run de8b40's probe landed on the aim at
   *  3 of 6 — "the limit on the current requirements", the one zone whose measurement note carries
   *  no course at all — and the round that followed grew the same demand to 25 cases. That round
   *  buys the count the probe had already returned. The direction is still the note's and the
   *  content is still the Builder's: this says only that more cases at a measured demand is not one
   *  of the moves. */
  it("states what a later battery is and rules out widening at a measured demand", () => {
    const starter = flat(STARTER_ENTRY);
    expect(starter).toContain("A battery after the first moves the demand or repairs the last measurement.");
    expect(starter).toContain("growing a probe to the full size is no exception");
    // The ladder owns the reasoning, and the entry owns the one sentence: neither states a direction.
    for (const course of ["raise", "ease", "climb to", "harder next"]) {
      expect(starter, course).not.toContain(course);
    }
  });

  // The gate walls are the harness's own settings (operator decision 2026-09-16): the Builder is
  // told the config exists, never its values, so it cannot design against a stated limit.
  it("names the harness config without stating the walls it sets", () => {
    const starter = flat(STARTER_ENTRY);
    expect(CENSUS_LANES).toBe(4);
    expect(starter).toContain("four examples at a time with the installed tools, on a host that may be busy");
    expect(starter.split("`agent/config.yaml`").length - 1).toBe(1);
    for (const wall of ["120 s", "300 s", "600 s", "900 s", "30 minutes", "two hours", "24 turns"]) {
      expect(`${starter} ${PROMPT}`, wall).not.toContain(wall);
    }
  });

  // Every taught code must still be emitted, so the Builder is taught the current contract.
  it("teaches two or three live refusal codes per stage", () => {
    const gates = STARTER_ENTRY.split("\n## Gates\n")[1] ?? "";
    const sections = gates.split(/\n\*\*\d\. /).slice(1);
    expect(sections).toHaveLength(STAGES.length);
    for (const section of sections) {
      const codes = [...section.matchAll(/^- (.+?):/gm)].flatMap(([, head]) =>
        [...(head ?? "").matchAll(/`([A-Z]+(?:_[A-Z]+)+|[a-z]+(?:-[a-z0-9]+)+)`/g)].map(
          ([, code]) => code ?? "",
        ),
      );
      expect(codes.length, section.slice(0, 30)).toBeGreaterThanOrEqual(2);
      expect(codes.length, section.slice(0, 30)).toBeLessThanOrEqual(3);
      for (const code of codes) expect(SOURCE_TEXT.includes(`"${code}"`), code).toBe(true);
    }
  });

  // Rediscovered by truss run dffb11 through refusals: the evaluator import rule, the runtime
  // argument and the transplant settle rule.
  it("carries the contracts dffb11 found by trial", () => {
    const starter = flat(STARTER_ENTRY);
    for (const contract of [
      "files there import only `reference/` and the public `@ana` packages",
      "a check takes `runtime` as its second argument or on the request",
      "returns `false` for a deliverable that does not fit; it neither throws nor returns before the run",
      "Bound a search by a fixed iteration count",
      "so the wall bounds the replay and not the limit",
    ]) {
      expect(starter, contract).toContain(contract);
    }
  });

  /** The ladder is the Builder-visible face of the tier scale `query-complexity.mjs` classifies a
   *  measured battery against, so one vocabulary covers authoring and review. Three things separate
   *  its top two tiers from the two below, and campaign 3fd52f9e-10 — "significantly too easy" four
   *  rounds running — was missing the last two: limits that trade against each other, a degraded
   *  state the same answer must also clear, and a duty to report the value each limit was read
   *  against. A tier row that loses one of the three is a longer sentence, not a harder task. */
  it("grades the ladder on what an answer holds at once, not on how much it reads", () => {
    for (const tier of ["easy", "medium", "hard", "frontier"]) {
      expect(STARTER_LADDER).toContain(`- **${tier}**`);
    }
    for (const discriminator of [
      "none of them met at the cost of another",
      "across a whole set of degraded or adversarial states the same one answer must clear",
      "with the worst case and where it falls reported",
      // What three consecutive 6-of-6 batteries of 3fd52f9e-10 each did instead, named so that the
      // next author checks its change against them before spending a battery on it.
      "A tighter number on a rule the tasks already had",
      "More cases of a rule the tasks already had",
      "A new rule that only removes candidates",
    ]) {
      expect(flat(STARTER_LADDER), discriminator).toContain(discriminator);
    }
    for (const domain of [
      "GP surgery",
      "Power distribution feeder",
      "Thermodynamic power cycle",
      "Impulsive orbital transfer",
      "Lumped LC impedance match",
      "Relational index selection",
    ]) {
      const rows = STARTER_LADDER.split(`**${domain}`)[1]?.split("\n**")[0] ?? "";
      for (const tier of ["- easy —", "- medium —", "- hard —", "- frontier —"]) {
        expect(rows, domain).toContain(tier);
      }
      expect(rows, domain).toContain("report");
    }
    // Frontier is hard with the set taken back out of the task statement. Without that the top tier
    // is a longer hard row, the ladder has three rungs under a fourth name, and every battery that
    // reaches hard reads as having reached the aim.
    for (const searched of [
      "the worst case lies somewhere in a continuous or combinatorial region the solver has to search",
      "the limits that apply follow a class the answer itself declares",
      "every intermediate state of a sequence is bound",
      "a reported margin has to survive its admissible neighbours under a published trade rule",
    ]) {
      expect(flat(STARTER_LADDER), searched).toContain(searched);
    }
    for (const measured of ["truss", "Truss"]) {
      expect(STARTER_LADDER).not.toContain(measured);
    }
  });

  /** The ladder answered one side of the aim until 2026-09-18: a battery that scored near the top
   *  had a section naming what its tiers were missing, and a battery that passed almost nothing had
   *  nothing at all — on the side a first battery is authored to land on. */
  it("answers a battery below the aim as well as one above it", () => {
    const below = flat(STARTER_LADDER.split("## When a battery lands below the aim")[1] ?? "");
    expect(below, "the below-the-aim section").not.toBe("");
    for (const settled of [
      "A rule your checks apply and your brief does not publish fails every task",
      "An artifact a correct solver cannot write through the tools you gave it is a representation defect",
      "The same tasks failing in consecutive batteries is a stuck path or an unpublished rule",
      "It does not mean loosening a published number on a rule the tasks already had",
    ]) {
      expect(below, settled).toContain(settled);
    }
    expect(below.indexOf("landing here is the course working")).toBeLessThan(
      below.indexOf("A later battery still below it is not"),
    );
  });

  /** The other half of the same defect de8b40 recorded: six tasks carried three distinct geometries,
   *  each family's second task repeating the first and moving only load magnitude and the numeric
   *  limits. The battery then has one axis left, and the ladder already says moving a number
   *  measures the same. */
  it("asks sibling tasks in a family to vary a structural input, not only its magnitudes", () => {
    const after = flat(STARTER_LADDER.split("## Every battery after the first")[1] ?? "");
    expect(after, "the after-the-first section").not.toBe("");
    for (const rule of [
      "differ only in the magnitudes of the published numbers measure one condition twice",
      "Vary the input the obligation is carried by, and the pair reports two things",
      "A family that varies only by magnitude also bounds the next battery",
    ]) {
      expect(after, rule).toContain(rule);
    }
  });

  it("keeps the guide byte cap and the worked tool call in the reference files", () => {
    expect(flat(STARTER_DOC)).toContain("once per task, so it stays under 8,192 bytes");
    expect(STARTER_DOC).toContain("const run = await runtime.tools.run({");
    expect(flat(STARTER_DOC)).toContain(
      "For external evidence, file contents and stdin must be string leaves or JSON",
    );
    expect(STARTER_DOC).toContain("non-result even if the program returns false");
  });
});
