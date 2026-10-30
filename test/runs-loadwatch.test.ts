// The load watch reads every configured host through the shared ssh command, and a host that
// cannot be reached shows as such rather than holding the frame.
import { afterAll, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join, resolve } from "../src/meta/path.ts";
import { capturedExecPath } from "../src/meta/process.ts";
import { runSync } from "../src/meta/subprocess.ts";

const bin = mkdtempSync(join(tmpdir(), "ana-loadwatch-test-"));
afterAll(() => rmSync(bin, { recursive: true, force: true }));
// A stand-in ssh: the host `gone` refuses the connection, any other runs the command it was given here.
writeFileSync(
  join(bin, "ssh"),
  `#!/bin/sh\nfor last; do :; done\ncase " $* " in *" gone "*) exit 255;; esac\nexec /bin/sh -c "$last"\n`,
);
chmodSync(join(bin, "ssh"), 0o755);

test("one frame reads this machine and a reachable host, and names an unreachable one", () => {
  const hosts = [
    { name: "peer", ssh: "peer", tree: "/unused", bun: "bun" },
    { name: "lost", ssh: "gone", tree: "/unused", bun: "bun" },
  ];
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH ?? ""}`,
    SHELL: "/bin/sh",
    ANA_HOSTS: JSON.stringify(hosts),
  };
  const result = runSync([capturedExecPath, resolve("tools/runs/cli.ts"), "loadwatch", "1", "--once"], {
    env,
  });
  expect(result.exitCode).toBe(0);
  const frame = Bun.stripANSI(result.stdout.toString());
  const blocks = frame.split("\n\n").slice(1, -1);
  expect(blocks).toHaveLength(3);
  for (const block of blocks.slice(0, 2)) {
    expect(block).toMatch(/^\S+ +\d+ cores\n {2}cpu now .* +\d+%\n {2}load 1m .*\(\d+\.\d\d\)/u);
  }
  expect(blocks[1]?.startsWith("peer ")).toBe(true);
  expect(blocks[2]).toMatch(/^lost +UNREACHABLE\n/u);
});

test("a malformed interval is refused with the usage line", () => {
  const result = runSync([capturedExecPath, resolve("tools/runs/cli.ts"), "loadwatch", "soon"], {
    env: { ...process.env, ANA_HOSTS: "[]" },
  });
  expect(result.exitCode).not.toBe(0);
  expect(result.stderr.toString()).toContain("usage: runs loadwatch");
});
