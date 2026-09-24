/**
 * What the Builder's system prompt is allowed to be, stated as properties rather than as a list of
 * its own sentences.
 *
 * One `toContain` per clause makes the prompt unrewritable: changing a word means editing the
 * assertion that quotes it, so the suite can only ever confirm the text it was written against. It
 * proves the prompt is the prompt.
 *
 * The properties below are the invariants those sentences approximate: the prompt states nothing
 * another surface owns, says each duty once, carries no measured domain, and fits the turn budget.
 * Inside that envelope the wording is the author's. Where a clause exists for a recorded reason,
 * that reason lives in the producer's comment, which is what a reader has open when the clause is
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
import { SUBMIT_DESCRIPTION } from "../src/gate/submit-tool.ts";
import { renderBatteryContract } from "../src/run/climb-readout.ts";
import { directKickoff } from "../src/run/direct-input.ts";
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
  /** The prompt is paid on every turn of every authoring session; STARTER.md is paid once. So the
   *  loop, the gates and the walls live there and intent and safety live here (tenet 14), and the
   *  byte ceiling below is what holds that split in place.
   *
   *  A Builder that cannot see how hard its battery is until the controller measures it and pays
   *  for a whole round needs a method for guessing in the prompt: which requirements to stack,
   *  where to pin a limit, how hard the reference has to search. `harness_trial` solves one
   *  authored task with the measured solver and returns a verdict, so that judgement has an
   *  instrument and the prose that substituted for it is gone. */
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

  /** A Builder can declare its reference's sizing recipe private and then write that same recipe
   *  into BUILT_AGENTS.md as guidance, in its own words, where no literal comparison of the two
   *  texts can see it. So the withheld list holds decisions beside controls, and "in any wording"
   *  sits on the surface rather than on one item: what is withheld is the decision, and a
   *  paraphrase of it publishes it as surely as its row. */
  it("withholds a private decision from every wording, not only from its row", () => {
    expect(PROMPT).toContain("private controls and decisions");
    expect(PROMPT).toContain("from everything the solver reads, in any wording, tool results included");
  });

  /** Every number a Builder may act on has an owner elsewhere: the walls are its own
   *  `agent/config.yaml`, the pass counts are the authoring context's, the gate budgets are
   *  STARTER.md's. A number here is therefore either a second owner or a campaign statistic used as
   *  argument. One property costs less to hold than an absence assertion per wall, and it cannot go
   *  stale when a wall moves. */
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
    // One tool is named, the one that reaches earlier runs and solver traces; naming it cost less
    // than the circumlocution (operator decision). The rest of the roster is the starter's.
    expect(PROMPT.match(/harness_\w+|correctness_check|\bsubmit\b/g)).toBeNull();
    expect(PROMPT).toContain("only through the context tool");
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

  /** A worked domain in a Builder-visible surface is an answer, not a calibration: the loop
   *  measures these domains, and a Builder shown one repeats it — a rendered "not found on
   *  verification PATH" comes back as the reason for a stand-in, or a compile succeeds against a
   *  board header the Builder wrote itself. The install duty stays; the domain that taught it
   *  does not. */
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

  /** One duty, one owner. The shape this catches is a duty stated in the workspace card, again in
   *  the clause body and again in the closing paragraph; left to hand inspection, that repetition
   *  surfaces only when someone needs the bytes back. */
  it("states each duty once", () => {
    for (const [index, sentence] of SENTENCES.entries()) {
      for (const other of SENTENCES.slice(index + 1)) {
        expect(overlap(words(sentence), words(other)), `${sentence}\n~~\n${other}`).toBeLessThan(0.55);
      }
    }
  });

  /** The kickoff sits beside the request on the first turn, which makes it the natural place to
   *  restate a duty the system prompt already carries; the same measure holds it to one owner. */
  it("leaves the kickoff no duty the system prompt already states", () => {
    const kickoff = directKickoff("designs steel roof trusses to Eurocode 3", {
      files: [],
      digest: "0".repeat(64),
      root: null,
      dispose: () => undefined,
    });
    const closing = kickoff.split("\n").at(-1) ?? "";
    for (const line of closing.split(/(?<=[.:])\s+/).map(flat)) {
      for (const sentence of SENTENCES) {
        expect(overlap(words(line), words(sentence)), `${line}\n~~\n${sentence}`).toBeLessThan(0.55);
      }
    }
  });

  /** The difficulty judgement has an instrument, so the prompt points at measuring rather than
   *  carrying a recipe. What remains is the one direction with outcome evidence behind it: stacking
   *  interactions inside an unchanged limit makes a battery far harder than adding one interaction
   *  per task. The counts stay with the authoring context that knows this run's battery size
   *  (AGENTS.md prior 10: no course is prescribed). */
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

  /** A Builder told that "verifier-required" is an available answer reaches for it: it settles
   *  minutes in, resubmits the same tree when refused, and the run ends with no battery at all. So
   *  the clause is controller-owned and arrives only in the refusal that needs it. The literal has
   *  two segments, so the code sweep above — which reads kebab literals of three or more — does not
   *  see it. The submit description is held too, because a tool description is in front of the
   *  Builder on every turn and is where a retry rule is most naturally read. */
  it("names no settlement the controller alone may declare", () => {
    for (const surface of [PROMPT, STARTER_DOC, STARTER_ENTRY, SUBMIT_DESCRIPTION]) {
      expect(surface).not.toContain("verifier-required");
    }
  });

  /** A capability the transport carries is still one the Builder has to be told about: an
   *  unmentioned WebSearch tool goes unused for a whole run. So the sentence is announced where the
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

  /** One direction for the first battery, stated once. An entry reading "from easy to hard" beside
   *  an authoring context reading "above what you believe the harness handles" is two owners
   *  pointing opposite ways at the decision that sets a campaign's whole climb, and the entry is
   *  the one read first. */
  it("points the first battery at the top tier and leaves the counts to the prompt", () => {
    const starter = flat(STARTER_ENTRY);
    expect(starter).toContain("Take the first battery from the **frontier** row.");
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

  /** What a later battery is, which the entry otherwise leaves unsaid. A probe landing on the aim
   *  has measured the limit on the current requirements — the one zone whose measurement note
   *  carries no course at all — so a round that then grows the same demand to full size buys the
   *  count the probe already returned. The direction stays the note's and the content stays the
   *  Builder's: this says only that more cases at a measured demand is not one of the moves. */
  it("states what a later battery is and rules out widening at a measured demand", () => {
    const starter = flat(STARTER_ENTRY);
    expect(starter).toContain("A battery after the first moves the demand or repairs the last measurement.");
    expect(starter).toContain("growing a probe to the full size is no exception");
    // The ladder owns the reasoning, and the entry owns the one sentence: neither states a direction.
    for (const course of ["raise", "ease", "climb to", "harder next"]) {
      expect(starter, course).not.toContain(course);
    }
  });

  // The gate walls are the harness's own settings (operator decision): the Builder is
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

  // The contracts a Builder otherwise rediscovers one refusal at a time: the evaluator import
  // rule, the runtime argument and the transplant settle rule.
  it("carries the contracts dffb11 found by trial", () => {
    const starter = flat(STARTER_ENTRY);
    for (const contract of [
      "files there import only `reference/` and the public `@ana` packages",
      "a check takes `runtime` as its second argument or on the request",
      "returns `false` for a deliverable that does not fit; it neither throws nor returns before the run",
      "Bound a search by a fixed iteration count",
      "so the wall bounds the replay, not the limit",
      "the limit is real only if the solver cannot run that search in its walls",
    ]) {
      expect(starter, contract).toContain(contract);
    }
  });

  /** The ladder is the Builder-visible face of the tier scale `query-complexity.mjs` classifies a
   *  measured battery against, so one vocabulary covers authoring and review. Three things separate
   *  its top two tiers from the two below: limits that trade against each other, a degraded state
   *  the same answer must also clear, and a duty to report the value each limit was read against. A
   *  tier row that loses one of the three is a longer sentence rather than a harder task, and a
   *  campaign authored from it reads as significantly too easy round after round. */
  it("grades the ladder on what an answer holds at once, not on how much it reads", () => {
    for (const tier of ["easy", "medium", "hard", "frontier"]) {
      expect(STARTER_LADDER).toContain(`- **${tier}**`);
    }
    for (const discriminator of [
      "none of them met at the cost of another",
      "across a whole set of degraded or adversarial states the same one answer must clear",
      "with the worst case and where it falls reported",
      // The three moves that leave a battery exactly as easy as it already was, named so the next
      // author checks a change against them before spending a battery on it.
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

  /** The ladder has to answer both sides of the aim. With only the above-the-aim section, a
   *  battery scoring near the top is told what its tiers were missing while one that passes almost
   *  nothing is told nothing at all — on the side a first battery is authored to land on. */
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

  /** The other half of the same defect: a family whose second task repeats the first and moves
   *  only the load magnitude and the numeric limits leaves the battery one axis, and the ladder
   *  already says moving a number measures the same condition twice. */
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
