/**
 * The suite's wrapper: a failed test is the verdict at any load, with `ANA_TEST_BAIL` as every proof
 * of the pre-push hook and `bun run land` runs it, and without it as CI does. The host's load is
 * pinned through `ANA_TEST_HOST_LOAD`.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { capturedExecPath, runtimeProcess } from "../src/meta/process.ts";

import { afterAll, describe, expect, it } from "bun:test";

import { spawnTextSync } from "./helpers/bun-spawn-sync.ts";

const suite = join(import.meta.dir, "..", "tools", "runtime", "test-suite.ts");
const fixture = mkdtempSync(join(tmpdir(), "ana-suite-bail-"));
afterAll(() => rmSync(fixture, { recursive: true, force: true }));

/** Runs a file that passes on any later run and a file after it, at the given load. `first` is the
 *  body of its one test, which fails the first time it runs. */
function suiteAt(load: string, bail: boolean, first = "expect(seen).toBe(true);") {
  const work = mkdtempSync(join(fixture, "run-"));
  const marker = join(work, "marker");
  const after = join(work, "after");
  writeFileSync(
    join(work, "a-flaky.test.ts"),
    `import { expect, it } from "bun:test";
import { existsSync, writeFileSync } from "node:fs";
it("fails its first run only", async () => {
  const seen = existsSync(${JSON.stringify(marker)});
  writeFileSync(${JSON.stringify(marker)}, "");
  if (!seen) { ${first} }
}, 200);
`,
  );
  writeFileSync(
    join(work, "b-after.test.ts"),
    `import { it } from "bun:test";
import { appendFileSync } from "node:fs";
it("runs after the flaky file", () => appendFileSync(${JSON.stringify(after)}, "ran\\n"));
`,
  );
  const result = spawnTextSync(
    capturedExecPath,
    [suite, "--cwd", work, "./a-flaky.test.ts", "./b-after.test.ts"],
    {
      env: {
        ...Bun.env,
        // A proof sets it for this test too, so a run that does not bail clears it.
        ANA_TEST_BAIL: bail ? "1" : "",
        ANA_TEST_WORKERS: "1",
        ANA_TEST_HOST_LOAD: load,
      },
      timeout: 120_000,
    },
  );
  return {
    status: result.status,
    ran: existsSync(after) ? readFileSync(after, "utf8").split("\n").length - 1 : 0,
  };
}

it("ends a process a test left in a group of its own, which names the suite's root", () => {
  const work = mkdtempSync(join(fixture, "left-"));
  const pidFile = join(work, "pid");
  // A sleeper with the root on its command line, detached with its own stdio as the UI's browser
  // tests start serve.ts.
  writeFileSync(
    join(work, "leaves.test.ts"),
    `import { it } from "bun:test";
import { writeFileSync } from "node:fs";
import { tmpdir } from "${join(import.meta.dir, "..", "src", "meta", "os.ts")}";
it("starts a server and never stops it", () => {
  const left = Bun.spawn([process.execPath, "-e", "await Bun.sleep(300000)", tmpdir()], { detached: true, stdio: ["ignore", "ignore", "ignore"] });
  left.unref();
  writeFileSync(${JSON.stringify(pidFile)}, String(left.pid));
});
`,
  );
  const result = spawnTextSync(capturedExecPath, [suite, "--cwd", work, "./leaves.test.ts"], {
    env: { ...Bun.env, ANA_TEST_WORKERS: "1" },
    timeout: 120_000,
  });
  const pid = Number(readFileSync(pidFile, "utf8"));
  const alive = () => {
    try {
      runtimeProcess.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  const left = alive();
  if (left) runtimeProcess.kill(pid, "SIGKILL");
  expect({ status: result.status, left }).toEqual({ status: 0, left: false });
});

describe("a failed test", () => {
  it.each(["0", "999"])("stops a bailing run at a load of %s, and the files after it never run", (load) => {
    expect(suiteAt(load, true)).toEqual({ status: 1, ran: 0 });
  });

  it("stands on a crowded host where a run goes on to the files after it", () => {
    expect(suiteAt("999", false)).toEqual({ status: 1, ran: 1 });
  });

  it("stands on a crowded host where its clock ended it", () => {
    expect(suiteAt("999", true, "await Bun.sleep(5000);")).toEqual({ status: 1, ran: 0 });
  });
});
