import { describe, expect, it } from "bun:test";

const skill = await Bun.file(
  new URL("../.claude/skills/monitor-session-until-idle/SKILL.md", import.meta.url),
).text();

describe("monitor helper documentation", () => {
  it("names repository-root paths which exist", async () => {
    expect(skill).not.toContain("bun scripts/");
    const paths = [
      ...skill.matchAll(/bun (\.claude\/skills\/monitor-session-until-idle\/scripts\/[^\s|`]+)/g),
    ].map((match) => match[1]);
    expect(paths.length).toBeGreaterThan(0);
    for (const path of new Set(paths)) {
      expect(await Bun.file(new URL(`../${path}`, import.meta.url)).exists()).toBe(true);
    }
  });
});
