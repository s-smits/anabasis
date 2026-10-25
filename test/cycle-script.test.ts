// The release cycle's reader of the runs, through its command line. On a host (`--here`) it prints
// the rows of the runs it finds as JSON, which it can only do once its host imports have loaded.
// Other hosts are asked through the shared transport, and a run no host answered for stays unread.
import { afterAll, describe, expect, it } from "bun:test";
import { append, LOG_FILE } from "../src/kernel/log.ts";
import { mkdirSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import type { JsonObject } from "../src/meta/json-shape.ts";
import { join } from "../src/meta/path.ts";
import { capturedExecPath } from "../src/meta/process.ts";
import { runSync } from "../src/meta/subprocess.ts";
import { fakeHosts } from "./helpers/fake-hosts.ts";

const SCRIPT = ".claude/skills/run-improvement-campaign/scripts/cycle.ts";
const fixtures: string[] = [];

afterAll(() => {
  for (const root of fixtures) rmSync(root, { recursive: true, force: true });
});

describe("cycle.ts", () => {
  it("prints no rows on a host that holds none of the named runs", () => {
    const result = runSync([capturedExecPath, SCRIPT, "--here", "no-such-run-for-the-cycle-test"]);
    expect(new TextDecoder().decode(result.stdout).trim()).toBe("[]");
    expect(result.exitCode).toBe(0);
  }, 30_000);

  it("reads a run in a peer's quoted tree, and leaves it unread where the peer fails or is silent", () => {
    const made = fakeHosts();
    fixtures.push(made.root);
    const tree = join(made.root, "peer's tree");
    const folder = join(tree, ".ana", "d2", "distant");
    mkdirSync(folder, { recursive: true });
    append(join(folder, LOG_FILE), "campaign.ended", { ending: "finished" });
    // A stand-in for the script that prints a valid row and then fails: its exit status refuses the row.
    const failing = join(made.root, "failing");
    mkdirSync(join(failing, ".claude/skills/run-improvement-campaign/scripts"), { recursive: true });
    const row = {
      name: "distant",
      host: "here",
      live: false,
      promotions: 0,
      compared: 0,
      ending: null,
      hours: 0,
    };
    writeFileSync(
      join(failing, SCRIPT),
      `console.log(${JSON.stringify(JSON.stringify([row]))}); process.exit(6);`,
    );
    const ask = (peer: JsonObject, extra: Record<string, string> = {}) =>
      made.runScript(SCRIPT, ["distant"], {
        ANA_HOSTS: JSON.stringify([{ ...made.host, tree }]),
        FAKE_FLEET: JSON.stringify({ [made.host.ssh]: { execute: true, ...peer } }),
        ...extra,
      });
    const read = ask({ env: { FAKE_MAIN: tree, FAKE_RUN_CLI: "1" } });
    expect(read.out).toContain("distant · runner · closed (finished)");
    expect(read.out).toContain("step: investigate");
    expect(read.code).toBe(0);
    const unread = "step: unread · not found on any host that answered: distant";
    const failed = ask({ env: { FAKE_REPO: failing, FAKE_RUN_CLI: "1" } });
    expect({ out: failed.out.trim(), code: failed.code }).toEqual({ out: unread, code: 1 });
    expect(failed.err).toContain("exit 6");
    const silent = ask({}, { FAKE_OFFLINE: "1" });
    expect({ out: silent.out.trim(), code: silent.code }).toEqual({ out: unread, code: 1 });
  }, 60_000);
});
