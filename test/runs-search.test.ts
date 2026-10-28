// Search must recover old analyses without reading credentials or letting one peer hide the rest.
import { afterAll, describe, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { dirname, join, resolve } from "../src/meta/path.ts";
import { capturedExecPath } from "../src/meta/process.ts";
import { runSync, runTextSyncOrThrow } from "../src/meta/subprocess.ts";
import { search, searchLocal } from "../tools/runs/search.ts";
import { fakeHosts as hostFixture } from "./helpers/fake-hosts.ts";

const root = mkdtempSync(join(tmpdir(), "ana-runs-search-test-"));
const spills: string[] = [];
const log = ".ana/d2/old/log.jsonl";
const note = "notes/analysis.md";
const query = { pattern: "needle", regex: false, ignoreCase: false };
const fakeHosts = ["first", "second"].map((name) => ({ name, ssh: "unused", tree: "/unused", bun: "bun" }));
const fixture = (path: string, text: string) => {
  const target = join(root, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, text);
  return target;
};
fixture(log, "before\nneedle in a log\nNEEDLE in capitals\nliteral a.b\n");
fixture(note, `needle in notes\r\n${"x".repeat(450)}needle${"z".repeat(500)}\nlast needle`);
fixture("data/runs/here/retired/log.jsonl", "archived needle\n");
for (const path of [
  "notes/.env",
  "notes/.env.local",
  "notes/.accounts/login",
  "notes/private.key",
  "notes/credentials.json",
  "notes/node_modules/a.txt",
  "notes/.git/config",
]) {
  fixture(path, "needle PRIVATE_SENTINEL\n");
}
symlinkSync(join(root, "notes/.env"), join(root, "notes/linked.txt"));
afterAll(() => {
  rmSync(root, { recursive: true, force: true });
  for (const spill of spills) rmSync(dirname(spill), { recursive: true, force: true });
});

describe("searching logs and notes", () => {
  test("finds log and note lines while excluding credentials and links", async () => {
    const found = await searchLocal(query, [root]);
    expect(found.matches).toHaveLength(5);
    expect(found.matches.some((match) => match.path === join(root, log) && match.line === 2)).toBe(true);
    expect(found.matches.some((match) => match.path === join(root, note) && match.line === 3)).toBe(true);
    expect(JSON.stringify(found)).not.toContain("PRIVATE_SENTINEL");
    expect((await searchLocal({ ...query, ignoreCase: true }, [root])).matches).toHaveLength(6);
    expect((await searchLocal({ ...query, pattern: "a.b" }, [root])).matches).toHaveLength(1);
    expect((await searchLocal({ ...query, pattern: "a[.]b$", regex: true }, [root])).matches).toHaveLength(1);
  });

  test("asks peers once alongside the local search and retains matches when a peer fails", async () => {
    const pending = Promise.withResolvers<void>();
    const output: string[] = [];
    let asked = 0;
    await search(["needle", "--max", "10000"], {
      hosts: fakeHosts,
      local: async (request) => {
        await pending.promise;
        return await searchLocal(request, [join(root, log)]);
      },
      transport: async (script, args, targets, mode) => {
        asked += 1;
        expect(script).toBe("tools/runs/search.ts");
        expect(args).toEqual(["--in", "all", "--", "needle"]);
        expect(targets).toHaveLength(1);
        expect(mode).toBe("configured");
        if (asked === 2) pending.resolve();
        return (targets ?? []).map((host) => ({
          host,
          elapsedMs: 1,
          lines:
            host.name === "second"
              ? null
              : [
                  JSON.stringify({
                    matches: [{ path: "old.log", line: 7, text: "remote needle", at: 7 }],
                  }),
                ],
        }));
      },
      print: (text) => output.push(text),
    });
    expect(asked).toBe(2);
    expect(output.join("\n")).toContain(`here ${join(root, log)}:2: needle in a log`);
    expect(output.join("\n")).toContain("first old.log:7: remote needle");
    expect(output.join("\n")).toContain("second: search failed");
    expect(output.join("\n")).toContain("first: 1 found");
  });

  test("caps match characters and spills every whole match when a line or total is cut", async () => {
    for (const max of ["180", "10000"]) {
      const output: string[] = [];
      await search(["needle", "--here", "--max", max], {
        hosts: [],
        local: (request) => searchLocal(request, [join(root, note)]),
        print: (text) => output.push(text),
      });
      const report = output.at(-1) ?? "";
      const spill = report.split("full output: ")[1];
      expect(spill).toBeDefined();
      if (spill === undefined) throw new Error("spill path missing");
      spills.push(spill);
      const whole = readFileSync(spill, "utf8");
      expect(whole.split("\n").filter((line) => line !== "")).toHaveLength(3);
      expect(whole).toContain(`${"x".repeat(450)}needle${"z".repeat(500)}`);
      const printed = output.slice(1, -1).join("\n");
      expect(printed.length).toBeLessThanOrEqual(Number(max));
      for (const line of printed.split("\n").filter((row) => row !== "")) {
        expect((line.split(": ").at(-1) ?? "").length).toBeLessThanOrEqual(300);
      }
      if (max === "10000") expect(printed).toContain("needle");
    }
  });
});

describe("search transport and discovery", () => {
  test("uses one configured-tree ssh command per host, each searching with its own rg", () => {
    const made = hostFixture();
    try {
      mkdirSync(join(made.main, "notes"));
      writeFileSync(join(made.main, "notes", "remote.txt"), "remote needle\n");
      // The fake host's PATH holds no Homebrew directory, where a macOS CI runner keeps its rg.
      symlinkSync(Bun.which("rg") ?? "rg", join(made.root, "bin", "rg"));
      const peer = { ...made.host, name: "offline", ssh: "fake-offline" };
      const result = made.run(
        `import { search } from "REPOSITORY/tools/runs/search.ts";
       await search(["needle"], { local: async () => ({ matches: [] }) });`,
        {
          ANA_HOSTS: JSON.stringify([made.host, peer]),
          ANA_SEARCH_ROOTS: "[]",
          FAKE_EXECUTE: "1",
          FAKE_RUN_CLI: "1",
          FAKE_FLEET: JSON.stringify({ "fake-offline": { offline: true } }),
        },
      );
      expect(result.code).toBe(0);
      expect(result.out).toContain("runner: 1 found");
      expect(result.out).toContain("remote needle");
      expect(result.out).toContain("offline: search failed");
      const calls = made.recorded().filter((call) => call.tool === "ssh");
      expect(calls).toHaveLength(2);
      expect(calls.every((call) => call.args.at(-1)?.includes("tools/runs/search.ts") === true)).toBe(true);
      expect(made.recorded().some((call) => call.args.includes("fetch"))).toBe(false);
    } finally {
      rmSync(made.root, { recursive: true, force: true });
    }
  });

  test("discovers campaign folders, the archive and private note roots from a fixture repository", () => {
    runTextSyncOrThrow(["git", "init", "-q", root]);
    const script = resolve("tools/runs/search.ts");
    const extra = fixture("private/transcript.txt", "private needle\n");
    const env = { ...process.env, ANA_HOSTS: "[]", ANA_SEARCH_ROOTS: JSON.stringify([dirname(extra)]) };
    const run = (scope: string) => {
      const result = runSync([capturedExecPath, script, "needle", "--in", scope], { cwd: root, env });
      expect(result.exitCode).toBe(0);
      return result.stdout.toString();
    };
    const logs = run("logs");
    expect(logs).toContain("archived needle");
    expect(logs).toContain("needle in a log");
    expect(logs).not.toContain("needle in notes");
    const notes = run("notes");
    expect(notes).toContain("private needle");
    expect(notes).not.toContain("needle in a log");
    expect(run("all")).not.toContain("PRIVATE_SENTINEL");
    fixture("notes/dash.txt", "-literal\n");
    const publicVerb = runSync(
      [capturedExecPath, resolve("tools/runs/cli.ts"), "search", "--here", "--in", "notes", "--", "-literal"],
      { cwd: root, env },
    );
    expect(publicVerb.exitCode).toBe(0);
    expect(publicVerb.stdout.toString()).toContain("dash.txt:1: -literal");
  });
});
