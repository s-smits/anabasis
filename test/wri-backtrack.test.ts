// Bounded exhaustive and seeded LCG property checks for same-domain longitudinal version
// backtracking (`domainOf`, `parseReleaseTag`, `versionGap`, `attentionOf`, `buildBacktrack`,
// `formatBacktrack`). Pure in-memory inputs, zero mocks or sleeps.
import { describe, expect, it } from "bun:test";
import { domainOf } from "#tools/runs/registry.ts";
import {
  attentionOf,
  type BacktrackRun,
  buildBacktrack,
  formatBacktrack,
  type OutsideRef,
  parseReleaseTag,
  type Semver,
  versionGap,
} from "#tools/wri/backtrack.ts";
import type { SynthesisRef } from "#tools/wri/index.ts";

const SETTING_A = "claude-opus-5-5/medium 30m 20t 24x2";
const SETTING_B = "claude-sonnet-5-5/high 30m 20t 24x2";

function makeRun(
  name: string,
  overrides: Partial<BacktrackRun> & { readonly releaseTag: string; readonly releaseLabel: string },
): BacktrackRun {
  return {
    name,
    domain: domainOf(name),
    pack: name.includes("-fresh-") ? name.slice(0, name.indexOf("-fresh-")) : (name.split("-")[0] ?? name),
    setting: SETTING_A,
    commit: "deadbeef1",
    launched: 1_700_000_000_000,
    activeHours: 10,
    live: false,
    promotions: 1,
    compared: 4,
    confirmed: 0,
    reads: 1,
    afterWins: 5,
    afterLosses: 5,
    afterTies: 0,
    scored: 40,
    room: 0,
    controls: 4,
    aaSteps: 0,
    dollars: 100,
    repriced: 100,
    ending: "no ending",
    ...overrides,
  };
}

describe("domainOf groups prompt revisions under one domain family", () => {
  it.each([
    ["jobstat-anabasis-v9-fresh-opus-forkedPR999-runner-a", "jobstat"],
    ["jobstat-anabasis-v6d-fresh-opus-forkedPR801-runner-a", "jobstat"],
    ["jobstat-anabasis-fresh-opus-r1", "jobstat"],
    ["jobstat-fresh-opus-r1", "jobstat"],
    ["buffer-fresh-opus-forkedPR902-runner-b", "buffer"],
    ["esp32-fresh-opus-forkedPR703-runner-c", "esp32"],
    ["kernel-cyber2-fresh-opus-r1", "kernel-cyber2"],
    ["jobstath2-fresh-opus-r1", "jobstath2"],
  ] as const)("%s -> %s", (campaign, expected) => {
    expect(domainOf(campaign)).toBe(expected);
  });
});

describe("versionGap and attentionOf monotonicity (bounded exhaustive over semver triples)", () => {
  it("decays weight strictly with version gap and separates packs and settings", () => {
    const target: Semver = { major: 0, minor: 13, patch: 0, tag: "v0.13.0" };
    const targetKey = { semver: target, pack: "jobstat-anabasis-v9", setting: SETTING_A };
    for (let minor = 0; minor <= 14; minor += 1) {
      for (let patch = 0; patch <= 3; patch += 1) {
        const other: Semver = {
          major: 0,
          minor,
          patch,
          tag: `v0.${String(minor)}.${String(patch)}`,
        };
        expect(parseReleaseTag(`after ${other.tag}`)).toEqual(other);
        const { gap, direction } = versionGap(target, other);
        expect(gap).toBeGreaterThanOrEqual(0);
        if (minor === 13 && patch === 0) {
          expect(gap).toBe(0);
          expect(direction).toBe("same");
        } else if (minor < 13) {
          expect(direction).toBe("older");
        } else {
          expect(direction).toBe("newer");
        }
        const samePack = attentionOf(targetKey, {
          semver: other,
          pack: "jobstat-anabasis-v9",
          setting: SETTING_A,
        });
        const priorPack = attentionOf(targetKey, {
          semver: other,
          pack: "jobstat-anabasis-v7",
          setting: SETTING_A,
        });
        const otherSetting = attentionOf(targetKey, {
          semver: other,
          pack: "jobstat-anabasis-v9",
          setting: SETTING_B,
        });
        expect(samePack.weight).toBeCloseTo(1 / (1 + gap), 10);
        expect(priorPack.weight).toBeCloseTo(samePack.weight / 2, 10);
        expect(otherSetting).toMatchObject({ weight: 0, tier: "other-setting" });
        const expectedTier =
          (
            [
              [1, "direct"],
              [2, "near"],
              [3, "mid"],
            ] as const
          ).find(([ceiling]) => gap < ceiling)?.[1] ?? "distant";
        expect(samePack.tier).toBe(expectedTier);
      }
    }
    // A newer earlier release sits closer, with higher weight (`v0.11.4` before `v0.11.2`).
    const ordered: readonly Semver[] = [
      { major: 0, minor: 13, patch: 0, tag: "v0.13.0" },
      { major: 0, minor: 12, patch: 2, tag: "v0.12.2" },
      { major: 0, minor: 12, patch: 1, tag: "v0.12.1" },
      { major: 0, minor: 12, patch: 0, tag: "v0.12.0" },
      { major: 0, minor: 11, patch: 4, tag: "v0.11.4" },
      { major: 0, minor: 11, patch: 2, tag: "v0.11.2" },
      { major: 0, minor: 10, patch: 4, tag: "v0.10.4" },
      { major: 0, minor: 9, patch: 5, tag: "v0.9.5" },
    ];
    const scored = ordered.map((semver) =>
      attentionOf(targetKey, { semver, pack: "jobstat-anabasis-v9", setting: SETTING_A }),
    );
    for (let index = 1; index < scored.length; index += 1) {
      expect(scored[index]?.gap ?? 0).toBeGreaterThan(scored[index - 1]?.gap ?? 0);
      expect(scored[index]?.weight ?? 1).toBeLessThan(scored[index - 1]?.weight ?? 0);
    }
  });
});

describe("buildBacktrack and formatBacktrack (seeded LCG archive properties)", () => {
  it("expands only direct/near same-domain peers, collapses distant, and joins syntheses", () => {
    let state = 1337;
    const nextInt = (bound: number) => {
      state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
      return state % bound;
    };
    const target = makeRun("jobstat-anabasis-v9-fresh-opus-r99", {
      releaseTag: "v0.13.0",
      releaseLabel: "after v0.13.0",
      promotions: 0,
      compared: 4,
      activeHours: 16,
      dollars: 195,
      repriced: 195,
    });
    const releases = ["v0.14.0", "v0.13.0", "v0.12.2", "v0.11.4", "v0.10.2", "v0.9.1"] as const;
    const packs = ["jobstat-anabasis-v9", "jobstat-anabasis-v7", "buffer", "esp32"] as const;
    const peers: BacktrackRun[] = [];
    const syntheses = new Map<string, SynthesisRef>();
    const outside = new Map<string, OutsideRef>();
    for (let nth = 0; nth < 40; nth += 1) {
      const release = releases[nextInt(releases.length)] ?? "v0.12.2";
      const pack = packs[nextInt(packs.length)] ?? "jobstat-anabasis-v9";
      const setting = nextInt(5) === 0 ? SETTING_B : SETTING_A;
      const name = `${pack}-fresh-opus-r${String(nth)}`;
      peers.push(
        makeRun(name, {
          releaseTag: release,
          releaseLabel: `after ${release}`,
          setting,
          launched: 1_700_000_000_000 + nth * 1000,
          promotions: nextInt(3),
          compared: 1 + nextInt(6),
          activeHours: 5 + nextInt(20),
          dollars: 50 + nextInt(300),
          repriced: 50 + nextInt(300),
        }),
      );
      if (nth % 2 === 0) {
        syntheses.set(name, {
          folder: `2026-11-22-${name}`,
          date: "2026-11-22",
          summary: "synthesis.md",
          constraint: `Constraint for ${name} under ${release}`,
        });
      }
      if (nth % 3 === 0) {
        outside.set(name, { status: "scored", summary: "230 vs 266" });
      }
    }
    const report = buildBacktrack([target], peers, syntheses, outside);
    for (const item of report.expanded) {
      expect(item.run.domain).toBe("jobstat");
      expect(item.run.setting).toBe(SETTING_A);
      expect(item.attention.gap).toBeLessThan(2);
      expect(["direct", "near"]).toContain(item.attention.tier);
    }
    // Cohorts sorted monotonically by ascending version gap, never containing distant/other-setting/newer.
    for (let index = 0; index < report.cohorts.length; index += 1) {
      const cohort = report.cohorts[index];
      expect(cohort?.attention.tier).not.toBe("distant");
      expect(cohort?.attention.tier).not.toBe("other-setting");
      expect(cohort?.attention.direction).not.toBe("newer");
      if (index > 0) {
        expect(cohort?.attention.gap ?? 0).toBeGreaterThanOrEqual(
          report.cohorts[index - 1]?.attention.gap ?? 0,
        );
      }
    }
    const sameDomainPeers = peers.filter(({ domain }) => domain === "jobstat");
    const counted =
      report.cohorts.reduce((sum, row) => sum + row.runs, 0) +
      report.distantCount +
      report.otherSettingCount +
      report.newerCount;
    expect(counted).toBe(sameDomainPeers.length);

    const rendered = formatBacktrack(report).join("\n");
    expect(rendered).toContain("after v0.12.2");
    expect(rendered).toContain("Nearest prior release: after v0.12.2");
    // Distant releases must not leak into expanded per-run rows.
    const expandedSection = rendered.split("## Direct & near runs")[1]?.split("\n## ")[0] ?? "";
    expect(expandedSection).not.toContain("after v0.10.2");
    expect(expandedSection).not.toContain("after v0.9.1");
    expect(expandedSection).not.toContain("buffer-fresh");
  });
});
