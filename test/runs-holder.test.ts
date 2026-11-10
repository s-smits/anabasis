// The run CLI's one lock: held while its process lives however long it holds, taken over once that
// process is gone or its pid names a later process, read whole at any instant, and won by one of
// many takers.
import { afterAll, describe, expect, it } from "bun:test";
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { hostname, tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { capturedExecPath, capturedSpawn } from "../src/meta/process.ts";
import { decodeOutput, runSync } from "../src/meta/subprocess.ts";
import { dropCutWrites, held, hold, release } from "../tools/runs/holder.ts";
import { CUT_PART } from "../tools/wri/embed.ts";

const scratches: string[] = [];
const scratch = (): string => {
  const made = mkdtempSync(join(tmpdir(), "ana-holder-"));
  scratches.push(made);
  return made;
};
afterAll(() => {
  for (const made of scratches) rmSync(made, { recursive: true, force: true });
});

const startOf = (pid: number): string =>
  decodeOutput(runSync(["/bin/ps", "-o", "lstart=", "-p", String(pid)]).stdout).trim();
const record = (file: string, pid: number, host = hostname(), start = startOf(pid)): void => {
  rmSync(file, { force: true });
  symlinkSync(`${String(pid)} ${host} ${start}`, file);
};
/** Whether `file` is there, as a link that points nowhere is too. */
const there = (file: string): boolean => lstatSync(file, { throwIfNoEntry: false }) !== undefined;
const holderPath = JSON.stringify(join(import.meta.dir, "..", "tools", "runs", "holder.ts"));

describe("holder", () => {
  it("holds while its process lives, however long past any window", async () => {
    const file = join(scratch(), "pass.lock");
    const holder = capturedSpawn(["sleep", "30"]);
    record(file, holder.pid);
    expect(held(file)).toBe(true);
    expect(hold(file)).toBe(false);
    holder.kill();
    await holder.exited;
    expect(held(file)).toBe(false);
  });

  it("is taken over once its process is gone", async () => {
    const file = join(scratch(), "pass.lock");
    const gone = capturedSpawn(["true"]);
    await gone.exited;
    record(file, gone.pid);
    expect(held(file)).toBe(false);
    expect(hold(file)).toBe(true);
    expect(readlinkSync(file)).toBe(`${String(process.pid)} ${hostname()} ${startOf(process.pid)}`);
    expect(hold(file)).toBe(false);
    release(file);
    expect(there(file)).toBe(false);
  });

  it("reads a holder whose pid names a later process as gone", () => {
    const file = join(scratch(), "pass.lock");
    record(file, process.pid, hostname(), "Thu Jan  1 00:00:00 1970");
    expect(held(file)).toBe(false);
    expect(hold(file)).toBe(true);
    release(file);
  });

  it("reads a record another host wrote as free, since only this host's processes take these locks", () => {
    const file = join(scratch(), "pass.lock");
    record(file, process.pid, "a-peer-host", startOf(process.pid));
    expect(held(file)).toBe(false);
  });

  it("reads a live holder's record whole at every instant it holds", async () => {
    const folder = scratch();
    const file = join(folder, "pass.lock");
    const holder = capturedSpawn([
      capturedExecPath,
      "-e",
      `import { hold } from ${holderPath}; hold(${JSON.stringify(file)}); await Bun.sleep(30000);`,
    ]);
    const until = performance.now() + 15_000;
    while (!held(file) && performance.now() < until) await Bun.sleep(20);
    let free = 0;
    // Past one beat of the old record, which was rewritten in place every ten seconds.
    const reading = performance.now() + 12_000;
    while (performance.now() < reading) {
      if (!held(file)) free += 1;
      await Bun.sleep(1);
    }
    holder.kill();
    await holder.exited;
    expect(free).toBe(0);
    expect(held(file)).toBe(false);
  }, 40_000);

  it("reads a file that names no process as free, and gives up only its own record", () => {
    const file = join(scratch(), "pass.lock");
    writeFileSync(file, String(process.pid));
    expect(held(file)).toBe(false);
    rmSync(file);
    record(file, 1, hostname(), "");
    release(file);
    expect(there(file)).toBe(true);
  });

  it("lets one of many takers win over a dead holder", async () => {
    const folder = scratch();
    const file = join(folder, "pass.lock");
    const gone = capturedSpawn(["true"]);
    await gone.exited;
    record(file, gone.pid);
    const taker = join(folder, "taker.ts");
    writeFileSync(
      taker,
      [
        `import { hold } from ${holderPath};`,
        // Every taker starts at one instant, so they meet at the takeover rather than one after another.
        `while (Date.now() < ${String(Date.now() + 3000)});`,
        `console.log(hold(${JSON.stringify(file)}));`,
        "await Bun.sleep(3000);",
      ].join("\n"),
    );
    const takers = Array.from({ length: 8 }, () =>
      capturedSpawn([capturedExecPath, taker], { stdout: "pipe" }),
    );
    const said = await Promise.all(takers.map(async (one) => (await new Response(one.stdout).text()).trim()));
    expect(said.filter((one) => one === "true")).toHaveLength(1);
    expect(said.filter((one) => one === "false")).toHaveLength(7);
  }, 30_000);

  it("drops a cut download's part once its writer is gone, and keeps a slow live one's however old", async () => {
    const folder = scratch();
    mkdirSync(join(folder, "onnx"));
    const dead = capturedSpawn(["true"]);
    await dead.exited;
    // The model library's name for a part, `FileCache.put`: `<file>.tmp.<pid>.<suffix>`.
    const slow = join(folder, "onnx", `model.onnx.tmp.${String(process.pid)}.k3x9`);
    const cut = join(folder, "onnx", `model.onnx.tmp.${String(dead.pid)}.a1b2`);
    const kept = join(folder, "config.json");
    const hourAgo = new Date(Date.now() - 60 * 60_000);
    for (const file of [slow, cut, kept]) {
      writeFileSync(file, "{}");
      utimesSync(file, hourAgo, hourAgo);
    }
    dropCutWrites(folder, CUT_PART, { deep: true });
    expect([slow, cut, kept].map(there)).toEqual([true, false, true]);
  });
});
