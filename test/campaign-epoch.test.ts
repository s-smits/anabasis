/**
 * Which authoring workspace a round is handed, and when the answer is a new one. An epoch is one
 * Builder condition under one prompt, so the whole question is what counts as a change of
 * condition: a corrected prompt, a different Builder or a different upstream route each open a
 * successor, while a measurement round and a re-run of the same binding do not. Getting that wrong
 * is not a filing error — mixing two Builder conditions into one epoch means the evidence recorded
 * under it no longer describes a single condition, and nothing downstream can separate them again.
 *
 * So the successor cases all assert a second thing as well: the predecessor is left
 * byte-identical. A successor that pointed at its predecessor and also
 * edited it would look correct from the new epoch and would have rewritten the record the old one's
 * results were measured against. Two consecutive reopens get a case for exactly that reason, since
 * one reopen can pass by accident where two cannot.
 *
 * The rest of the file is the record itself, and it fails closed everywhere. A damaged epochs record
 * refuses loudly and names the file rather than starting a fresh campaign over the top of it,
 * because starting fresh is indistinguishable from success and quietly abandons whatever was there.
 * A `campaign.json` sitting at the root is not epoch evidence either; only the record names an
 * epoch. Underneath, the atomic-write helpers get their own cases: a published file appears whole
 * with no `.tmp` left beside it, a rename that cannot happen leaves no temporary behind, and
 * `readJsonFile` refuses the damaged or missing file that `readJsonFileOrNull` is entitled to read
 * as absent — the pair being the point, since absent and unreadable are different facts and only
 * one of them is ordinary.
 */
import { afterAll, describe, expect, it } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { join } from "../src/meta/path.ts";
import { readJsonFile, readJsonFileOrNull, writeAtomic, writeJsonFile } from "../src/meta/completed-json.ts";
import { parseJsonAs } from "../src/meta/json-runtime.ts";
import { hashJsonValue } from "../src/meta/stable-json.ts";
import {
  campaignEpochForBinding,
  latestCampaignEpochForBinding,
  selectCampaignEpoch,
  writeCompleted,
} from "../src/author/campaign-epoch.ts";
const EPOCHS_JSON = "epochs.json";

const SCRATCH_ROOT = mkdtempSync(join(import.meta.dir, ".ana-scratch-epoch-"));
const ASK_V1 = "Build a slot binding harness: every declared part must bind exactly one slot.";
const ASK_V2 = `${ASK_V1} Corrected: slots may also stay empty.`;
afterAll(() => {
  rmSync(SCRATCH_ROOT, { recursive: true, force: true });
});

const BUILDER_CONDITION = {
  kind: "claude" as const,
  model: "claude-opus-5",
  reasoningEffort: "medium",
};

function scratch(name: string): string {
  const dir = join(SCRATCH_ROOT, name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("campaign epoch selection (R0)", () => {
  it("keeps the moved stable-JSON hash byte-compatible", () => {
    expect(hashJsonValue({ c: [undefined, 2], a: undefined, b: 1 })).toBe(
      "fc1f78a51ced6a05af84e4525d591cc5a482f3bef359edfb1e083e61bfcebcff",
    );
  });

  it("writes the first epoch of a fresh campaign with no predecessor and a completed record", () => {
    const root = scratch("fresh");
    const epoch = selectCampaignEpoch(root, { kickoff: ASK_V1 });
    expect(epoch.key).toMatch(/^epoch-[0-9a-f]{12}$/);
    expect(epoch.supersedes).toBeNull();
    expect(epoch.dir).toBe(join(root, epoch.key));
    expect(existsSync(epoch.dir)).toBe(true);
    const record = parseJsonAs<{
      schema: string;
      current: string;
      epochs: Array<{
        key: string;
        supersedes: string | null;
        binding: { kickoffHash: string; builder: typeof BUILDER_CONDITION | null };
      }>;
    }>(readFileSync(join(root, EPOCHS_JSON), "utf8"));
    expect(record.schema).toBe("campaign-epochs/v1");
    expect(record.current).toBe(epoch.key);
    expect(record.epochs).toHaveLength(1);
    expect(Object.keys(record.epochs[0]?.binding ?? {}).sort()).toEqual(["builder", "kickoffHash"]);
    expect(existsSync(join(root, "epochs.json.tmp"))).toBe(false);
  });

  it("resolves an epoch recorded with the retired domain and engines fields to its own directory", () => {
    // A campaign written under the older key shape hashed `domain` and `engines: null` into it.
    // Lookup compares the binding fields, so the old key and directory stay in force and no
    // second epoch opens for the same prompt, Builder and pass.
    const root = scratch("retired-fields");
    const oldKey = `epoch-${hashJsonValue({ domain: "matching", kickoffHash: hashJsonValue(ASK_V1), engines: null, builder: BUILDER_CONDITION }).slice(0, 12)}`;
    mkdirSync(join(root, oldKey), { recursive: true });
    writeFileSync(
      join(root, EPOCHS_JSON),
      JSON.stringify({
        schema: "campaign-epochs/v1",
        current: oldKey,
        epochs: [
          {
            key: oldKey,
            supersedes: null,
            createdAt: "2026-09-01T00:00:00.000Z",
            binding: {
              domain: "matching",
              kickoffHash: hashJsonValue(ASK_V1),
              engines: null,
              builder: BUILDER_CONDITION,
            },
          },
        ],
      }),
    );
    expect(campaignEpochForBinding(root, { kickoff: ASK_V1, builder: BUILDER_CONDITION })?.key).toBe(oldKey);
    expect(selectCampaignEpoch(root, { kickoff: ASK_V1, builder: BUILDER_CONDITION })).toEqual({
      key: oldKey,
      dir: join(root, oldKey),
      supersedes: null,
    });
    expect(
      campaignEpochForBinding(root, { kickoff: ASK_V1, builder: BUILDER_CONDITION, pass: "p" }),
    ).toBeNull();
    expect(campaignEpochForBinding(root, { kickoff: ASK_V1 })).toBeNull();
  });

  it("a pass that has not opened reads the latest pass on its prompt and Builder, not the initial build", () => {
    const root = scratch("latest-pass");
    const build = selectCampaignEpoch(root, { kickoff: ASK_V1, builder: BUILDER_CONDITION });
    const first = selectCampaignEpoch(root, {
      kickoff: ASK_V1,
      builder: BUILDER_CONDITION,
      pass: "experiment:1",
    });
    selectCampaignEpoch(root, {
      kickoff: ASK_V2,
      builder: BUILDER_CONDITION,
      pass: "experiment:other-prompt",
    });
    expect(
      latestCampaignEpochForBinding(root, {
        kickoff: ASK_V1,
        builder: BUILDER_CONDITION,
        pass: "experiment:2",
      })?.key,
    ).toBe(first.key);
    expect(
      latestCampaignEpochForBinding(root, {
        kickoff: ASK_V1,
        builder: BUILDER_CONDITION,
        pass: "experiment:1",
      })?.key,
    ).toBe(first.key);
    expect(latestCampaignEpochForBinding(root, { kickoff: ASK_V1, builder: BUILDER_CONDITION })?.key).toBe(
      build.key,
    );
    expect(latestCampaignEpochForBinding(root, { kickoff: ASK_V1, pass: "experiment:2" })).toBeNull();
  });

  it("stores one Builder condition and binds it into the epoch key", () => {
    const root = scratch("builder-condition");
    const first = selectCampaignEpoch(root, {
      kickoff: ASK_V1,
      builder: BUILDER_CONDITION,
    });
    const record = parseJsonAs<{
      epochs: Array<{ binding: { builder: typeof BUILDER_CONDITION | null } }>;
    }>(readFileSync(join(root, EPOCHS_JSON), "utf8"));
    expect(record.epochs[0]?.binding.builder).toEqual(BUILDER_CONDITION);
    expect(first.key).toBe(
      `epoch-${hashJsonValue({ kickoffHash: hashJsonValue(ASK_V1), builder: BUILDER_CONDITION }).slice(0, 12)}`,
    );
    expect(
      selectCampaignEpoch(root, {
        kickoff: ASK_V1,
        builder: BUILDER_CONDITION,
      }).key,
    ).toBe(first.key);
  });

  it("re-selects the same epoch for the same binding instead of creating a duplicate", () => {
    const root = scratch("stable");
    const first = selectCampaignEpoch(root, { kickoff: ASK_V1 });
    const before = readFileSync(join(root, EPOCHS_JSON), "utf8");
    const second = selectCampaignEpoch(root, { kickoff: ASK_V1 });
    expect(second).toEqual(first);
    expect(readFileSync(join(root, EPOCHS_JSON), "utf8")).toBe(before);
  });

  it("a changed ask writes a successor that points to, and never mutates, the prior epoch", () => {
    const root = scratch("changed-ask");
    const first = selectCampaignEpoch(root, { kickoff: ASK_V1 });
    // Completed evidence inside the first epoch must survive the supersession byte-for-byte.
    writeFileSync(join(first.dir, "marker.json"), '{"completed":true}');
    const second = selectCampaignEpoch(root, { kickoff: ASK_V2 });
    expect(second.key).not.toBe(first.key);
    expect(second.supersedes).toBe(first.key);
    expect(readFileSync(join(first.dir, "marker.json"), "utf8")).toBe('{"completed":true}');
    const record = parseJsonAs<{
      current: string;
      epochs: Array<{ key: string; supersedes: string | null }>;
    }>(readFileSync(join(root, EPOCHS_JSON), "utf8"));
    expect(record.current).toBe(second.key);
    expect(record.epochs.map((e) => e.key)).toEqual([first.key, second.key]);
    expect(record.epochs[0]?.supersedes).toBeNull();
  });

  it("a changed Builder condition writes a successor instead of mixing evidence", () => {
    const root = scratch("changed-builder-condition");
    const first = selectCampaignEpoch(root, {
      kickoff: ASK_V1,
      builder: BUILDER_CONDITION,
    });
    const second = selectCampaignEpoch(root, {
      kickoff: ASK_V1,
      builder: { ...BUILDER_CONDITION, reasoningEffort: "high" },
    });
    expect(second.key).not.toBe(first.key);
    expect(second.supersedes).toBe(first.key);
  });

  it("a changed Builder upstream route writes a successor", () => {
    const root = scratch("changed-builder-provider");
    const first = selectCampaignEpoch(root, {
      kickoff: ASK_V1,
      builder: { ...BUILDER_CONDITION, providerPin: ["deepinfra"] },
    });
    const second = selectCampaignEpoch(root, {
      kickoff: ASK_V1,
      builder: { ...BUILDER_CONDITION, providerPin: ["together"] },
    });
    expect(second.key).not.toBe(first.key);
    expect(second.supersedes).toBe(first.key);
  });

  it("re-running a superseded binding re-points current at its existing epoch, no duplicate", () => {
    const root = scratch("revert");
    const first = selectCampaignEpoch(root, { kickoff: ASK_V1 });
    selectCampaignEpoch(root, { kickoff: ASK_V2 });
    const reverted = selectCampaignEpoch(root, { kickoff: ASK_V1 });
    expect(reverted.key).toBe(first.key);
    const record = parseJsonAs<{
      current: string;
      epochs: unknown[];
    }>(readFileSync(join(root, EPOCHS_JSON), "utf8"));
    expect(record.current).toBe(first.key);
    expect(record.epochs).toHaveLength(2);
  });

  it("a reopening pass creates its own epoch instead of writing into the one the build recorded", () => {
    const root = scratch("reopen-pass");
    const build = selectCampaignEpoch(root, { kickoff: ASK_V1 });
    writeFileSync(join(build.dir, "iteration.json"), '{"ordinal":1}');
    const rebuild = selectCampaignEpoch(root, {
      kickoff: ASK_V1,
      pass: "a".repeat(64),
    });
    expect(rebuild.key).not.toBe(build.key);
    expect(rebuild.supersedes).toBe(build.key);
    expect(readFileSync(join(build.dir, "iteration.json"), "utf8")).toBe('{"ordinal":1}');
    const record = parseJsonAs<{
      current: string;
      epochs: Array<{ key: string; binding: { pass?: string } }>;
    }>(readFileSync(join(root, EPOCHS_JSON), "utf8"));
    expect(record.current).toBe(rebuild.key);
    expect(record.epochs.map((entry) => entry.key)).toEqual([build.key, rebuild.key]);
    // The base binding stays free of the field, so every epoch created before it still resolves.
    expect(record.epochs[0]?.binding.pass).toBeUndefined();
    expect(record.epochs[1]?.binding.pass).toBe("a".repeat(64));
    // A resumed round derives the same key from the same evidence and returns to its own epoch.
    expect(selectCampaignEpoch(root, { kickoff: ASK_V1, pass: "a".repeat(64) }).key).toBe(rebuild.key);
    expect(campaignEpochForBinding(root, { kickoff: ASK_V1 })?.key).toBe(build.key);
  });

  it("two consecutive reopens create two epochs and leave both predecessors byte-identical", () => {
    const root = scratch("two-reopens");
    const build = selectCampaignEpoch(root, { kickoff: ASK_V1 });
    writeFileSync(join(build.dir, "iteration.json"), '{"ordinal":1}');
    const first = selectCampaignEpoch(root, {
      kickoff: ASK_V1,
      pass: "a".repeat(64),
    });
    writeFileSync(join(first.dir, "iteration.json"), '{"ordinal":2}');
    const second = selectCampaignEpoch(root, {
      kickoff: ASK_V1,
      pass: "b".repeat(64),
    });
    expect(new Set([build.key, first.key, second.key]).size).toBe(3);
    expect(second.supersedes).toBe(first.key);
    expect(readFileSync(join(build.dir, "iteration.json"), "utf8")).toBe('{"ordinal":1}');
    expect(readFileSync(join(first.dir, "iteration.json"), "utf8")).toBe('{"ordinal":2}');
    const record = parseJsonAs<{ current: string; epochs: Array<{ key: string }> }>(
      readFileSync(join(root, EPOCHS_JSON), "utf8"),
    );
    expect(record.current).toBe(second.key);
    expect(record.epochs.map((entry) => entry.key)).toEqual([build.key, first.key, second.key]);
  });

  it("looks up an exact superseded binding read-only instead of following current", () => {
    const root = scratch("exact-read");
    const first = selectCampaignEpoch(root, { kickoff: ASK_V1 });
    selectCampaignEpoch(root, { kickoff: ASK_V2 });
    const before = readFileSync(join(root, EPOCHS_JSON), "utf8");
    expect(campaignEpochForBinding(root, { kickoff: ASK_V1 })).toEqual(first);
    expect(campaignEpochForBinding(root, { kickoff: `${ASK_V1} unseen` })).toBeNull();
    expect(readFileSync(join(root, EPOCHS_JSON), "utf8")).toBe(before);
  });

  it("a campaign.json at the root is not epoch evidence: only the record names an epoch", () => {
    const root = scratch("root-binding");
    // The pre-epoch layout wrote the binding at the campaign root. Nothing reads it now, so a
    // fresh campaign that happens to carry one still opens its first epoch superseding nothing.
    writeFileSync(join(root, "campaign.json"), JSON.stringify({ kickoffHash: hashJsonValue(ASK_V1) }));
    expect(campaignEpochForBinding(root, { kickoff: ASK_V1 })).toBeNull();
    expect(selectCampaignEpoch(root, { kickoff: ASK_V1 }).supersedes).toBeNull();
  });

  it("refuses a damaged epochs record loudly, naming the file", () => {
    const unreadable = scratch("damaged");
    writeFileSync(join(unreadable, EPOCHS_JSON), "{not json");
    expect(() => selectCampaignEpoch(unreadable, { kickoff: ASK_V1 })).toThrow(
      /epochs\.json: unreadable .*controller owns supersession/,
    );
    const foreign = scratch("foreign-schema");
    writeFileSync(join(foreign, EPOCHS_JSON), JSON.stringify({ schema: "other/v9", epochs: null }));
    expect(() => selectCampaignEpoch(foreign, { kickoff: ASK_V1 })).toThrow(
      /not a campaign-epochs\/v1 record/,
    );
  });

  it("writeCompleted publishes atomically: the destination appears whole and no .tmp survives", () => {
    const root = scratch("settle");
    const target = join(root, "iteration.json");
    writeCompleted(target, { ordinal: 7, outcome: "fingerprinted" });
    expect(JSON.parse(readFileSync(target, "utf8"))).toEqual({ ordinal: 7, outcome: "fingerprinted" });
    expect(existsSync(`${target}.tmp`)).toBe(false);
  });

  /**
   * `writeCompleted` is one caller of `writeAtomic`. The other two publish bytes no JSON writer
   * produces: the operator backends file carries a trailing newline because an operator edits it,
   * and the Builder prose sidecar is JSONL. Both used to spell the write out themselves and clean
   * up in `finally`, which unlinks a path the successful rename has already taken away. The
   * hostile half is what that mistake hides — when the rename cannot happen, the temporary is the
   * thing that must not survive.
   */
  it("writeAtomic publishes exact bytes, and a rename that cannot happen leaves no temporary", () => {
    const root = scratch("atomic");
    const target = join(root, "backends.json");
    writeAtomic(target, '{"review":{"disabled":true}}\n');
    expect(readFileSync(target, "utf8")).toBe('{"review":{"disabled":true}}\n');

    const occupied = join(root, "occupied");
    mkdirSync(occupied, { recursive: true });
    expect(() => writeAtomic(occupied, "one\ntwo\n")).toThrow();
    expect(readdirSync(root).filter((entry) => entry.includes(".tmp-"))).toEqual([]);
  });

  /**
   * The two readers differ only on a file that is missing or damaged: `readJsonFile` throws, as the
   * inline parse it replaced did, and `readJsonFileOrNull` reads both as absent. A reader that must
   * refuse damage choosing the second would turn a corrupt record into a fresh start.
   */
  it("readJsonFile refuses a damaged or missing file that readJsonFileOrNull reads as absent", () => {
    const root = scratch("json-file");
    const target = join(root, "record.json");
    writeJsonFile(target, { ordinal: 7, rows: [1, 2] });
    expect(readFileSync(target, "utf8")).toBe('{\n  "ordinal": 7,\n  "rows": [\n    1,\n    2\n  ]\n}\n');
    expect(readJsonFile(target)).toEqual({ ordinal: 7, rows: [1, 2] });
    expect(readJsonFileOrNull(target)).toEqual({ ordinal: 7, rows: [1, 2] });

    const damaged = join(root, "damaged.json");
    writeFileSync(damaged, '{"ordinal": 7,');
    expect(() => readJsonFile(damaged)).toThrow();
    expect(readJsonFileOrNull(damaged)).toBeNull();
    expect(() => readJsonFile(join(root, "absent.json"))).toThrow();
    expect(readJsonFileOrNull(join(root, "absent.json"))).toBeNull();
  });
});
