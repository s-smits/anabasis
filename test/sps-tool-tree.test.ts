/**
 * `tool-tree.mts` says, before a live call, whether the selected product's tool tree is still there
 * and which trees of the same campaign family could stand in for a swept one.
 */
import { mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import { join } from "../src/meta/path.ts";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { campaignDir } from "../src/meta/campaign-root.ts";
import { selectInitialProduct } from "../src/run/product-versions.ts";
import { parseJsonAs } from "../src/meta/json-runtime.ts";
import { uppercaseFixture } from "./helpers/uppercase-fixture.ts";
import { cleanupScratch, scratchDir } from "./helpers/scratch.ts";
import { publishProduct } from "./helpers/digest-battery.ts";
import { runTypeScript } from "../.claude/skills/system-path-simulation/scripts/test-support.ts";
import {
  siblingCampaignRoots,
  type ToolTreeReport,
} from "../.claude/skills/system-path-simulation/scripts/tool-tree.mts";

const SLUG = "uppercase-deadbeef-29";

let scratch = "";
let recorded = "";
let sibling = "";
let search: string[] = [];

/** One published campaign with its epoch tool tree, a later run of the same family in a second
 *  checkout, and an unrelated campaign that must not be offered. */
beforeAll(() => {
  scratch = realpathSync(scratchDir("sps-tool-tree-"));
  const workspace = join(campaignDir(join(scratch, "a"), SLUG), "epoch-1", "workspace");
  uppercaseFixture(workspace, false, true);
  publishProduct({ repoRoot: join(scratch, "a"), slug: SLUG, id: "v1", acceptedSnapshot: workspace });
  selectInitialProduct(join(scratch, "a"), SLUG, "v1");
  recorded = realpathSync(join(workspace, ".toolchain"));
  sibling = join(
    campaignDir(join(scratch, "b"), "uppercase-deadbeef-30"),
    "epoch-2",
    "workspace",
    ".toolchain",
  );
  mkdirSync(join(sibling, "bin"), { recursive: true });
  writeFileSync(join(sibling, "bin", "tool"), "#!/bin/sh\n");
  mkdirSync(join(campaignDir(join(scratch, "b"), "other-cafebabe-1"), "epoch-3", "workspace", ".toolchain"), {
    recursive: true,
  });
  search = ["--search", join(scratch, "a", "campaigns"), "--search", join(scratch, "b", "campaigns")];
});
afterAll(cleanupScratch);

function report(...extra: string[]): ToolTreeReport {
  const result = runTypeScript("tool-tree.mts", [
    "--campaign",
    campaignDir(join(scratch, "a"), SLUG),
    ...search,
    "--json",
    ...extra,
  ]);
  expect(result.exitCode).toBe(0);
  return parseJsonAs<ToolTreeReport>(result.stdout);
}

describe("tool-tree", () => {
  it("searches the checkouts beside the campaign's by default, past a plain file among them", () => {
    writeFileSync(join(scratch, "notes.md"), "a file beside the checkouts\n");
    expect(siblingCampaignRoots(join(scratch, "a"))).toEqual([
      realpathSync(join(scratch, "a", "campaigns")),
      realpathSync(join(scratch, "b", "campaigns")),
    ]);
  });

  it("finds the selected product's tree present and lists the family's trees, the recorded one matching its digest", () => {
    const found = report("--digest");
    expect(found.family).toBe("uppercase-deadbeef");
    expect(found.selected).toMatchObject({ recorded, resolved: recorded, present: true });
    expect(found.candidates.map((tree) => [tree.path, tree.digestMatches])).toEqual(
      expect.arrayContaining([
        [recorded, true],
        [realpathSync(sibling), false],
      ]),
    );
    expect(found.candidates).toHaveLength(2);
  });

  it("says a swept tree is gone, from version.json, and names the family tree a republish can seed", () => {
    rmSync(recorded, { recursive: true });
    const version = parseJsonAs<{ toolTree: string }>(
      readFileSync(join(campaignDir(join(scratch, "a"), SLUG), "versions", "v1", "version.json"), "utf8"),
    );
    const swept = report();
    expect(swept.selected).toMatchObject({ recorded: version.toolTree, resolved: null, present: false });
    expect(swept.candidates.map((tree) => tree.path)).toEqual([realpathSync(sibling)]);
    const text = runTypeScript("tool-tree.mts", [
      "--campaign",
      campaignDir(join(scratch, "a"), SLUG),
      ...search,
    ]);
    expect(text.stdout).toContain("tool tree  GONE: the Builder opens on an empty .toolchain");
    expect(text.stdout).toContain(
      `next: seed-campaign.mts ... --as-slug <arm> --tool-tree ${realpathSync(sibling)}`,
    );
  });
});
