/**
 * Chrome's start, as `launchBrowser` bounds it (`browser.ts`), with a program in Chrome's place
 * (`ANA_UI_CHROME`) that records each process it is started as: one that never answers, and one that
 * exits at once. No browser runs here.
 */
import { afterAll, afterEach, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "../../../src/meta/filesystem.ts";
import { tmpdir } from "../../../src/meta/os.ts";
import { join } from "../../../src/meta/path.ts";
import { processGroupExists } from "../../../src/meta/subprocess.ts";
import { launchBrowser } from "./browser.ts";

const scratch = mkdtempSync(join(tmpdir(), "ana-ui-start-"));
const named = Bun.env.ANA_UI_CHROME;
afterEach(() => {
  if (named === undefined) delete Bun.env.ANA_UI_CHROME;
  else Bun.env.ANA_UI_CHROME = named;
});
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/** Puts a shell program `name` in Chrome's place that notes its process and then runs `then`, and
 *  returns the processes it has been started as so far. */
function inChromesPlace(name: string, then: string): () => number[] {
  const starts = join(scratch, `${name}.starts`);
  const program = join(scratch, name);
  writeFileSync(starts, "");
  writeFileSync(program, `#!/bin/sh\necho $$ >> '${starts}'\n${then}\n`);
  chmodSync(program, 0o755);
  Bun.env.ANA_UI_CHROME = program;
  return () => readFileSync(starts, "utf8").split("\n").filter(Boolean).map(Number);
}

/** What a launch failed with, or `launched`. */
function failureOf(launch: Promise<unknown>): Promise<string> {
  return launch.then(() => "launched", String);
}

test("a Chrome that never answers is started once more, its second stall fails the launch, and neither is left running", async () => {
  const started = inChromesPlace("silent", "exec sleep 300");
  expect(await failureOf(launchBrowser(1500))).toContain("Chrome stalled at its start twice, 1500 ms each");
  expect(started()).toHaveLength(2);
  expect(started().filter(processGroupExists)).toEqual([]);
});

test("a Chrome that cannot run fails the launch at once and is not started again", async () => {
  const started = inChromesPlace("broken", "exit 3");
  const failure = await failureOf(launchBrowser(1500));
  expect(failure).not.toBe("launched");
  expect(failure).not.toContain("stalled");
  expect(started()).toHaveLength(1);
});
