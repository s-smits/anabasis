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
 * being changed. The anchors that remain are the publication boundary's, because a boundary is a
 * claim about what text names, and a property cannot say which route it closes.
 */
import { describe, expect, it } from "bun:test";

import { existsSync, readFileSync } from "../src/meta/filesystem.ts";
import { join } from "../src/meta/path.ts";
import { STARTER_DOC, STARTER_ENTRY } from "./helpers/starter-contracts.ts";
import { SYSTEM_SENTENCES, expectNoRestatedDuty, flat, overlap } from "./helpers/duty-overlap.ts";
// The producer's own module. builder-session.ts re-exports the prompt, but a prompt test that names
// the barrel says the session owns the prompt text.
import {
  INTENT_CLAUSE,
  NO_GRADER_IN_REACH,
  PUBLICATION_CLAUSE,
  SCOPE_CLAUSE,
  VERIFICATION_CLAUSE,
  builderSystemPrompt,
} from "../src/author/builder-start-prompt.ts";
import { MEMORY_FILE, SCRATCHPAD_FILE } from "../src/author/builder-memory.ts";
import { SUBMIT_DESCRIPTION } from "../src/gate/submit-tool.ts";
import { EPOCH_REVIEW_PROMPT } from "../src/review/epoch-review-prompt.ts";
import { renderBatteryContract } from "../src/run/climb-readout.ts";
import { renderProbeSizing } from "../src/run/battery-sizing.ts";
import { directKickoff } from "../src/run/direct-input.ts";
import { DCG_RULES } from "../src/solve/dcg-rules.ts";
import { DEFAULT_HARNESS_SETTINGS } from "../src/correctness-bundle/harness-config.ts";
import { CENSUS_LANES } from "../src/correctness-bundle/run-controls.ts";

const bytes = (text: string) => new TextEncoder().encode(text).byteLength;

/** src/ as one text: a taught refusal code is held to a literal the source still emits, and a wall
 *  the prompt must not state is read from the settings rather than from a list kept by hand. */
const SRC_DIR = join(import.meta.dir, "../src");
const STARTER_DIR = join(import.meta.dir, "../starters/pi-built-harness");
const SOURCE_TEXT = [...new Bun.Glob("**/*.ts").scanSync(SRC_DIR)]
  .map((name) => readFileSync(join(SRC_DIR, name), "utf8"))
  .join("\n");

const PROMPT = builderSystemPrompt(true);

/** The adviser bullet of the tools contract, which the Builder reads beside the system prompt when
 *  it writes a tool. */
const ADVISER_FENCE = flat(
  readFileSync(join(STARTER_DIR, "starter-pack/contract.md"), "utf8")
    .split("\n- ")
    .find((bullet) => bullet.startsWith("An adviser never"))
    ?.split("\n\n")[0] ?? "",
);

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
    expect(bytes(`${PROMPT}\n`)).toBeLessThanOrEqual(7_000);
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
    for (const [index, sentence] of SYSTEM_SENTENCES.entries()) {
      for (const other of SYSTEM_SENTENCES.slice(index + 1)) {
        expect(overlap(sentence, other), `${sentence}\n~~\n${other}`).toBeLessThan(0.55);
      }
    }
  });

  /** The kickoff sits beside the request on the first turn, which makes it the natural place to
   *  restate a duty the system prompt already carries; the same measure holds it to one owner. Its
   *  short sentences are measured too, since the overlap is over the shorter sentence's words. */
  it("leaves the kickoff no duty the system prompt already states", () => {
    const kickoff = directKickoff("designs steel roof trusses to Eurocode 3", {
      files: [],
      digest: "0".repeat(64),
      root: null,
      dispose: () => undefined,
    });
    const closing = kickoff.split("\n").at(-1) ?? "";
    for (const line of closing.split(/(?<=[.:])\s+/).map(flat)) {
      for (const sentence of SYSTEM_SENTENCES) {
        expect(overlap(line, sentence), `${line}\n~~\n${sentence}`).toBeLessThan(0.55);
      }
    }
  });

  /** The contract, the sizing sentences and the trial tool are read at their own moments, beside the
   *  system prompt; each names its trigger and leaves the duty to the clause that owns it. */
  it("leaves the contract and the sizing sentences no duty the system prompt states", () => {
    for (const text of [
      renderBatteryContract(25),
      renderBatteryContract(10, 5),
      renderProbeSizing({ min: 5, max: 10 }, 25, null) ?? "",
      renderProbeSizing({ min: 25, max: 25 }, 25, 6) ?? "",
    ]) {
      expectNoRestatedDuty(text);
    }
  });

  /** Firmware 7a97af's first tasks each combined several requirements and every solve still passed in
   *  minutes, so the intent clause defines depth by requirements that compete for one margin, and it
   *  is the one surface that defines it. */
  it("asks for depth in the first tasks, as requirements that compete", () => {
    expect(flat(INTENT_CLAUSE.join(" "))).toContain("Build that demand into the first tasks, not later:");
    expect(PROMPT).toContain(
      "several of the request's requirements act together on a single answer, so that meeting one spends the margin another needs.",
    );
    expect(PROMPT).not.toContain("transcription");
  });

  it("points at measurement for difficulty and prescribes no course", () => {
    for (const recipe of [
      "run the independent per-task searches concurrently",
      "publish the limit at its best with no slack",
      "A stronger search tightens the limit",
      "for as long as it needs",
    ]) {
      expect(PROMPT, recipe).not.toContain(recipe);
    }
    // The contract once tied the reference search to the solve wall; the mechanism behind it was
    // refuted (AGENTS.md "Tried and taken out").
    expect(flat(renderBatteryContract(25))).not.toContain("as long as the solver may spend");
    expect(flat(renderBatteryContract(25))).toContain(
      "only a blind measured battery shows where a battery lands",
    );
  });

  /** A Builder told that "verifier-required" is an available answer reaches for it: it settles
   *  minutes in, resubmits the same tree when refused, and the run ends with no battery at all. So
   *  no Builder surface names it. The literal has two segments, so the code sweep above — which reads
   *  kebab literals of three or more — does not see it. The submit description is held too, because a
   *  tool description is in front of the Builder on every turn and is where a retry rule is most
   *  naturally read. */
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

/** Publication is the system prompt's, stated once there, and the tools contract and the Epoch
 *  Reviewer read the same line from it. Firmware 7a97af's accepted versions carried
 *  `agent/rules.ts` byte-identical to `correctness-model/rules.ts`: its `expected_behaviour` tool
 *  took a scenario the solver chose, never the candidate, and returned what the checks expected
 *  there, and nine of ten measured traces called it. A ceiling that names only analysis of a
 *  candidate leaves that route open, so the one ceiling names both. Shared public computation stays
 *  the solver's, and nothing refuses a byte copy: the copy is a lead, never a verdict. */
describe("the publication boundary", () => {
  /** A Builder can declare its reference's sizing recipe private and then write that same recipe
   *  into BUILT_AGENTS.md as guidance, in its own words, where no literal comparison of the two
   *  texts can see it. So the withheld list holds decisions beside controls, and "in any wording"
   *  sits on the surface rather than on one item. The contract once restated the clause in its own
   *  words every round; the prompt owns it, including the tie-break and fallback rules only the
   *  restatement named. */
  it("withholds every private decision in any wording, and the battery contract restates none of it", () => {
    for (const anchor of [
      "private controls and decisions",
      "from everything the solver reads, in any wording, tool results included",
      "tie-break and fallback rules",
      "solved task-specific fixtures",
    ]) {
      expect(PROMPT, anchor).toContain(anchor);
    }
    expect(flat(renderBatteryContract(25))).not.toContain("Publish");
  });

  it("closes both routes to the grader in one ceiling: analysing a candidate and computing a check's expected result", () => {
    expect(NO_GRADER_IN_REACH).toMatch(/analyses a candidate the way a check does/);
    expect(NO_GRADER_IN_REACH).toMatch(/computes what a check expects for a case the solver names/);
    // The practitioner's own toolchain and a bounded search stay in the solver's hands.
    expect(PROMPT).toContain("the real toolchain it builds with");
    // So do the field's instruments and the solver's own tests, though a check runs the same tool:
    // sharing an operation is not access to the grader.
    expect(NO_GRADER_IN_REACH).toContain(
      "Running the field's own compiler or simulator on the solver's candidate",
    );
    expect(NO_GRADER_IN_REACH).toContain("nor is a test the solver writes");
  });

  it("gives the Epoch Reviewer the Builder's ceiling verbatim, so both judge a tool by one line", () => {
    expect(EPOCH_REVIEW_PROMPT.split(NO_GRADER_IN_REACH).length - 1).toBe(1);
  });

  it("fences an adviser from a check's expected result in the tools contract, without restating the ceiling", () => {
    expect(ADVISER_FENCE).toContain("what a check expects for a scenario the solver chooses");
    // Leniency: code the correctness model also runs may serve an adviser when it is public
    // computation, so a copy is a question for the reader, not a refusal.
    expect(ADVISER_FENCE).toContain("published rules, constants and standard computation");
    // The guide may say how the solver's shell runs an installed instrument; what stays out of reach
    // is a check's verdict and its expected result.
    expect(ADVISER_FENCE).toContain("may say how the solver's shell runs an installed compiler or simulator");
    expect(ADVISER_FENCE).toContain("names no command that returns a check's verdict or its expected result");
    expect(ADVISER_FENCE).not.toContain("the way the check runs it");
    expectNoRestatedDuty(ADVISER_FENCE);
  });
});

const STAGES = [
  "1. Bundle contract.",
  "2. Conformance.",
  "3. Control census.",
  "4. F2 reference solve.",
] as const;

describe("STARTER.md gate map", () => {
  it("keeps the entry a map to the loop, the gates and reference files that exist", () => {
    expect(bytes(STARTER_ENTRY)).toBeLessThan(6_800);
    const links = [...new Set(STARTER_ENTRY.match(/starter-pack\/[\w-]+\.md/g) ?? [])];
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) expect(existsSync(join(STARTER_DIR, link)), link).toBe(true);
    expect(STARTER_ENTRY.indexOf("## Loop")).toBeLessThan(STARTER_ENTRY.indexOf("## Gates"));
    let at = STARTER_ENTRY.indexOf("## Gates");
    for (const stage of STAGES) {
      const next = STARTER_ENTRY.indexOf(`**${stage}**`);
      expect(next, stage).toBeGreaterThan(at);
      at = next;
    }
  });

  /** The entry states no direction for the first battery and no course after one: the counts
   *  belong to the round's battery contract, and the route belongs to the Builder. */
  it("prescribes no direction, counts or course", () => {
    const starter = flat(STARTER_ENTRY);
    // A downward direction, a count the prompt owns, or a course after a measured battery.
    for (const stated of [
      "easy to hard",
      "start easy",
      "from easy",
      "verified cases to pass",
      "finds no limit",
      "of 25",
      "raise",
      "ease",
      "climb to",
      "harder next",
    ]) {
      expect(starter, stated).not.toContain(stated);
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

  // Every taught code must still be emitted, so the Builder is taught the current contract. Which
  // codes a stage must teach is gate-decisions.test.ts's: every refusing decision is told.
  it("teaches at least two live refusal codes per stage", () => {
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
      for (const code of codes) expect(SOURCE_TEXT.includes(`"${code}"`), code).toBe(true);
    }
  });
});
