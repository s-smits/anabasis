// `runs source` says how each launch's flags and login moved from the launch before, and never a
// path, an env file's name or a login.
import { afterAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { sources } from "../tools/runs/receipt.ts";

const folder = mkdtempSync(join(tmpdir(), "source-flags-"));
afterAll(() => rmSync(folder, { recursive: true, force: true }));

const receipt = (session: string, at: string, flags: readonly string[], login?: string) =>
  writeFileSync(
    join(folder, `launch-${session}.json`),
    JSON.stringify({
      at,
      pid: 1,
      flags,
      envFile: null,
      commit: "c0ffee",
      dirty: false,
      load: 1,
      cores: 4,
      login,
    }),
  );

describe("runs source flags", () => {
  it("names the first launch's flags, then what each later launch added, dropped or changed", () => {
    receipt(
      "run-1",
      "2026-11-01T00:00:00.000Z",
      ["--name", "r", "--budget", "300", "--pack", "/p/pack-q"],
      "7",
    );
    receipt(
      "run-2",
      "2026-11-01T01:00:00.000Z",
      ["--name", "r", "--budget", "400", "--pack", "/p/pack-z", "--after", "--env-file=/k/secret.env"],
      "9",
    );
    receipt(
      "run-3",
      "2026-11-01T02:00:00.000Z",
      ["--name", "r", "--budget", "400", "--pack", "/p/pack-z", "--after"],
      "9",
    );
    const lines = sources(join(folder, "log.jsonl"), folder, []).filter((line) => line.includes("flags"));
    expect(lines[0]).toBe("  flags --name --budget --pack");
    expect(lines[1]).toContain("login changed");
    for (const moved of [
      "--budget 400 (changed)",
      "--pack (not shown) (changed)",
      "added --after",
      "added --env-file (not shown)",
    ]) {
      expect(lines[1]).toContain(moved);
    }
    expect(lines[2]).toBe("  same login; flags dropped --env-file");
    const said = lines.join("\n");
    for (const hidden of ["pack-q", "pack-z", "secret", "/k/", " 7", " 9"]) {
      expect(said).not.toContain(hidden);
    }
  });
});
