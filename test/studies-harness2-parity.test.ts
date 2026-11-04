// The TypeScript rollout against the pilot's own `jb_claude_runner.py`, on one recorded pilot task
// (statisticians/task2 under the Anabasis jobstat tree, label jb-anabasis1__statisticians__task2):
// both runners start one stand-in `claude` that logs its argv, environment, working directory and
// workspace, from one base environment, and the TypeScript side's deliverable is then judged by
// JobBench's real `eval/judge.py` against a stand-in OpenAI endpoint here. Then every arm of the
// pilot is scored again from a copy of its own store, where every rollout and judgement is on
// record, so `score.ts` starts nothing and its table must equal the pilot's `final.json`. No model
// is called.
// It reads the Python fork and its venv, so it runs only where HARNESS2_FORK names the fork
// (`h2src/h2fork`, with `../anabasis-arm/jobstat-tree` beside it), on this machine:
//   HARNESS2_FORK=<h2fork> RUN_REMOTE=0 bun run test -- test/studies-harness2-parity.test.ts
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { capturedJsonParse } from "../src/meta/json-runtime.ts";
import { isNumber, isRecord, isString, type JsonValue } from "../src/meta/json-shape.ts";
import { tmpdir } from "../src/meta/os.ts";
import { dirname, join } from "../src/meta/path.ts";
import { capturedExecPath, runtimeProcess } from "../src/meta/process.ts";
import { decodeOutput, runCaptured, runSync } from "../src/meta/subprocess.ts";

const FORK = runtimeProcess.env.HARNESS2_FORK ?? "";
const TASK = "statisticians/task2";
const LABEL = "jb-anabasis1__statisticians__task2";
const SCORE = new URL("../studies/harness2/score.ts", import.meta.url).pathname;
const WORKSPACE = /\/hevo_ws_cc\/statisticians_task2_jb-anabasis1__statisticians__task2_\d+$/u;

const field = (value: JsonValue | undefined, ...keys: string[]): JsonValue | undefined =>
  keys.reduce<JsonValue | undefined>((at, key) => (isRecord(at) ? at[key] : undefined), value);
const rowsOf = (path: string): JsonValue[] =>
  existsSync(path)
    ? readFileSync(path, "utf8")
        .split("\n")
        .filter((line) => line.trim().startsWith("{"))
        .map((line) => capturedJsonParse(line))
    : [];

describe.skipIf(FORK === "")(
  "the TypeScript rollout against jb_claude_runner.py on a recorded pilot task",
  () => {
    const jb = join(FORK, "dependencies", "job-bench-eval");
    const tree = join(dirname(FORK), "anabasis-arm", "jobstat-tree");
    const root = realpathSync(mkdtempSync(join(tmpdir(), "ana-study-harness2-parity-")));
    afterAll(() => rmSync(root, { recursive: true, force: true }));
    const [calls, shim] = [join(root, "calls.jsonl"), join(root, "shim.jsonl")];
    const asked: JsonValue[] = [];
    let exits: (number | null)[] = [];

    beforeAll(async () => {
      const bin = join(root, "bin");
      mkdirSync(bin, { recursive: true });
      mkdirSync(join(root, "tmp"), { recursive: true });
      writeFileSync(
        join(root, "claude.mjs"),
        `import { appendFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const args = process.argv.slice(2);
const ws = args[args.indexOf("--add-dir") + 1];
const files = (at) => readdirSync(join(ws, at), { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? files(join(at, entry.name)) : [join(at, entry.name)]);
appendFileSync(${JSON.stringify(calls)}, JSON.stringify({ args, env: process.env, cwd: process.cwd(), files: files("").sort() }) + "\\n");
writeFileSync(join(ws, "output", "report.md"), "# Stand-in report\\n\\nThe table totals 3.\\n");
for (const event of [{ type: "system", subtype: "init", cwd: process.cwd(), model: args[args.indexOf("--model") + 1] }, { type: "assistant", message: { content: [{ type: "text", text: "done" }] } }, { type: "result", subtype: "success", num_turns: 1, total_cost_usd: 0.5 }]) console.log(JSON.stringify(event));
`,
      );
      writeFileSync(
        join(bin, "claude"),
        `#!/bin/sh\nexec '${capturedExecPath}' '${join(root, "claude.mjs")}' "$@"\n`,
      );
      chmodSync(join(bin, "claude"), 0o755);
      const base = {
        PATH: `${bin}:/usr/bin:/bin`,
        HOME: join(root, "home"),
        TMPDIR: join(root, "tmp"),
        PYTHONDONTWRITEBYTECODE: "1",
      };
      // `score.sh`'s line for one task, under the fork's venv as `uv run` ran it.
      const pyStore = join(root, "py", "dataset");
      cpSync(join(jb, "dataset", "main", TASK, "task_folder"), join(pyStore, TASK, "task_folder"), {
        recursive: true,
      });
      const python = runSync(
        [
          join(FORK, ".venv", "bin", "python"),
          "-I",
          "-B",
          join(FORK, "harness2", "benchmarks", "jb_claude_runner.py"),
        ],
        {
          cwd: FORK,
          env: {
            ...base,
            TASK_IDS: TASK,
            LABEL,
            HARNESS_RENDER_DIR: tree,
            TASKS_BASE_DIR: pyStore,
            MODEL_ID: "claude-opus-5-5",
            EFFORT: "high",
            MAX_BUDGET_USD: "5",
            TIMEOUT_PER_TASK: "3600",
            MAX_RETRIES: "2",
          },
          timeout: 120_000,
        },
      );
      // The judge's endpoint: what judge.py asks, and a verdict that passes every criterion.
      const server = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        fetch: async (request) => {
          const body = capturedJsonParse(await request.text());
          asked.push({
            path: new URL(request.url).pathname,
            auth: request.headers.get("authorization"),
            body,
          });
          const messages = field(body, "messages");
          const user = field(Array.isArray(messages) ? messages[1] : undefined, "content");
          const prompt = isString(user) ? user : JSON.stringify(user);
          const count = (prompt.match(/^Criterion \d+:/gmu) ?? []).length;
          writeFileSync(
            shim,
            `${JSON.stringify({ t: Date.now() / 1000, usage: { total_cost_usd: 0.01 } })}\n`,
            {
              flag: "a",
            },
          );
          const verdict = {
            criteria_results: Array.from({ length: count }, (_, index) => ({
              index,
              passed: true,
              reasoning: "stand-in",
              evidence: "report.md",
            })),
            rubric_passed: true,
            overall_reasoning: "stand-in verdict",
          };
          return Response.json({
            id: "stand-in",
            object: "chat.completion",
            created: 0,
            model: field(body, "model"),
            choices: [
              {
                index: 0,
                message: { role: "assistant", content: JSON.stringify(verdict) },
                finish_reason: "stop",
              },
            ],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          });
        },
      });
      const typescript = await runCaptured(
        [capturedExecPath, SCORE, "score", "--arm", `tree:${tree}`, "--name", "jb-anabasis1", "--tasks", TASK]
          .concat(["--out", join(root, "ts"), "--jb", jb, "--api-base", `http://127.0.0.1:${server.port}/v1`])
          .concat(["--judge-log", shim, "--yes"]),
        { env: base, timeout: 240_000 },
      );
      await server.stop(true);
      exits = [python.exitCode, typescript.exitCode];
    }, 280_000);

    const call = (side: number) => rowsOf(calls)[side];
    const normal = (value: JsonValue | undefined): string => {
      const ws = field(value, "cwd");
      return JSON.stringify(field(value, "args") ?? null).replaceAll(isString(ws) ? ws : "\0", "<workspace>");
    };

    it("starts claude once from each runner, in a workspace named as the pilot's was", () => {
      expect(exits).toEqual([0, 0]);
      expect(rowsOf(calls)).toHaveLength(2);
      for (const side of [0, 1]) expect(field(call(side), "cwd")).toMatch(WORKSPACE);
      const traj = join(FORK, "runs", "jb", "dataset", TASK, "model_traj", LABEL);
      const recorded = readdirSync(traj).find((name) => name.includes("attempt1"));
      const init = rowsOf(join(traj, recorded ?? "")).find((event) => field(event, "type") === "system");
      expect(field(init, "cwd")).toMatch(WORKSPACE);
      expect(field(init, "model")).toBe("claude-opus-5-5");
    });

    it("gives claude the same argv and prompt", () => {
      expect(normal(call(1))).toBe(normal(call(0)));
      const args = field(call(0), "args");
      expect(Array.isArray(args) && args.slice(-6)).toEqual([
        "--model",
        "claude-opus-5-5",
        "--effort",
        "high",
        "--max-budget-usd",
        "5",
      ]);
    });

    it("gives claude the same environment but HARNESS_RENDER_DIR, the store and the sweep's PATH", () => {
      const env = (side: number): Record<string, JsonValue> => {
        const got = field(call(side), "env");
        // Inert outside the runners: CoreFoundation writes the first into a macOS Python process, and
        // the Claude Agent SDK, which this tree imports, writes the second, a Windows-only setting.
        const {
          PWD: _pwd,
          TASKS_BASE_DIR: _store,
          __CF_USER_TEXT_ENCODING: _cf,
          NoDefaultCurrentDirectoryInExePath: _windows,
          ...rest
        } = isRecord(got) ? got : {};
        return rest;
      };
      const { HARNESS_RENDER_DIR: render, PATH: pyPath, ...py } = env(0);
      const { PATH: tsPath, ...ts } = env(1);
      expect(render).toBe(tree);
      expect(ts).toEqual(py);
      expect(tsPath).toBe(
        [join(jb, ".venv", "bin"), dirname(capturedExecPath), isString(pyPath) ? pyPath : "?"].join(":"),
      );
      expect(field(call(1), "env", "TASKS_BASE_DIR")).toBe(join(root, "ts", "dataset"));
    });

    it("stages the same workspace, with the empty settings an installed tree carries", () => {
      const files = (side: number) => field(call(side), "files");
      const py = files(0);
      expect(Array.isArray(py) && py).toContain("CLAUDE.md");
      const ts = files(1);
      expect(new Set(Array.isArray(ts) ? ts : [])).toEqual(
        new Set([...(Array.isArray(py) ? py : []), join(".claude", "settings.json")]),
      );
      expect(Array.isArray(ts) && Array.isArray(py) && ts.length - py.length).toBe(1);
    });

    it("writes the runner's log line for line, in the recorded pilot log's shape", () => {
      const logLines = (path: string): string[] =>
        readFileSync(path, "utf8")
          .split("\n")
          .filter((line) => line.startsWith("["))
          .map((line) =>
            line
              .replaceAll(/\S*\/(?=statisticians\/task2\/)/gu, "<store>/")
              .replace(/^\[\d\d:\d\d:\d\d\]/u, "[T]")
              .replaceAll(/\d{8}_\d{6}/gu, "<stamp>")
              .replaceAll(/=(\d+(?:\.\d+)?)/gu, "=<n>"),
          );
      const logOf = (store: string): string => {
        const dir = join(store, ".harness2-logs");
        const name = readdirSync(dir).find((each) => each.includes(LABEL) && each.endsWith(".log"));
        return join(dir, name ?? "");
      };
      const pilot = join(FORK, "runs", "jb", "dataset");
      const py = logLines(logOf(join(root, "py", "dataset")));
      expect(logLines(logOf(join(root, "ts", "dataset")))).toEqual(py);
      expect(logLines(logOf(pilot))).toEqual(py);
    });

    it("judges the deliverable with JobBench's own judge.py at medium through the shim", () => {
      const rubrics = field(
        capturedJsonParse(readFileSync(join(jb, "dataset", "main", TASK, "RUBRICS.json"), "utf8")),
        "rubrics",
      );
      const count = Array.isArray(rubrics) ? rubrics.length : 0;
      expect(count).toBeGreaterThan(0);
      expect(asked).toHaveLength(count);
      for (const request of asked) {
        expect(field(request, "path")).toBe("/v1/chat/completions");
        expect(field(request, "auth")).toBe("Bearer local-shim");
        expect([field(request, "body", "model"), field(request, "body", "reasoning_effort")]).toEqual([
          "anthropic/claude-opus-5-5",
          "medium",
        ]);
      }
      const record = capturedJsonParse(
        readFileSync(join(root, "ts", "judged", "jb-anabasis1", "statisticians__task2.json"), "utf8"),
      );
      expect([field(record, "rubrics"), field(record, "passed"), field(record, "delivered")]).toEqual([
        count,
        count,
        true,
      ]);
      expect(field(record, "points")).toBe(field(record, "total"));
      expect(field(record, "solveUsd")).toBe(0.5);
      const judgeUsd = field(record, "judgeUsd");
      expect(isNumber(judgeUsd) ? judgeUsd : -1).toBeCloseTo(count * 0.01, 10);
    });
  },
);

describe.skipIf(FORK === "")("the pilot's arms table, scored again from a copy of its store", () => {
  const H2 = dirname(FORK);
  const root = realpathSync(mkdtempSync(join(tmpdir(), "ana-study-harness2-replay-")));
  afterAll(() => rmSync(root, { recursive: true, force: true }));
  const out = join(root, "out");
  const arms: [string, string][] = [
    ["sweep:base1", "base"],
    ["sweep:agg1", "h2k1"],
    [`tree:${join(H2, "anabasis-arm", "jobstat-tree")}`, "jb-anabasis1"],
    ["heldout", "jb-h2ho"],
  ];
  let exits: (number | null)[] = [];
  let printed = "";

  beforeAll(() => {
    cpSync(join(FORK, "runs", "jb", "dataset"), join(out, "dataset"), { recursive: true });
    const adapt = join(FORK, "runs", "jb", "adapt", "jb-cc-agg1");
    for (const key of readdirSync(adapt).filter((name) => existsSync(join(adapt, name, "summary.json")))) {
      cpSync(join(adapt, key, "summary.json"), join(out, "adapt", "jb-cc-agg1", key, "summary.json"));
      cpSync(
        join(adapt, key, "harnesses", "agg1"),
        join(out, "adapt", "jb-cc-agg1", key, "harnesses", "agg1"),
        {
          recursive: true,
        },
      );
    }
    // A `claude` that only says it was called: every rollout is on record, so none may start.
    mkdirSync(join(root, "bin"), { recursive: true });
    writeFileSync(join(root, "bin", "claude"), `#!/bin/sh\ntouch '${join(root, "called")}'\nexit 1\n`);
    chmodSync(join(root, "bin", "claude"), 0o755);
    const env = { PATH: `${join(root, "bin")}:/usr/bin:/bin`, HOME: join(root, "home"), TMPDIR: root };
    const jb = join(FORK, "dependencies", "job-bench-eval");
    exits = arms.map(
      ([arm, name]) =>
        runSync(
          [capturedExecPath, SCORE, "score", "--arm", arm, "--name", name, "--out", out, "--jb", jb].concat([
            "--api-base",
            "http://127.0.0.1:9/v1",
            "--yes",
          ]),
          { env, timeout: 120_000 },
        ).exitCode,
    );
    printed = decodeOutput(runSync([capturedExecPath, SCORE, "table", "--out", out], { env }).stdout);
  }, 280_000);

  it("starts no rollout and no judgement", () => {
    expect(exits).toEqual([0, 0, 0, 0]);
    expect(existsSync(join(root, "called"))).toBe(false);
  });

  it("prints the pilot's score, solve dollars and build dollars for every arm, all 8 and fair 5", () => {
    const pilot = capturedJsonParse(readFileSync(join(H2, "final.json"), "utf8"));
    const [all, fair] = printed.split("\nfair 5\n");
    const money = (value: JsonValue | undefined): string => (isNumber(value) ? value.toFixed(2) : "?");
    for (const [set, lines] of [
      ["all8", all ?? ""],
      ["fair5", fair ?? ""],
    ] as const) {
      for (const [key, name] of [
        ["base", "base"],
        ["h2k1", "h2k1"],
        ["anabasis", "jb-anabasis1"],
        ["h2ho", "jb-h2ho"],
      ] as const) {
        const want = field(pilot, set, key);
        const line = lines.split("\n").find((each) => each.trimStart().startsWith(`${name} `)) ?? "";
        if (want === null) {
          expect(line).toContain("5 of 8 tasks scored");
          continue;
        }
        const build = key === "anabasis" ? "?" : money(field(want, "build"));
        const [score, max, solve] = [field(want, "score"), field(want, "max"), money(field(want, "solve"))];
        expect(line).toContain(`score ${JSON.stringify(score)}/${JSON.stringify(max)} `);
        expect(line).toContain(` build ${build} solve ${solve} `);
      }
    }
  });
});
