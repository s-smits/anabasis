/**
 * Four things every rule in this repository's two plugins owes, and none of which fails loudly.
 *
 * A rule has to say whether it fixes. Forty-nine rules carried four fixers when this was
 * written, and there was no way to tell, for any of the other forty-five, whether the absence
 * was a decision or an oversight; six of them turned out to be oversights, and two of those
 * carried a written refusal whose stated obstacle had since been removed. So a rule either
 * declares `fixable: "code"` or writes the words "no fix" and the reason beside them.
 *
 * A declaration and a fix have to agree. oxlint ignores a `fix` from a rule that did not
 * declare itself fixable, and it does so silently: the rule keeps reporting, the sweep keeps
 * passing, and nothing is ever rewritten. The reverse — declaring `fixable` and carrying no fix
 * — is only a lie in the metadata, but it is the same lie a reader acts on.
 *
 * A fixer has to have a fixture. A report is read by a person, so a wrong one is found; a fix
 * writes source nobody looks at again, which makes it the one kind of lint code that can be
 * silently wrong for a year. `fixedSource` in the fixture helper runs the rule's own fix to
 * convergence and hands back the text, so the proof costs one assertion.
 *
 * And a rule has to appear in `FIXER-DECISIONS.md`, which holds the argument every report-only
 * rule's one-sentence refusal shares: the four conditions a fixer meets, the thirteen that meet
 * them, and the nine whose fixer is mechanically available and refused anyway. A rule's own doc says what it
 * decided; the record says why that reading is the same one every other rule got. A new rule
 * missing from it is a decision nobody wrote down, which is how a ruleset drifts into fixing
 * whatever happened to be easy.
 */
import { describe, expect, it } from "bun:test";
import { readFileSync, readdirSync } from "../src/meta/filesystem.ts";
import { join, resolve } from "../src/meta/path.ts";

const repoRoot = resolve(import.meta.dirname, "..");
const PLUGINS = ["ana", "anti-slop"];
const FIXABLE = /fixable: "code"/u;
const REFUSES = /no fix/iu;
const CARRIES = /\bfix: \(fixer/u;

/** Every rule, as the plugin name, the rule name and the source that declares it. */
const RULES = PLUGINS.flatMap((plugin) => {
  const dir = join(repoRoot, "tools/oxlint", plugin, "rules");
  return readdirSync(dir)
    .filter((file) => file.endsWith(".ts"))
    .map((file) => ({ plugin, rule: file.slice(0, -3), source: readFileSync(join(dir, file), "utf8") }));
});

/** The record of why each rule fixes or reports, which every rule has to be named in. */
const DECISIONS = readFileSync(join(repoRoot, "tools/oxlint/FIXER-DECISIONS.md"), "utf8");

/** Every test in this directory, so a fixer can be asked for the one that sweeps it. */
const TESTS = readdirSync(join(repoRoot, "test"))
  .filter((file) => file.endsWith(".test.ts"))
  .map((file) => readFileSync(join(repoRoot, "test", file), "utf8"));

describe("the oxlint rule contract", () => {
  it("has rules to read", () => {
    expect(RULES.length).toBeGreaterThan(40);
    expect(RULES.filter((one) => FIXABLE.test(one.source)).length).toBeGreaterThan(9);
  });

  it("makes every rule say whether it fixes", () => {
    const silent = RULES.filter((one) => !FIXABLE.test(one.source) && !REFUSES.test(one.source));
    expect(silent.map((one) => `${one.plugin}/${one.rule}`)).toStrictEqual([]);
  });

  it("keeps the declaration and the fix agreeing, because oxlint drops the mismatch in silence", () => {
    const declared = RULES.filter((one) => FIXABLE.test(one.source) !== CARRIES.test(one.source));
    expect(declared.map((one) => `${one.plugin}/${one.rule}`)).toStrictEqual([]);
  });

  it("names every rule in the record that says why it fixes or reports", () => {
    const unrecorded = RULES.filter((one) => !DECISIONS.includes(one.rule));
    expect(unrecorded.map((one) => `${one.plugin}/${one.rule}`)).toStrictEqual([]);
  });

  it("gives every fixer a fixture that reads its swept source back", () => {
    const unproven = RULES.filter((one) => FIXABLE.test(one.source)).filter(
      (one) => !TESTS.some((text) => text.includes("fixedSource") && text.includes(one.rule)),
    );
    expect(unproven.map((one) => `${one.plugin}/${one.rule}`)).toStrictEqual([]);
  });
});
