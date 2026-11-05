// The Python `bun run runs sync` keeps on a host is the first `python3` a seat's command finds, on the
// operating system this suite runs on, and the home it lies in stays closed. Each case is a child with
// a home of its own, since the wall reads the home as a process starts. The pin is a stand-in, as the
// test holds no download: a real one was run by hand on 5 November, and the PR says on which system.
import { afterAll, describe, expect, test } from "bun:test";
import {
  chmodSync,
  mkdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { parseJsonAs } from "../src/meta/json-runtime.ts";
import { dirname, join } from "../src/meta/path.ts";
import { capturedExecPath, runtimeProcess } from "../src/meta/process.ts";
import { decodeOutput, runSync } from "../src/meta/subprocess.ts";
import { pinnedPythonDir } from "../src/wall/policy.ts";
import { toolchainTemp } from "./helpers/toolchain-temp.ts";

const REPO = realpathSync(join(import.meta.dir, ".."));
const made: string[] = [];
afterAll(() => {
  for (const path of made) rmSync(path, { recursive: true, force: true });
});
function temp(prefix: string): string {
  const dir = toolchainTemp(prefix);
  made.push(dir);
  return dir;
}

/** What each command says in a seat on a machine whose home is `home`. */
function inSeat(home: string, commands: readonly string[]): string[] {
  const { exitCode, stdout, stderr } = runSync(
    [
      capturedExecPath,
      join(import.meta.dir, "helpers/walled-commands.ts"),
      temp("ana-pinned-repo"),
      ...commands,
    ],
    { cwd: REPO, env: { ...runtimeProcess.env, HOME: home }, timeout: 60_000 },
  );
  expect(decodeOutput(stderr)).toBe("");
  expect(exitCode).toBe(0);
  return parseJsonAs<string[]>(decodeOutput(stdout));
}

describe("the pinned Python", () => {
  test("a seat runs it first from a home it otherwise cannot read", () => {
    const home = temp("ana-pinned-home");
    const pin = pinnedPythonDir(home);
    const bin = join(dirname(pin), "versions", "stand-in", "bin");
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, "python3"), "#!/bin/sh\necho pinned stand-in\n");
    chmodSync(join(bin, "python3"), 0o755);
    symlinkSync("versions/stand-in/bin", pin);
    writeFileSync(join(home, "held-back"), "the operator's own\n");

    const [path, answer, refused] = inSeat(home, [
      "command -v python3",
      "python3",
      `cat ${join(home, "held-back")} 2>&1 || echo refused`,
    ]);
    expect(path).toBe(join(pin, "python3"));
    expect(answer).toBe("pinned stand-in");
    expect(refused).toContain("refused");
    expect(refused).not.toContain("the operator's own");
  });

  test("a machine with no pin has none on its path, and finds what it always found", () => {
    const home = temp("ana-pinned-home");
    const [path] = inSeat(home, ["command -v python3 || echo none"]);
    expect(path).not.toContain("ana-python");
    expect(path).not.toContain(home);
  });
});
