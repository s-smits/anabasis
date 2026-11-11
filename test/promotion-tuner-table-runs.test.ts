// `table.ts --runs <dir>` reads the campaigns under one folder with no hosts' registry and no env
// file, and names each campaign's host by the folder it is kept under, as `data/runs/<host>/<name>`.
import { afterAll, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join, resolve } from "../src/meta/path.ts";
import { execTextSync } from "./helpers/bun-spawn-sync.ts";

const ROOT = resolve(import.meta.dir, "..");
const home = realpathSync.native(mkdtempSync(join(tmpdir(), "ana-table-runs-")));
afterAll(() => rmSync(home, { recursive: true, force: true }));

function campaignAt(folder: string): void {
  mkdirSync(folder, { recursive: true });
  const events = [
    {
      at: "2026-11-01T00:00:00.000Z",
      kind: "campaign.opened",
      data: { project: "p", budget: { dollars: 10, reserve: 1 } },
    },
    { at: "2026-11-01T01:00:00.000Z", kind: "campaign.ended", data: { ending: "budget", why: "w" } },
  ];
  writeFileSync(join(folder, "log.jsonl"), events.map((event) => `${JSON.stringify(event)}\n`).join(""));
}

it("reads only the campaigns under the folder, each under the host its folder names", () => {
  campaignAt(join(home, "hostx", "kept-on-hostx"));
  campaignAt(join(home, "kept-here"));
  const out = execTextSync(
    "bun",
    [
      ".claude/skills/promotion-tuner/scripts/table.ts",
      "--runs",
      home,
      "--rows",
      "runs",
      "--format",
      "tsv",
      "--since",
      "2020-01-01",
    ],
    { cwd: ROOT, env: { ...Bun.env, ANA_HOSTS: undefined } },
  );
  const rows = out
    .trim()
    .split("\n")
    .slice(1)
    .map((row) => row.split("\t"));
  const named = (name: string) => rows.find((row) => row.includes(name));
  expect(rows).toHaveLength(2);
  expect(named("kept-on-hostx")).toContain("hostx");
  expect(named("kept-here")).toContain("here");
  expect(named("kept-here")).not.toContain("hostx");
});
