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

import { existsSync, readFileSync } from "../src/meta/filesystem.ts";
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
const STARTER_DIR = join(import.meta.dir, "../starters/pi-built-harness");
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

  /** The difficulty judgement has an instrument, and the battery contract every round carries is
   *  the one surface that points at it, so the prompt carries neither that pointer nor a recipe. The
   *  counts stay with the authoring context that knows this run's battery size (AGENTS.md prior 10:
   *  no course is prescribed). */
  it("points at measurement for difficulty and prescribes no course", () => {
    for (const recipe of [
      "run the independent per-task searches concurrently",
      "publish the limit at its best with no slack",
      "A stronger search tightens the limit",
      "for as long as it needs",
    ]) {
      expect(PROMPT, recipe).not.toContain(recipe);
    }
    const contract = flat(renderBatteryContract(25));
    expect(contract).toContain("Author the first battery above what you believe the harness handles");
    expect(contract).toContain("let your rehearsals rather than your belief confirm");
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

  /** One direction for the first battery, stated once, and none after it. An entry reading "from
   *  easy to hard" beside an authoring context reading "above what you believe the harness handles"
   *  is two owners pointing opposite ways at the decision that sets a campaign's whole climb, and the
   *  entry is the one read first. The counts belong to the prompt, and the route after a measured
   *  battery belongs to the Builder. */
  it("points the first battery at the top tier and prescribes no counts or course", () => {
    const starter = flat(STARTER_ENTRY);
    expect(starter).toContain("— **frontier**, where the first battery starts —");
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

  /** The ladder is the Builder-visible face of the tier scale `query-complexity.mjs` classifies a
   *  measured battery against, so one vocabulary covers authoring and review. Every worked domain
   *  carries all four tiers and a reporting duty, no measured domain appears, and both sides of the
   *  aim have a section: with only the above-the-aim one, a battery that passes almost nothing is
   *  told nothing on the side a first battery is authored to land on. */
  it("grades every worked domain on all four tiers and answers both sides of the aim", () => {
    for (const tier of ["easy", "medium", "hard", "frontier"]) {
      expect(STARTER_LADDER).toContain(`- **${tier}**`);
    }
    const domains = [...STARTER_LADDER.matchAll(/^\*\*([^*]+)\*\* —/gm)].map(([, name]) => name ?? "");
    expect(domains.length).toBeGreaterThanOrEqual(6);
    for (const domain of domains) {
      const rows = STARTER_LADDER.split(`**${domain}**`)[1]?.split("\n**")[0] ?? "";
      for (const tier of ["- easy —", "- medium —", "- hard —", "- frontier —"]) {
        expect(rows, domain).toContain(tier);
      }
      expect(rows, domain).toContain("report");
    }
    expect(STARTER_LADDER).not.toMatch(/truss/i);
    for (const section of ["## When a battery lands below the aim", "## Reading a measured battery"]) {
      const body = STARTER_LADDER.split(section)[1]?.split("\n## ")[0]?.trim() ?? "";
      expect(body, section).not.toBe("");
    }
  });
});
