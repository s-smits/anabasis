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

  it.each([6, 7])("stops a run at %i promotions before waiting for one at five", (promotions) => {
    const made = fakeHosts();
    fixtures.push(made.root);
    const row = (name: string, live: boolean, count: number) => ({
      name,
      host: "here",
      live,
      promotions: count,
      compared: count,
      ending: null,
      hours: 0,
    });
    const reached = row("reached", true, promotions);
    const short = row("short", true, 5);
    const rows = [reached, short, row("kept", true, 7), row("closed", false, 7)];
    const read = () =>
      made.runScript(SCRIPT, ["reached", "short", "closed", "--keep", "kept"], {
        FAKE_PREPARED: JSON.stringify(rows),
      });

    const stop = read();
    expect(stop.code).toBe(0);
    expect(stop.out).toContain("step: stop");
    expect(stop.out.split("\n").filter((line) => line.includes("runs stop"))).toEqual([
      "  bun --env-file=.env.runs run runs stop reached --yes",
    ]);
    reached.live = false;
    const running = read();
    expect(running.code).toBe(0);
    expect(running.out).toContain("step: run · short 5/6");
    short.live = false;
    const closed = read();
    expect(closed.code).toBe(0);
    expect(closed.out).toContain("step: investigate");
  });

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
