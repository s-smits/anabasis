import { describe, expect, it } from "bun:test";
import { campaignDir, campaignRoot } from "../src/meta/campaign-root.ts";

/** The shared helpers place campaigns and their projects under the repository root. */
describe("campaignRoot", () => {
  it("places the campaign tree at <repoRoot>/campaigns and each project under it", () => {
    expect(campaignRoot("/repo")).toBe("/repo/campaigns");
    expect(campaignDir("/repo", "hw")).toBe("/repo/campaigns/hw");
    // A trailing separator on the checkout does not double up in the path.
    expect(campaignDir("/repo/", "hw")).toBe("/repo/campaigns/hw");
  });
});
