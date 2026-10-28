/**
 * The rule that sends a skill script's arguments to the one parser in `.claude/skills/main/cli.ts`.
 *
 * The admitted side is the part worth pinning, because each admitted shape is one the library's own
 * callers use: the executable at index zero, the slice handed straight to a parser behind
 * `import.meta.main`, and a testable `main(argv)` that forwards its parameter — through a second
 * local function as well — to the library. A forwarding function that parses by hand is the case
 * that separates following a parameter from trusting a name.
 */
import { describe, it } from "bun:test";
import { lintRules } from "./helpers/lint-rule.ts";

const SCRIPT = `
import { exitWith, parseOrDie, runCommand } from "#skills/main/cli.ts";
const die = exitWith("example");
const SPEC = { values: ["run"] };
const bun = Bun.argv[0]; // ADMITTED the executable, which a script re-spawns with
parseOrDie(die, SPEC, Bun.argv.slice(2)); // ADMITTED the library reads the slice
parseOrDie(die, SPEC, import.meta.main ? Bun.argv.slice(2) : []); // ADMITTED still the library, behind the entry test
function main(argv) {
  return parse(argv);
}
function parse(argv) {
  return parseOrDie(die, SPEC, argv);
}
main(Bun.argv.slice(2)); // ADMITTED forwarded to the library through two local functions
const run = (argv) => runCommand({ name: "x", usage: "x" }, () => 0, argv);
run(process.argv.slice(2)); // ADMITTED an arrow that forwards counts the same
function handParse(argv) {
  return { run: argv[argv.indexOf("--run") + 1] };
}
handParse(Bun.argv.slice(2)); // REPORT the function it reaches parses by hand
const spec = Bun.argv[2]; // REPORT an index past the executable is an argument
const [command, ...rest] = runtimeProcess.argv.slice(2); // REPORT a destructure is a parser
if (process.argv.includes("--json")) console.log(bun); // REPORT a membership test ignores a misspelling
const held = Bun.argv.slice(2); // REPORT a named slice the rule cannot follow, and nothing needs the name
parseOrDie(die, SPEC, held);
console.log(command, rest, spec, bun);
`.trimStart();

describe("ana/no-hand-read-argv", () => {
  it("reports only the marked lines in every fixture and scope", async () => {
    await lintRules("ana", [
      ["no-hand-read-argv", SCRIPT, 5, ".claude/skills/launch-run/scripts/example.mjs"],
      ["no-hand-read-argv", SCRIPT, 5, ".claude/skills/launch-run/scripts/example.mts"],
      ["no-hand-read-argv", SCRIPT, 0, ".claude/skills/main/cli.ts"],
      ["no-hand-read-argv", SCRIPT, 0, ".claude/skills/launch-run/scripts/example.test.ts"],
      ["no-hand-read-argv", SCRIPT, 0, "src/example.ts"],
      ["no-hand-read-argv", SCRIPT, 0, "tools/example.ts"],
    ]);
  });
});
