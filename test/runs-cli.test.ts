/**
 * `bun run runs` with no verb lists every verb with what it does, and `<verb> --help` prints the
 * usage the head of its file states, so an agent learns the CLI from the CLI.
 */
import { describe, expect, test } from "bun:test";

const CLI = `${import.meta.dir}/../tools/runs/cli.ts`;

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

describe("the runs CLI explains itself", () => {
  test("a bare command lists every verb with what it does and exits 0, and a wrong verb exits 1", async () => {
    const bare = await runs();
    expect(bare.code).toBe(0);
    const verbs = [...bare.out.matchAll(/^ {2}([a-z]+) {2,}\S/gmu)].map((match) => match[1]);
    expect(verbs).toContain("fresh");
    expect(verbs).toContain("loadwatch");
    expect(new Set(verbs).size).toBe(verbs.length);
    const wrong = await runs("nope");
    expect(wrong.code).toBe(1);
    expect(wrong.err).toContain("fresh");
  });

  test("every verb's --help prints its usage from its file's head, -h the same, and starts nothing", async () => {
    const verbs = [...(await runs()).out.matchAll(/^ {2}([a-z]+) {2,}\S/gmu)].map((match) => match[1] ?? "");
    const helps = await Promise.all(verbs.map(async (verb) => ({ verb, ...(await runs(verb, "--help")) })));
    for (const { verb, out, code } of helps) {
      // A head that states no usage of its verb leaves no line naming it.
      const usage = out.split("\n").filter((line) => line.startsWith("  ") && line.includes(`runs ${verb}`));
      expect({ verb, code, named: usage.length > 0 }).toEqual({ verb, code: 0, named: true });
    }
    const [long, short] = await Promise.all([runs("keep", "--help"), runs("keep", "-h")]);
    expect(short.out).toBe(long.out);
  });
});
