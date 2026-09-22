import { expect, test } from "bun:test";
// biome-ignore format: the directive below only reaches the specifier while this import is one line
// @ts-expect-error plain-JS skill script without type declarations
import { buildDigest } from "../.claude/skills/whole-run-investigation/scripts/trace-digest.mjs";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import { isString } from "../src/meta/json-shape.ts";
import { tmpdir } from "../src/meta/os.ts";
import { recordDigestBattery } from "./helpers/digest-battery.ts";
import { join } from "../src/meta/path.ts";

test("each measured product keeps its check corpus, join targets and case denominator", () => {
  const root = mkdtempSync(join(tmpdir(), "ana-product-digest-"));
  try {
    const campaign = join(root, "campaigns", "demo");
    const rows = [];
    for (const [id, verified, joins] of [
      ["initial", 25, 6],
      ["successor", 22, 9],
    ] as const) {
      const product = join(campaign, "versions", id);
      mkdirSync(join(product, "correctness-model"), { recursive: true });
      mkdirSync(join(product, "agent"));
      writeFileSync(join(product, "correctness-model", "tasks.json"), "[]");
      const checks = Array.from({ length: id === "initial" ? 7 : 8 }, (_, index) => ({
        id: `check-${index}`,
      }));
      writeFileSync(
        join(product, "correctness-model", "brief.json"),
        JSON.stringify({ truthChecks: checks }),
      );
      writeFileSync(
        join(product, "correctness-model", "controls.json"),
        JSON.stringify({
          reject: Array.from({ length: joins + 1 }, (_, index) =>
            index < joins
              ? { expectedCheckId: "check-0", targetsJoin: "bound-input" }
              : { expectedCheckId: "check-0" },
          ),
        }),
      );
      for (let index = 0; index < 25; index++) {
        const path = `runs/${id}/cases/t${index}/trace.json`;
        const trace = JSON.stringify({
          schema: "case-trace/v4",
          turns: [],
          toolCalls: [],
          truncated: false,
          droppedRawEvents: 0,
        });
        mkdirSync(join(product, "runs", id, "cases", `t${index}`), { recursive: true });
        writeFileSync(join(product, path), trace);
        if (index < verified) {
          writeFileSync(
            join(product, "runs", id, "cases", `t${index}`, "verifier.json"),
            JSON.stringify({ ok: true, issues: [] }),
          );
        }
        rows.push({
          row: {
            runId: id,
            taskId: `t${index}`,
            acceptedSubmit: index < verified,
            truthOk: index < verified ? true : null,
            traces: [{ path, sha256: new Bun.CryptoHasher("sha256").update(trace).digest("hex") }],
          },
        });
      }
      recordDigestBattery(product, [id]);
    }
    // A refused candidate and an unrelated claim cannot lend checks or grounding to shipping work.
    mkdirSync(join(campaign, "candidates", "refused", "correctness-model"), { recursive: true });
    writeFileSync(
      join(campaign, "candidates", "refused", "correctness-model", "brief.json"),
      JSON.stringify({ truthChecks: [{ id: "refused-only" }] }),
    );
    mkdirSync(join(campaign, "claims"));
    writeFileSync(
      join(campaign, "claims", "unrelated.json"),
      JSON.stringify({
        claim: { statement: { groundings: [{ checkId: "check-0", kind: "unrelated-grounding" }] } },
      }),
    );
    writeFileSync(join(campaign, "case-record.jsonl"), rows.map((row) => JSON.stringify(row)).join("\n"));
    const digest: unknown = buildDigest({ campaign, domainsRoot: join(root, "domains") });
    if (!isString(digest)) throw new Error("buildDigest must return digest text");
    const initial = digest.split("product root:")[1] ?? "";
    const successor = digest.split("product root:")[2] ?? "";
    expect(initial).toContain("25 (from 25 terminal case rows)");
    expect(initial).toMatch(/^check-0\s+reach-only\s+7\s+0\s+6\s+0$/m);
    expect(initial).not.toContain("check-7");
    expect(successor).toContain("22 (from 25 terminal case rows)");
    expect(successor).toMatch(/^check-0\s+reach-only\s+10\s+0\s+9\s+0$/m);
    expect(successor).toContain("check-7");
    expect(digest).toContain("successor: graded 22 · unaccepted 3 · non-result 0");
    expect(digest).not.toContain("over 47 graded rows");
    expect(digest).not.toContain("refused-only");
    expect(digest).not.toContain("unrelated-grounding");
    writeFileSync(join(campaign, "case-record.jsonl"), "");
    expect(buildDigest({ campaign, domainsRoot: join(root, "domains") })).toContain("no terminal case rows");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("copied traces use their battery's product fingerprint, or report the missing product", () => {
  const root = mkdtempSync(join(tmpdir(), "ana-shared-traces-"));
  try {
    const campaign = join(root, "campaigns", "demo");
    const domain = join(root, "domains", "demo");
    const old = join(campaign, "versions", "old");
    mkdirSync(join(domain, "correctness-model"), { recursive: true });
    mkdirSync(join(domain, "agent"));
    const rows = [];
    for (const id of ["old", "new"]) {
      writeFileSync(
        join(domain, "correctness-model", "brief.json"),
        JSON.stringify({ truthChecks: [{ id: `${id}-only` }] }),
      );
      const path = `runs/${id}/cases/task/trace.json`;
      const trace = JSON.stringify({
        schema: "case-trace/v4",
        turns: [],
        toolCalls: [],
        truncated: false,
        droppedRawEvents: 0,
      });
      mkdirSync(join(domain, "runs", id, "cases", "task"), { recursive: true });
      writeFileSync(join(domain, path), trace);
      writeFileSync(
        join(domain, "runs", id, "cases", "task", "verifier.json"),
        JSON.stringify({ ok: true, issues: [] }),
      );
      rows.push({
        row: {
          runId: id,
          taskId: "task",
          acceptedSubmit: true,
          truthOk: true,
          traces: [{ path, sha256: new Bun.CryptoHasher("sha256").update(trace).digest("hex") }],
        },
      });
      recordDigestBattery(domain, [id]);
      if (id === "old") {
        cpSync(join(domain, "agent"), join(old, "agent"), { recursive: true });
        cpSync(join(domain, "correctness-model"), join(old, "correctness-model"), { recursive: true });
      }
    }
    writeFileSync(join(campaign, "case-record.jsonl"), rows.map((row) => JSON.stringify(row)).join("\n"));
    const digest: unknown = buildDigest({ campaign, domainsRoot: join(root, "domains") });
    if (!isString(digest)) throw new Error("buildDigest must return digest text");
    expect(digest.split("product root:")[1]).toContain("old-only");
    expect(digest.split("product root:")[1]).not.toContain("new-only");
    expect(digest.split("product root:")[2]).toContain("new-only");
    rmSync(old, { recursive: true, force: true });
    const missing = buildDigest({ campaign, domainsRoot: join(root, "domains") });
    expect(missing).toContain(
      "product binding unresolved: old — no retained product matches battery fingerprint",
    );
    expect(missing).not.toContain("old-only");
    expect(missing).toContain("old: graded 1 · unaccepted 0 · non-result 0");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
