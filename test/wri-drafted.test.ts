// The drafted exam's structure and how it came to stand (`tools/wri/drafted.ts`). Invented data only.
import { afterAll, describe, expect, it } from "bun:test";
import type { EventKind, LogEvent } from "../src/kernel/log.ts";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import { capturedJsonStringify } from "../src/meta/json-runtime.ts";
import type { JsonObject } from "../src/meta/json-shape.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { draftRows, siblingRows } from "../tools/wri/drafted.ts";

const PROMPT = "Write a small invented exam about counting pebbles.";
const root = realpathSync(mkdtempSync(join(tmpdir(), "ana-wri-draft-")));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const event = (kind: EventKind, data: JsonObject): LogEvent => ({
  at: "2026-11-05T00:00:00.000Z",
  kind,
  data,
});
const draft = (rules: readonly string[]) => ({
  domain: "pebbles",
  scope: "counting",
  conventions: "",
  rules: rules.map((id) => ({ id, statement: "s", source: "invented" })),
  answerFormat: { type: "object", properties: { count: { type: "number" } } },
  checks: rules.map((rule) => ({ id: `check-${rule}`, rule, assertion: "a" })),
  evaluator: "export const checks = {};",
  objective: { quantity: "pebbles left over", direction: "lower" },
  tasks: [
    { family: "heap", publicInput: {}, hidden: null },
    { family: "row", publicInput: {}, hidden: null },
  ],
  accept: [
    { task: 0, answer: { count: 1 } },
    { task: 1, answer: { count: 2 } },
  ],
  reject: rules.map((rule) => ({ task: 0, answer: { count: 0 }, check: `check-${rule}` })),
});
const put = (turn: number, text: string, isError = false) =>
  event("draft.call", { session: "d-1", turn, tool: "draft_exam", args: {}, isError, text });

describe("draft", () => {
  it("lists each draft a session put with the faults the host named, and the standing draft by its exam.drafted", () => {
    const rows = draftRows([
      event("campaign.opened", { prompt: PROMPT, budget: { dollars: 10, reserve: 1 } }),
      event("draft.started", { session: "d-1", prompt: PROMPT }),
      put(
        3,
        "The draft does not stand. 2 faults:\n- one fault\n- another fault\nMend them and put the whole draft again.",
      ),
      event("draft.call", {
        session: "d-1",
        turn: 4,
        tool: "write",
        args: {},
        isError: true,
        text: "EROFS here\nmore",
      }),
      put(5, "The draft stands: it is the campaign's exam. The session ends here."),
      event("exam.drafted", { session: "d-1", draft: draft(["R1", "R2"]) }),
      event("draft.finished", {
        session: "d-1",
        ended: "stands",
        tries: 2,
        turns: 5,
        seconds: 60,
        billed: 1.5,
      }),
      event("checker.read", {
        rows: [
          { id: "check-R1", instrument: "author" },
          { id: "check-R2", instrument: "pinned-tool" },
        ],
      }),
      event("contract.frozen", { contract: "c", checks: "k", admitted: [] }),
    ]);
    expect(rows).toContain("d-1: ended stands after 2 drafts, 5 turns, 60 s, $1.50");
    expect(rows).toContain("  turn 3: does not stand, 2 faults");
    expect(rows).toContain("    - another fault");
    expect(rows).toContain("  turn 5: stands");
    expect(rows.find((row) => row.startsWith("standing draft (d-1)"))).toContain(
      "2 rules (R1, R2), 2 checks",
    );
    expect(rows).toContain(
      "shape faults in the standing draft: the draft holds 2 example tasks, and at least 3 are needed",
    );
    expect(rows.find((row) => row.startsWith("checks:"))).toContain(
      "2 read, 1 decided by their author; frozen with 0 admitted (none); author-decided and not admitted: check-R1",
    );
    expect(rows).toContain("drafting calls: 3, 1 failed");
    expect(rows).toContain("  d-1 turn 4 write: EROFS here");
  });

  it("reads an older log without the bill, the checker reading or a standing draft as not recorded or none", () => {
    const rows = draftRows([
      event("draft.started", { session: "d-1", prompt: PROMPT }),
      event("draft.finished", { session: "d-1", ended: "crashed", crash: "a limit" }),
    ]);
    expect(rows).toContain(
      "d-1: ended crashed after drafts not recorded, turns not recorded, seconds not recorded, bill not recorded; crash: a limit",
    );
    expect(rows).toContain("standing draft: none");
    expect(rows).toContain("checks: checker reading not recorded");
  });

  it("lists every archived campaign drafted from the same prompt, one with no standing draft among them", () => {
    const archive = join(root, "runs");
    const write = (name: string, events: readonly LogEvent[]) => {
      mkdirSync(join(archive, "here", name), { recursive: true });
      writeFileSync(
        join(archive, "here", name, "log.jsonl"),
        events.map((each) => `${capturedJsonStringify(each)}\n`).join(""),
      );
    };
    write("same-drafted", [
      event("campaign.opened", { prompt: PROMPT }),
      event("exam.drafted", { draft: draft(["R1"]) }),
    ]);
    write("same-undrafted", [event("campaign.opened", { prompt: PROMPT })]);
    write("other", [event("campaign.opened", { prompt: "another prompt" })]);
    const rows = siblingRows(PROMPT, archive, "");
    expect(rows[0]).toEndWith(": 2");
    expect(rows.find((row) => row.includes("same-drafted"))).toContain("1 rule (R1)");
    expect(rows.find((row) => row.includes("same-undrafted"))).toContain("no standing draft");
    expect(rows.some((row) => row.includes("other"))).toBe(false);
  });
});
