/**
 * `bun run runs` with no verb lists every verb with what it does, and `<verb> --help` prints the
 * usage the head of its file states, so an agent learns the CLI from the CLI: every option a
 * parser takes is in that usage, and a verb given words it cannot act on answers with it.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "../src/meta/filesystem.ts";

const RUNS = `${import.meta.dir}/../tools/runs`;
const CLI = `${RUNS}/cli.ts`;
/** An option as a parser declares it: `yes: { type: "boolean"`, `"wait-hours": { type: "string"`, `json: FLAG`. */
const OPTION = /"?([A-Za-z][\w-]*)"?: (?:\{ type: "(?:string|boolean)"|FLAG\b)/gu;

async function runs(...args: string[]) {
  const child = Bun.spawn(["bun", CLI, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...Bun.env, ANA_HOSTS: "[]" },
  });
  const [out, err, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { out, err, code };
}

/** The verbs a listing names, each on a line of its own before what it does. */
const verbsIn = (listing: string) =>
  [...listing.matchAll(/^ {2}([a-z]+) {2,}\S/gmu)].map((match) => match[1] ?? "");

describe("the runs CLI explains itself", () => {
  test("a bare command lists every verb with what it does and exits 0, and a wrong verb exits 1", async () => {
    const bare = await runs();
    expect(bare.code).toBe(0);
    const verbs = verbsIn(bare.out);
    expect(verbs).toContain("fresh");
    expect(verbs).toContain("loadwatch");
    expect(new Set(verbs).size).toBe(verbs.length);
    // Under the verbs, what holds of them all: the flags every verb hears.
    expect(bare.out.split("every verb:")[1]).toContain("--here");
    const wrong = await runs("nope");
    expect(wrong.code).toBe(1);
    expect(verbsIn(wrong.err)).toEqual(verbs);
  });

  test("a word near a verb is answered with that verb alone, and runs nothing", async () => {
    // `st` begins a reader and `stop`; a slip of the keys is two edits from one verb.
    const [begun, slipped, short] = await Promise.all([runs("st"), runs("retier"), runs("zap")]);
    expect([begun.code, verbsIn(begun.err)]).toEqual([1, ["stop", "status"]]);
    expect([slipped.code, verbsIn(slipped.err)]).toEqual([1, ["retire"]]);
    expect(begun.out + slipped.out).toBe("");
    // A short word is near only at one edit: `zap` is `zip`, and `nope` is not `move`.
    expect(verbsIn(short.err)).toEqual(["zip"]);
  });

  test("every verb's --help prints its usage from its file's head, -h the same, and starts nothing", async () => {
    const verbs = verbsIn((await runs()).out);
    const helps = await Promise.all(verbs.map(async (verb) => ({ verb, ...(await runs(verb, "--help")) })));
    for (const { verb, out, code } of helps) {
      // A head that states no usage of its verb leaves no line naming it.
      const usage = out.split("\n").filter((line) => line.startsWith("  ") && line.includes(`runs ${verb}`));
      expect({ verb, code, named: usage.length > 0 }).toEqual({ verb, code: 0, named: true });
    }
    const [long, short] = await Promise.all([runs("keep", "--help"), runs("keep", "-h")]);
    expect(short.out).toBe(long.out);
    // `help` takes the verbs to explain, `all` for every one, and refuses a word that names none.
    const [two, all, stray] = await Promise.all([
      runs("help", "keep", "stop"),
      runs("help", "all"),
      runs("help", "keep", "nope"),
    ]);
    expect(two.out).toBe(`${long.out}\n${(await runs("stop", "--help")).out}`);
    expect(all.out).toBe(`${helps.map(({ out }) => out.trimEnd()).join("\n\n")}\n`);
    expect([stray.code, stray.out]).toEqual([1, ""]);
  });

  test("the help of a file's verbs names every option its parsers take", async () => {
    const blocks = (await runs("help", "all")).out.split("\n\n").map((block) => ({
      file: /the head of tools\/runs\/(\S+\.ts)$/u.exec(block)?.[1] ?? "",
      block,
    }));
    const missing: string[] = [];
    for (const file of readdirSync(RUNS).filter((name) => name.endsWith(".ts") && name !== "cli.ts")) {
      const text = readFileSync(`${RUNS}/${file}`, "utf8");
      const taken = [...new Set([...text.matchAll(OPTION)].map((match) => match[1] ?? ""))];
      // The scan reads every parser: one whose options it cannot see would pass unread.
      expect({ file, read: taken.length > 0 }).toEqual({ file, read: text.includes("parseArgs({") });
      // A file that owns no verb parses for another's: `health.ts` for `hosts`.
      const own = blocks.filter((each) => each.file === file);
      const help = (own.length > 0 ? own : blocks).map(({ block }) => block).join("\n");
      missing.push(
        ...taken.filter((option) => !help.includes(`--${option}`)).map((option) => `${file} --${option}`),
      );
    }
    expect(missing).toEqual([]);
  });

  test("a verb given words it cannot act on answers with its usage and exits 1", async () => {
    const usage = (await runs("status", "--help")).out.split("\n")[1]?.trim() ?? "";
    // A flag the parser does not take, an argument it does not take, and a verb's own refusal.
    const [flag, word, bare] = await Promise.all([
      runs("status", "--nope"),
      runs("status", "a-name"),
      runs("stop"),
    ]);
    expect([flag.code, flag.out, flag.err]).toEqual([1, "", `Unknown option '--nope'\nusage: ${usage}\n`]);
    expect([word.code, word.err.split("\n")[1]]).toEqual([1, `usage: ${usage}`]);
    expect([bare.code, bare.err]).toEqual([1, "usage: bun run runs stop <name> ... [--yes]\n"]);
    // A refusal that is no misuse keeps its one line.
    const refused = await runs("stop", "no-such-run");
    expect([refused.code, refused.err.includes("usage:")]).toEqual([1, false]);
  });
});
