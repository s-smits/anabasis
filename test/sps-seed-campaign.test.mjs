import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { join } from "../src/meta/path.ts";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { campaignDir } from "../src/meta/campaign-root.ts";
import { fingerprintSlug } from "../src/claim/fingerprint.ts";
import { EvidenceLog } from "../src/claim/evidence-log.ts";
import { FEEDBACK_POLICY } from "../src/analyse/iteration-analysis.ts";
import { claimsDirFor } from "../src/run/claim-write.ts";
import { readClimbBatteries } from "../src/run/climb-history.ts";
import { ControllerLedger } from "../src/run/controller-ledger.ts";
import { SHIPPING_VARIANT } from "../src/run/run-driver.ts";
import {
  publishProductVersion,
  readProductVersion,
  selectInitialProduct,
  selectedProductDir,
} from "../src/run/product-versions.ts";
import { uppercaseFixture } from "./helpers/uppercase-fixture.ts";
import { defaultModelOf } from "../src/backends/resolve.ts";
import { REPO_ROOT, runTypeScript } from "../.claude/skills/system-path-simulation/scripts/test-support.mjs";

/** The pin both sides of a fair pairing carry, from the one model owner rather than a literal:
 *  change a defaultModel in resolve.ts and this follows. */
const SHARED_PIN = `claude/${defaultModelOf("claude")}`;

const SLUG = "uppercase";
const ADMISSION = JSON.stringify({
  runId: "b1",
  policy: FEEDBACK_POLICY,
  digest: "a".repeat(64),
  admitted: [],
  refused: [],
  feedback: [],
});

let scratch;
let source;

function run(...args) {
  return runTypeScript("seed-campaign.mts", args);
}

function manifestOf(root, slug) {
  return JSON.parse(readFileSync(join(campaignDir(root, slug), "seed.json"), "utf8"));
}

function readAdmission(root, slug) {
  using ledger = ControllerLedger.open(campaignDir(root, slug));
  return ledger.readAdmission();
}

/** A recorded campaign in production shape: the adopted bytes in an epoch workspace with a tool tree,
 *  published as the selected retained version, one admitted battery with its claim, one admission,
 *  and the live controller lock. */
function recordedCampaign(root, { refInProduct = false, mutableRef = false, escape = false } = {}) {
  const workspace = join(campaignDir(root, SLUG), "epoch-1", "workspace");
  uppercaseFixture(workspace, false, true);
  if (refInProduct) {
    const path = join(workspace, "correctness-model/brief.json");
    const brief = JSON.parse(readFileSync(path, "utf8"));
    writeFileSync(path, JSON.stringify({ ...brief, domain: `uppercase letters from ${root}/reference` }));
  }
  if (mutableRef) writeFileSync(join(workspace, "notes.txt"), `analysis program at ${root}/python/bin\n`);
  if (escape) {
    mkdirSync(join(root, "elsewhere"), { recursive: true });
    symlinkSync(join(root, "elsewhere"), join(workspace, "escape"));
  }
  const fingerprint = fingerprintSlug(workspace, { slug: SLUG });
  if (!fingerprint.ok) throw new Error("fixture has no fingerprint");
  publishProductVersion({ repoRoot: root, slug: SLUG, id: "v1", acceptedSnapshot: workspace, fingerprint });
  selectInitialProduct(root, SLUG, "v1");
  const evidence = new EvidenceLog(join(selectedProductDir(root, SLUG), "runs", "b1"));
  evidence.write("battery.json", {
    runId: "b1",
    backendPin: SHARED_PIN,
    thresholdManifestDigest: "seed-thresholds",
    condition: { variant: SHIPPING_VARIANT },
    bundleSnapshot: {
      agentHash: fingerprint.agentHash,
      correctnessModelHash: fingerprint.correctnessModelHash,
    },
    cases: [0, 1, 2, 3].map((i) => ({ taskId: `t${i}`, pass: i < 3, acceptedSubmit: true })),
    measured: { items: [], levels: [], findings: [] },
  });
  evidence.record();
  mkdirSync(claimsDirFor(root, SLUG), { recursive: true });
  writeFileSync(
    join(claimsDirFor(root, SLUG), "b1.json"),
    JSON.stringify({
      schema: "run-claim/v1",
      runId: "b1",
      createdAt: "2026-09-01T00:00:00Z",
      claim: { ok: true },
    }),
  );
  {
    using ledger = ControllerLedger.open(campaignDir(root, SLUG));
    ledger.writeAdmission(ADMISSION);
  }
  writeFileSync(join(campaignDir(root, SLUG), ".controller.lock"), "12345\n");
  return workspace;
}

beforeEach(() => {
  mkdirSync(join(REPO_ROOT, ".scratch"), { recursive: true });
  scratch = realpathSync(mkdtempSync(join(REPO_ROOT, ".scratch", "seed-campaign-test-")));
  source = join(scratch, "source");
});

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

describe("seed-campaign clone", () => {
  it("clones the campaign under the same slug, drops the lock, keeps the pinned tool tree and re-reads the product", () => {
    recordedCampaign(source);
    const into = join(scratch, "condition");
    const result = run("--from-root", source, "--slug", SLUG, "--into-root", into);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(`seeded clone ${SLUG}`);
    expect(existsSync(join(campaignDir(into, SLUG), ".controller.lock"))).toBe(false);
    expect(existsSync(join(campaignDir(source, SLUG), ".controller.lock"))).toBe(true);
    const manifest = manifestOf(into, SLUG);
    expect(manifest.schema).toBe("simulation-seed/v1");
    expect(manifest.mode).toBe("clone");
    expect(manifest.lockRemoved).toBe(true);
    expect(manifest.selectedProductId).toBe("v1");
    expect(manifest.audit.escapes).toEqual([]);
    expect(manifest.audit.absoluteRefs).toEqual([]);
    expect(manifest.audit.toolTreeLinks.map((row) => row.resolved)).toEqual([
      realpathSync(join(campaignDir(source, SLUG), "epoch-1", "workspace", ".toolchain")),
    ]);
    expect(manifest.fingerprintAfter).toEqual(manifest.fingerprintBefore);
    expect(manifest.carried).toEqual({
      historyRuns: 1,
      sourceHistoryRuns: 1,
      claims: 1,
      analysisFiles: 0,
      admission: true,
    });
    expect(readProductVersion(into, SLUG, "v1")).toBe(join(campaignDir(into, SLUG), "versions", "v1"));
    expect(readAdmission(into, SLUG)).toBe(ADMISSION);
  });

  it("drops each epoch workspace's node_modules link farm before the audit instead of reporting its links as escapes", () => {
    const workspace = recordedCampaign(source);
    mkdirSync(join(source, "node_modules", "@ana"), { recursive: true });
    mkdirSync(join(workspace, "node_modules"), { recursive: true });
    symlinkSync(join(source, "node_modules", "@ana"), join(workspace, "node_modules", "@ana"));
    const into = join(scratch, "condition");
    const result = run("--from-root", source, "--slug", SLUG, "--into-root", into);
    expect(result.exitCode).toBe(0);
    const manifest = manifestOf(into, SLUG);
    expect(manifest.droppedScratch).toEqual(["epoch-1/workspace/node_modules"]);
    expect(manifest.audit.escapes).toEqual([]);
    expect(existsSync(join(campaignDir(into, SLUG), "epoch-1", "workspace", "node_modules"))).toBe(false);
    expect(lstatSync(join(workspace, "node_modules", "@ana")).isSymbolicLink()).toBe(true);
  });

  it("audits the real campaign directory as an alias when campaigns/ is a symlink: the pinned tool tree is not a reference, a record naming it is, and --relocate rewrites it to the copy", () => {
    const real = join(scratch, "store", "campaigns", SLUG);
    mkdirSync(join(scratch, "store", "campaigns"), { recursive: true });
    mkdirSync(source, { recursive: true });
    symlinkSync(join(scratch, "store", "campaigns"), join(source, "campaigns"));
    const workspace = recordedCampaign(source);
    const into = join(scratch, "condition");
    const result = run("--from-root", source, "--slug", SLUG, "--into-root", into);
    expect(result.exitCode).toBe(0);
    const manifest = manifestOf(into, SLUG);
    expect(manifest.audit.aliases).toEqual([{ from: real, to: campaignDir(into, SLUG) }]);
    expect(manifest.audit.absoluteRefs).toEqual([]);
    expect(manifest.audit.toolTreeLinks.map((row) => row.resolved)).toEqual([
      join(real, "epoch-1", "workspace", ".toolchain"),
    ]);

    writeFileSync(
      join(workspace, "..", "receipt.json"),
      JSON.stringify({ receiptId: join(real, "epoch-1", "receipt") }),
    );
    const refused = run("--from-root", source, "--slug", SLUG, "--into-root", join(scratch, "refused"));
    expect(refused.exitCode).toBe(1);
    expect(refused.stderr).toContain("receipt.json x1");
    const relocated = run(
      "--from-root",
      source,
      "--slug",
      SLUG,
      "--into-root",
      join(scratch, "relocated"),
      "--relocate",
    );
    expect(relocated.exitCode).toBe(0);
    const copied = join(campaignDir(join(scratch, "relocated"), SLUG), "epoch-1", "receipt.json");
    expect(JSON.parse(readFileSync(copied, "utf8")).receiptId).toBe(
      join(campaignDir(join(scratch, "relocated"), SLUG), "epoch-1", "receipt"),
    );
  });

  it("lists a symlink that escapes into the source tree and refuses", () => {
    recordedCampaign(source, { escape: true });
    const into = join(scratch, "condition");
    const result = run("--from-root", source, "--slug", SLUG, "--into-root", into);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("symlink escape");
    expect(result.stderr).toContain(join(campaignDir(into, SLUG), "epoch-1", "workspace", "escape"));
    expect(result.stderr).toContain(join(source, "elsewhere"));
  });

  it("refuses a text reference to the source root unless allowed, and relocates a mutable one on request", () => {
    recordedCampaign(source, { mutableRef: true });
    const refused = run("--from-root", source, "--slug", SLUG, "--into-root", join(scratch, "refused"));
    expect(refused.exitCode).toBe(1);
    expect(refused.stderr).toContain("absolute reference");
    expect(refused.stderr).toContain("notes.txt x1");

    const allowed = run(
      "--from-root",
      source,
      "--slug",
      SLUG,
      "--into-root",
      join(scratch, "allowed"),
      "--allow-absolute-refs",
    );
    expect(allowed.exitCode).toBe(0);
    const allowedRow = manifestOf(join(scratch, "allowed"), SLUG).audit.absoluteRefs[0];
    expect(allowedRow.sha256After).toBeNull();
    expect(allowedRow.immutable).toBe(false);

    const into = join(scratch, "relocated");
    const relocated = run("--from-root", source, "--slug", SLUG, "--into-root", into, "--relocate");
    expect(relocated.exitCode).toBe(0);
    const manifest = manifestOf(into, SLUG);
    expect(manifest.audit.relocated).toBe(true);
    const row = manifest.audit.absoluteRefs[0];
    expect(row.sha256After).toMatch(/^[0-9a-f]{64}$/);
    expect(row.sha256After).not.toBe(row.sha256Before);
    const notes = readFileSync(join(campaignDir(into, SLUG), "epoch-1", "workspace", "notes.txt"), "utf8");
    expect(notes).toBe(`analysis program at ${into}/python/bin\n`);
    expect(
      readFileSync(join(campaignDir(source, SLUG), "epoch-1", "workspace", "notes.txt"), "utf8"),
    ).toContain(source);
  });

  it("keeps immutable product bytes untouched: a reference inside the retained version still refuses under --relocate", () => {
    recordedCampaign(source, { refInProduct: true });
    const result = run(
      "--from-root",
      source,
      "--slug",
      SLUG,
      "--into-root",
      join(scratch, "condition"),
      "--relocate",
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("[immutable product bytes]");
    expect(result.stderr).toContain(join("versions", "v1", "correctness-model", "brief.json"));
  });

  it("refuses an existing destination before any write", () => {
    recordedCampaign(source);
    const into = join(scratch, "condition");
    expect(run("--from-root", source, "--slug", SLUG, "--into-root", into).exitCode).toBe(0);
    const before = lstatSync(join(campaignDir(into, SLUG), "seed.json")).mtimeMs;
    const again = run("--from-root", source, "--slug", SLUG, "--into-root", into);
    expect(again.exitCode).toBe(1);
    expect(again.stderr).toContain("already exists");
    expect(lstatSync(join(campaignDir(into, SLUG), "seed.json")).mtimeMs).toBe(before);
  });
});

describe("seed-campaign republish", () => {
  it("republishes the selected product under a new slug with an owned tool tree, history, claims and admission", () => {
    recordedCampaign(source);
    const into = join(scratch, "tree");
    const result = run(
      "--from-root",
      source,
      "--slug",
      SLUG,
      "--as-slug",
      "sim-uppercase",
      "--into-root",
      into,
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("seeded republish uppercase as sim-uppercase");
    const manifest = manifestOf(into, "sim-uppercase");
    expect(manifest.mode).toBe("republish");
    expect(manifest.selectedProductId).toBe("seed-v1");
    expect(manifest.audit.escapes).toEqual([]);
    expect(manifest.audit.toolTreeLinks).toEqual([]);
    expect(manifest.fingerprintAfter.slug).toBe("sim-uppercase");
    expect(manifest.fingerprintAfter.correctnessModelHash).toBe(
      manifest.fingerprintBefore.correctnessModelHash,
    );
    expect(manifest.carried).toEqual({
      historyRuns: 1,
      sourceHistoryRuns: 1,
      claims: 1,
      analysisFiles: 0,
      admission: true,
    });
    const version = readProductVersion(into, "sim-uppercase", "seed-v1");
    expect(selectedProductDir(into, "sim-uppercase")).toBe(version);
    expect(realpathSync(join(version, ".toolchain")).startsWith(`${into}/`)).toBe(true);
    expect(existsSync(join(version, ".toolchain", "bin", "uppercase-fixture"))).toBe(true);
    const history = readClimbBatteries(version, null, claimsDirFor(into, "sim-uppercase"));
    expect(history.history).toHaveLength(1);
    expect(readAdmission(into, "sim-uppercase")).toBe(ADMISSION);
    expect(readAdmission(source, SLUG)).toBe(ADMISSION);
  });

  it("relocates a reference inside the product before publication and records both fingerprints", () => {
    recordedCampaign(source, { refInProduct: true });
    const into = join(scratch, "tree");
    const refused = run(
      "--from-root",
      source,
      "--slug",
      SLUG,
      "--as-slug",
      "sim-uppercase",
      "--into-root",
      into,
    );
    expect(refused.exitCode).toBe(1);
    expect(refused.stderr).toContain("absolute reference");
    expect(existsSync(campaignDir(into, "sim-uppercase"))).toBe(false);
    const result = run(
      "--from-root",
      source,
      "--slug",
      SLUG,
      "--as-slug",
      "sim-uppercase",
      "--into-root",
      into,
      "--relocate",
    );
    expect(result.exitCode).toBe(0);
    const manifest = manifestOf(into, "sim-uppercase");
    expect(manifest.audit.relocated).toBe(true);
    expect(manifest.audit.absoluteRefs[0].sha256After).not.toBe(manifest.audit.absoluteRefs[0].sha256Before);
    expect(manifest.fingerprintAfter.correctnessModelHash).not.toBe(
      manifest.fingerprintBefore.correctnessModelHash,
    );
    const version = readProductVersion(into, "sim-uppercase", "seed-v1");
    const brief = JSON.parse(readFileSync(join(version, "correctness-model", "brief.json"), "utf8"));
    expect(brief.domain).toBe(`uppercase letters from ${into}/reference`);
  });
});
