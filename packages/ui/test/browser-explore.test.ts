/**
 * Every control of every pane clicked once, and seeded walks over the whole page, with what must
 * hold after every step (`explore.ts`). The other browser files test what a person is meant to do;
 * these test that nothing a person can do breaks the page.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Browser } from "@playwright/test";
import { launchBrowser, openPage, type Served, serveFixture } from "./browser.ts";
import { replay, sweep, walk } from "./explore.ts";

let served: Served;
let exam: Served;
let browser: Browser;

/** A sweep or a walk takes minutes where a page action takes seconds. */
const EXPLORE_MS = 240_000;
const DEFAULT = { withheld: true } as const;

beforeAll(async () => {
  [served, exam, browser] = await Promise.all([serveFixture(), serveFixture("exam"), launchBrowser()]);
});
afterAll(async () => {
  await browser.close();
  await Promise.all([served.stop(), exam.stop()]);
});

/** The page's address for a campaign of the fixture by name, and a pane of it. */
function at(server: Served, name: string, pane = ""): string {
  const key = encodeURIComponent(server.fixture.key.replace(/fixture$/u, name));
  return server.url(`campaign=${key}${pane === "" ? "" : `&pane=${pane}`}`);
}

describe("every control, clicked once", () => {
  for (const [name, pane] of [
    ["fixture", ""],
    ["fixture", "moves"],
    ["fixture", "tasks"],
    ["fixture", "log"],
    ["early", ""],
    ["units", ""],
  ] as const) {
    test(
      `of the ${pane === "" ? "campaign" : pane} pane of ${name} leaves the page sound`,
      async () => {
        const opened = await openPage(browser, "about:blank");
        const explored = await sweep(opened, at(served, name, pane), DEFAULT);
        expect(explored.steps.length).toBeGreaterThan(0);
        await opened.context.close();
      },
      EXPLORE_MS,
    );
  }
});

describe("a seeded walk", () => {
  for (const seed of [1, 2, 3]) {
    test(
      `of 40 steps from the campaign, seed ${String(seed)}, leaves the page sound at every step`,
      async () => {
        const opened = await openPage(browser, "about:blank");
        await walk(opened, at(served, "fixture"), seed, 40, DEFAULT);
        await opened.context.close();
      },
      EXPLORE_MS,
    );
  }

  test(
    "on the exam side's server leaves the page sound at every step",
    async () => {
      const opened = await openPage(browser, "about:blank");
      await walk(opened, at(exam, "fixture", "moves"), 4, 40, { withheld: false });
      await opened.context.close();
    },
    EXPLORE_MS,
  );

  test(
    "replays from its printed steps on a fresh page",
    async () => {
      const first = await openPage(browser, "about:blank");
      const { steps } = await walk(first, at(served, "fixture"), 7, 15, DEFAULT);
      await first.context.close();
      const second = await openPage(browser, "about:blank");
      await replay(second, at(served, "fixture"), steps, DEFAULT);
      await second.context.close();
    },
    EXPLORE_MS,
  );
});
