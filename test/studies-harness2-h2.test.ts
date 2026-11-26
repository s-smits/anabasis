// What a Harness² rollout (`studies/harness2/h2/claude.ts`) makes of the session it ran: the
// ending it reads from the trajectory, and the deliverable it moves into the store.
import { afterAll, describe, expect, it } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import type { JsonValue } from "../src/meta/json-shape.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { runtimeProcess } from "../src/meta/process.ts";
import { REFUSED, rollout, summarize } from "../studies/harness2/h2/claude.ts";

const root = realpathSync(mkdtempSync(join(tmpdir(), "ana-study-harness2-h2-")));
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("a rollout's result", () => {
  const events = (result: Record<string, JsonValue>) => {
    const path = join(root, `trajectory-${String(Math.random()).slice(2)}.jsonl`);
    writeFileSync(
      path,
      `${JSON.stringify({ type: "system", subtype: "init" })}\n${JSON.stringify({ type: "result", ...result })}\n`,
    );
    return summarize(path).subtype;
  };

  it("is refused where the API ended the session, and keeps the arm's own limits and a success", () => {
    expect(events({ subtype: "success", is_error: true, result: "limit reached" })).toBe(REFUSED);
    expect(events({ subtype: "error_during_execution", is_error: true })).toBe(REFUSED);
    expect(events({ subtype: "success", is_error: false })).toBe("success");
    expect(events({ subtype: "error_max_turns", is_error: true })).toBe("error_max_turns");
    expect(events({ subtype: "error_max_budget_usd", is_error: true })).toBe("error_max_budget_usd");
  });

  it("reaches the store with its files and folders, on another filesystem where one is at hand", async () => {
    // Linux keeps /dev/shm on a filesystem of its own, where a rename out of the workspace is refused;
    // elsewhere the store is beside the workspace.
    const apart = existsSync("/dev/shm") && statSync("/dev/shm").dev !== statSync(tmpdir()).dev;
    const store = mkdtempSync(join(apart ? "/dev/shm" : root, "delivery-"));
    try {
      const [task, label, tree, bin] = [
        "g/task1",
        "arm__g__task1",
        join(root, "no-tree"),
        join(root, "session"),
      ];
      mkdirSync(join(store, task, "task_folder"), { recursive: true });
      mkdirSync(tree);
      writeFileSync(
        bin,
        `#!/bin/sh\nmkdir output/tables\necho "report $CLAUDE_CODE_DISABLE_AUTO_MEMORY" > output/report.md\necho rows > output/tables/a.csv\necho '{"type":"result","subtype":"success","total_cost_usd":0.5}'\n`,
        { mode: 0o755 },
      );
      const billed = await rollout({ store, task, label }, tree, {
        bin,
        model: "",
        effort: "",
        budgetUsd: "",
        timeoutS: 30,
        env: { PATH: runtimeProcess.env.PATH ?? "" },
      });
      const delivered = join(store, task, "model_output", label);
      expect(billed).toBe(0.5);
      expect(readFileSync(join(delivered, "report.md"), "utf8")).toBe("report 1\n");
      expect(readFileSync(join(delivered, "tables", "a.csv"), "utf8")).toBe("rows\n");
    } finally {
      rmSync(store, { recursive: true, force: true });
    }
  });
});
