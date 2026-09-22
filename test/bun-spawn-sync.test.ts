import { describe, expect, it } from "bun:test";
import { execTextSync, spawnTextSync } from "./helpers/bun-spawn-sync.ts";

describe("Bun synchronous subprocess owner", () => {
  it("preserves argv, stdin, environment, cwd and UTF-8 output without a shell", () => {
    const output = execTextSync(
      Bun.argv[0]!,
      [
        "--no-env-file",
        "-e",
        "const input = await Bun.stdin.text(); console.log(JSON.stringify({input, value: Bun.env.VALUE, cwd: process.cwd()}));",
      ],
      { cwd: import.meta.dir, env: { VALUE: "exact" }, stdin: "payload" },
    );
    expect(JSON.parse(output)).toEqual({ input: "payload", value: "exact", cwd: import.meta.dir });
  });

  it("throws a failure whose message names the status and the captured output", () => {
    try {
      execTextSync(Bun.argv[0]!, [
        "--no-env-file",
        "-e",
        "console.log('out'); console.error('err'); process.exit(7)",
      ]);
      throw new Error("expected command failure");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      // The message, because that is the only part of a thrown Error Bun shows a reader.
      expect(String(error)).toBe(`Error: command failed (7): ${Bun.argv[0]}\nstdout: out\nstderr: err`);
    }
  });

  it("returns non-zero status and signal facts without throwing for probe owners", () => {
    const result = spawnTextSync(Bun.argv[0]!, [
      "--no-env-file",
      "-e",
      "console.log('probe'); process.kill(process.pid, 'SIGTERM')",
    ]);
    expect(result).toMatchObject({ status: null, signal: "SIGTERM", stdout: "probe\n" });
  });

  it("returns a typed start error for a missing executable", () => {
    const result = spawnTextSync("ana-definitely-missing-executable", []);
    expect(result).toMatchObject({ status: null, signal: null, stdout: "", stderr: "" });
    expect(result.error).toBeInstanceOf(Error);
  });
});

describe("Bun piped subprocess owner", () => {
  it("returns Bun's native streams, sink and exited promise", async () => {
    const child = Bun.spawn({
      cmd: [
        Bun.argv[0]!,
        "--no-env-file",
        "-e",
        "for await (const chunk of Bun.stdin.stream()) await Bun.write(Bun.stdout, chunk)",
      ],
      cwd: import.meta.dir,
      env: Bun.env,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    await child.stdin.write("native\n");
    await child.stdin.end();
    expect(await new Response(child.stdout).text()).toBe("native\n");
    expect(await child.exited).toBe(0);
  });
});
