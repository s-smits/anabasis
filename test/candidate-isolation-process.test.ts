/**
 * The process half of the isolation runtime: what spawnCollected does with a child that will not
 * read its input, and what closing the controller does to a command still running. Neither case
 * needs a policy or a sandbox — they are about the lifetime of the child itself, which every
 * isolated command inherits.
 */
import { afterAll, expect, it } from "bun:test";
import { existsSync, readFileSync, realpathSync } from "../src/meta/filesystem.ts";
import { join } from "../src/meta/path.ts";
import { runtimeProcess } from "../src/meta/process.ts";
import { processGroupExists } from "../src/meta/subprocess.ts";
import { spawnCollected, stopIsolatedCommands } from "../src/builder/candidate-isolation-runtime.ts";
import { cleanupScratch, scratchDir } from "./helpers/scratch.ts";

const SCRATCH = realpathSync.native(scratchDir("ana-isolation-"));
afterAll(cleanupScratch);

it("drains output while writing input and reaps a child that rejects its stdin", async () => {
  const payload = "x".repeat(1024 * 1024);
  const outcome = await spawnCollected(
    Bun.argv[0]!,
    [
      "--no-env-file",
      "-e",
      'await Bun.write(Bun.stdout, "y".repeat(1024 * 1024)); console.error((await new Response(Bun.stdin.stream()).text()).length);',
    ],
    SCRATCH,
    Bun.env,
    { stdin: payload },
  );
  expect(outcome.status).toBe(0);
  expect(outcome.stdout).toBe("y".repeat(1024 * 1024));
  expect(outcome.stderr.trim()).toBe(String(payload.length));
  const marker = join(SCRATCH, "closed-stdin-pid");
  await expect(
    spawnCollected(
      Bun.argv[0]!,
      [
        "--no-env-file",
        "-e",
        `import { closeSync, writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(marker)}, String(process.pid)); closeSync(0); await Bun.sleep(30000);`,
      ],
      SCRATCH,
      Bun.env,
      { stdin: payload },
    ),
  ).rejects.toThrow(/EPIPE/);
  const pid = Number(await Bun.file(marker).text());
  expect(pid).toBeGreaterThan(1);
  expect(() => runtimeProcess.kill(pid, 0)).toThrow(/ESRCH/);
});

// GNU `timeout` without `--foreground` and `setsid` leave the command's process group, so a kill of
// that group misses them while they still hold its output pipes and the runner waits on them. Perl
// does the same with `setpgrp` and then writes its pid, so the stop comes only after the escape.
const stops: Array<[string, (controller: AbortController) => void]> = [
  ["the controller closes", () => stopIsolatedCommands()],
  ["its caller aborts", (controller) => controller.abort()],
];
it.each(stops)("stops a live isolated command and what left its group when %s", async (label, stop) => {
  const marker = join(SCRATCH, `escaped-${label.replaceAll(" ", "-")}`);
  const controller = new AbortController();
  const running = spawnCollected(
    "/bin/sh",
    [
      "-c",
      `perl -e 'setpgrp(0, 0); open(my $f, ">", $ARGV[0]); print $f $$; close($f); sleep 20' ${marker}; true`,
    ],
    SCRATCH,
    Bun.env,
    { signal: controller.signal },
  );
  let escaped = 0;
  for (let waited = 0; waited < 400 && escaped <= 1; waited += 1) {
    await Bun.sleep(25);
    escaped = existsSync(marker) ? Number(readFileSync(marker, "utf8")) : 0;
  }
  const alive = () => processGroupExists(escaped);
  try {
    expect(escaped).toBeGreaterThan(1);
    const stopped = Date.now();
    stop(controller);
    const outcome = await running;
    expect(Date.now() - stopped).toBeLessThan(5_000);
    expect(outcome.signal).toBe("SIGKILL");
    expect(outcome.timedOut).toBe(false);
    for (let waited = 0; waited < 40 && alive(); waited += 1) await Bun.sleep(50);
    expect(alive()).toBe(false);
  } finally {
    if (alive()) runtimeProcess.kill(escaped, "SIGKILL");
  }
});

// The shell backgrounds perl and exits, so perl leads its own group under launchd by the time the
// controller closes, as run -35's QEMU did: no live command's tree reaches it any more.
it("stops an orphan that names the closing run's campaign and leaves another run's alone", async () => {
  const orphan = async (campaign: string) => {
    const marker = join(campaign, "orphan-pid");
    Bun.spawnSync(["/bin/mkdir", "-p", campaign]);
    Bun.spawnSync([
      "/bin/sh",
      "-c",
      `perl -e 'setpgrp(0, 0); sleep 20' ${marker} </dev/null >/dev/null 2>&1 & echo $! > ${marker}`,
    ]);
    return Number(readFileSync(marker, "utf8"));
  };
  const closing = await orphan(join(SCRATCH, "campaigns", "closing"));
  const other = await orphan(join(SCRATCH, "campaigns", "closing-2"));
  try {
    stopIsolatedCommands(join(SCRATCH, "campaigns", "closing"));
    for (let waited = 0; waited < 40 && processGroupExists(closing); waited += 1) await Bun.sleep(50);
    expect(processGroupExists(closing)).toBe(false);
    expect(processGroupExists(other)).toBe(true);
  } finally {
    for (const pid of [closing, other]) if (processGroupExists(pid)) runtimeProcess.kill(pid, "SIGKILL");
  }
});

it("kills a command whose caller aborted before it started", async () => {
  const controller = new AbortController();
  controller.abort();
  const started = Date.now();
  const early = await spawnCollected("/bin/sleep", ["30"], SCRATCH, Bun.env, { signal: controller.signal });
  expect(early.signal).toBe("SIGKILL");
  expect(Date.now() - started).toBeLessThan(5_000);
});
