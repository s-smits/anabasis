/**
 * The shell's states besides a campaign shown: a refusal, a list or a campaign still read or failed,
 * a refresh that failed over what is shown, and a repository with no campaign; the two tiers; the
 * skip link and the focus ring; the page at a phone's width and at a desktop's; axe-core's reading of
 * every pane at both; and the poll that brings a new event. The sidebar and the address are
 * `browser-shell.test.ts`'s.
 */
import { afterAll, beforeAll, describe, test } from "bun:test";
import { type Browser, expect, type Page } from "@playwright/test";
import { append } from "../../../src/kernel/log.ts";
import { mkdtempSync, realpathSync, rmSync } from "../../../src/meta/filesystem.ts";
import { tmpdir } from "../../../src/meta/os.ts";
import { join } from "../../../src/meta/path.ts";
import {
  ACTION_MS,
  accessibilityViolations,
  DESKTOP,
  expectQuiet,
  launchBrowser,
  nextPolls,
  type Opened,
  openPage,
  PHONE,
  type Served,
  serveDirectory,
  serveFixture,
  withClock,
} from "./browser.ts";

let served: Served;
let browser: Browser;
/** The main campaign's key, and the folder its worktree's campaigns lie under. */
let main: string;
let folder: string;

const PANES = "Campaign panes";
/** Each pane: its query and the heading that shows it read. */
const EVERY_PANE = [
  { pane: "campaign", heading: { level: 1, name: "fixture" } },
  { pane: "moves", heading: { level: 2, name: "Moves" } },
  { pane: "tasks", heading: { level: 2, name: "Tasks" } },
  { pane: "log", heading: { level: 2, name: "Log" } },
] as const;
/** What a browser logs for an answer it was refused or failed, which the page cannot silence. */
const FAILED_LOAD = "Failed to load resource";

beforeAll(async () => {
  [served, browser] = await Promise.all([serveFixture(), launchBrowser()]);
  main = served.fixture.key;
  folder = main.split("/")[0] ?? "";
});
afterAll(async () => {
  await browser.close();
  await served.stop();
});

async function close(page: Opened, allowed: readonly string[] = []): Promise<void> {
  expectQuiet(page, allowed);
  await page.context.close();
}

const nav = (page: Page) => page.getByRole("navigation", { name: PANES });

/** Whether the page scrolls sideways: its content wider than its window. */
const scrollsSideways = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);

describe("a page the server refuses", () => {
  for (const [name, url] of [
    ["without a token", () => `${served.origin}/?campaign=${main}`],
    ["with another token", () => served.url(`campaign=${main}`).replace(/token=[0-9a-f]+/u, "token=0000")],
  ] as const) {
    test(`says so ${name}, and offers nothing to select`, async () => {
      const page = await openPage(browser, url());
      await expect(page.page.getByText("The server refused this page")).toBeVisible();
      await expect(page.page.getByText(/carries the token every request needs/u)).toBeVisible();
      await expect(page.page.getByRole("heading", { level: 1, name: "fixture" })).toHaveCount(0);
      await expect(page.page.getByRole("combobox", { name: /^Project/u })).toHaveAccessibleName(
        /Nothing to select/u,
      );
      expect(await accessibilityViolations(page.page)).toEqual([]);
      await close(page, [FAILED_LOAD]);
    });
  }
});

describe("a read in flight or failed", () => {
  test("says the list of campaigns is read until it arrives", async () => {
    const context = await browser.newContext({ viewport: DESKTOP });
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await context.route("**/api/campaigns", async (route) => {
      await held;
      await route.continue();
    });
    const page = await context.newPage();
    await page.goto(served.url(`campaign=${main}`));
    await expect(page.getByText("Reading the campaigns")).toBeVisible();
    await expect(page.getByText("The list of campaigns is loading.")).toBeVisible();
    release();
    // The campaign is read only once the list arrives, and at ten parallel files on 14 October that
    // read took past the 5 s an assertion waits: the page is what is tested here, not the server's pace.
    await expect(page.getByRole("heading", { level: 1, name: "fixture" })).toBeVisible({
      timeout: ACTION_MS,
    });
    await expect(page.getByText("Reading the campaigns")).toHaveCount(0);
    await context.close();
  });

  test("says no campaigns were read where the list fails, and recovers on the next poll", async () => {
    const context = await browser.newContext({ viewport: DESKTOP });
    await context.route("**/api/campaigns", (route) =>
      route.fulfill({ status: 500, contentType: "application/json", body: '{"error":"the list broke"}' }),
    );
    await context.clock.install();
    const page = await context.newPage();
    await page.goto(served.url(`campaign=${main}`));
    await expect(page.getByText("No campaigns read")).toBeVisible();
    await expect(page.getByText("the list broke")).toBeVisible();
    await context.unroute("**/api/campaigns");
    await nextPolls(page, 1, "/api/campaigns");
    await expect(page.getByRole("heading", { level: 1, name: "fixture" })).toBeVisible({
      timeout: ACTION_MS,
    });
    await expect(page.getByText("No campaigns read")).toHaveCount(0);
    await context.close();
  });

  test("says the campaign could not be read where its first read fails", async () => {
    const context = await browser.newContext({ viewport: DESKTOP });
    await context.route("**/api/campaign?*", (route) =>
      route.fulfill({ status: 500, contentType: "application/json", body: '{"error":"the log broke"}' }),
    );
    const page = await context.newPage();
    await page.goto(served.url(`campaign=${main}`));
    await expect(page.getByText("The campaign could not be read")).toBeVisible();
    await expect(page.getByText("the log broke")).toBeVisible();
    // Nothing was shown, so there is nothing a refresh failed over.
    await expect(page.getByText("Refresh failed.")).toHaveCount(0);
    await context.close();
  });

  test("keeps what it shows when a refresh fails, says so, and clears the word once one succeeds", async () => {
    const page = await openPage(browser, served.url(`campaign=${main}`));
    await withClock(page.page);
    const title = page.page.getByRole("heading", { level: 1, name: "fixture" });
    await expect(title).toBeVisible();
    await page.page.route("**/api/campaign?*", (route) =>
      route.fulfill({ status: 500, contentType: "application/json", body: '{"error":"the log broke"}' }),
    );
    await nextPolls(page.page, 1);
    const failed = page.page.getByText("Refresh failed.");
    await expect(failed).toBeVisible();
    await expect(page.page.getByText("the log broke")).toBeVisible();
    await expect(title).toBeVisible();
    await expect(page.page.getByRole("list", { name: /Harness versions/u })).toBeVisible();
    await page.page.unroute("**/api/campaign?*");
    await nextPolls(page.page, 1);
    await expect(failed).toHaveCount(0);
    await expect(title).toBeVisible();
    await close(page, ["HTTP 500", FAILED_LOAD]);
  });
});

describe("a repository with no campaign", () => {
  test("says none was found, at a desktop's width and a phone's", async () => {
    const scratch = realpathSync(mkdtempSync(join(tmpdir(), "ana-ui-empty-")));
    const server = await serveDirectory(scratch);
    try {
      for (const viewing of [DESKTOP, PHONE]) {
        const page = await openPage(browser, server.url(), viewing);
        await expect(page.page.getByRole("heading", { level: 1, name: "No campaigns found" })).toBeVisible();
        await expect(
          page.page.getByText(/No worktree of this repository holds a campaign log/u),
        ).toBeVisible();
        expect(await scrollsSideways(page.page)).toBe(false);
        expect(await accessibilityViolations(page.page)).toEqual([]);
        await close(page);
      }
    } finally {
      await server.stop();
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});

describe("the tier", () => {
  test("says the default tier on a server without the exam side", async () => {
    const page = await openPage(browser, served.url(`campaign=${main}`));
    await expect(page.page.locator("main").getByText("default tier", { exact: true })).toBeVisible();
    await expect(page.page.getByText("exam side", { exact: true })).toHaveCount(0);
    await close(page);
  });

  test("says the exam side on a server that serves it", async () => {
    const exam = await serveFixture("exam");
    try {
      const page = await openPage(browser, exam.url(`campaign=${exam.fixture.key}`));
      await expect(page.page.getByRole("heading", { level: 1, name: "fixture" })).toBeVisible();
      await expect(page.page.locator("main").getByText("exam side", { exact: true })).toBeVisible();
      await expect(page.page.getByText("default tier", { exact: true })).toHaveCount(0);
      await close(page);
    } finally {
      await exam.stop();
    }
  });
});

describe("the keyboard", () => {
  test("reaches the skip link first, and the link moves focus past the sidebar", async () => {
    const page = await openPage(browser, served.url(`campaign=${main}`));
    await expect(page.page.getByRole("heading", { level: 1, name: "fixture" })).toBeVisible();
    const skip = page.page.getByRole("link", { name: "Skip to the campaign" });
    await expect(skip).not.toBeInViewport();
    await page.page.keyboard.press("Tab");
    await expect(skip).toBeFocused();
    await expect(skip).toBeInViewport();
    await page.page.keyboard.press("Enter");
    await expect(page.page).toHaveURL(/#main$/u);
    await page.page.keyboard.press("Tab");
    const inMain = await page.page.evaluate(() =>
      document.querySelector("main")?.contains(document.activeElement),
    );
    expect(inMain).toBe(true);
    await close(page);
  });

  test("rings every control of the sidebar it focuses", async () => {
    const page = await openPage(browser, served.url(`campaign=${main}`));
    await expect(page.page.getByRole("heading", { level: 1, name: "fixture" })).toBeVisible();
    const controls = [
      page.page.getByRole("combobox", { name: /^Project/u }),
      page.page.getByRole("combobox", { name: /^Campaign/u }),
      ...["Campaign", "Moves", "Tasks", "Log"].map((name) => nav(page.page).getByRole("button", { name })),
      page.page.getByRole("button", { name: "Collapse" }),
    ];
    for (const control of controls) {
      await control.focus();
      // Focused from the keyboard's side: `:focus-visible` holds for a focus a script moves.
      await expect(control).toBeFocused();
      const ring = await control.evaluate((element) => {
        const style = getComputedStyle(element);
        return { style: style.outlineStyle, width: Number.parseFloat(style.outlineWidth) };
      });
      expect(ring.style).not.toBe("none");
      expect(ring.width).toBeGreaterThanOrEqual(2);
    }
    await close(page);
  });
});

describe("reduced motion", () => {
  test("cuts every transition short where the browser asks for less motion", async () => {
    const page = await openPage(browser, served.url(`campaign=${main}`), { reducedMotion: "reduce" });
    await expect(page.page.getByRole("heading", { level: 1, name: "fixture" })).toBeVisible();
    const durations = await page.page.evaluate(() =>
      [...document.querySelectorAll(".ana-sidebar *, main *")].flatMap((element) =>
        getComputedStyle(element)
          .transitionDuration.split(",")
          .map((each) => Number.parseFloat(each)),
      ),
    );
    expect(durations.length).toBeGreaterThan(0);
    expect(durations.every((seconds) => seconds <= 0.00001)).toBe(true);
    await close(page);
  });
});

describe("the page at a phone's width", () => {
  test("keeps the four panes in reach, each label inside its button, and opens each", async () => {
    const page = await openPage(browser, served.url(`campaign=${main}`), PHONE);
    await expect(page.page.getByRole("heading", { level: 1, name: "fixture" })).toBeVisible();
    for (const { heading } of EVERY_PANE.slice(1)) {
      const button = nav(page.page).getByRole("button", { name: heading.name });
      await expect(button).toBeInViewport();
      await button.click();
      await expect(page.page.getByRole("heading", heading)).toBeVisible();
      await expect(button).toHaveAttribute("aria-current", "page");
    }
    // The four share the row: none runs into the next, no label out of its button, and the last
    // ends where the row ends.
    const layout = await nav(page.page).evaluate((row) => {
      const buttons = [...row.querySelectorAll("button")].map((button) => {
        const outer = button.getBoundingClientRect();
        const label = button.querySelector(".ana-nav-label")?.getBoundingClientRect() ?? outer;
        return {
          left: outer.left,
          right: outer.right,
          inside: label.left >= outer.left - 0.5 && label.right <= outer.right + 0.5,
        };
      });
      return {
        overlapping: buttons.slice(1).filter((button, at) => button.left < (buttons[at]?.right ?? 0) - 0.5)
          .length,
        labelsOut: buttons.filter((button) => !button.inside).length,
        gap: Math.round(row.getBoundingClientRect().right - (buttons.at(-1)?.right ?? 0)),
      };
    });
    expect(layout).toEqual({ overlapping: 0, labelsOut: 0, gap: 0 });
    await close(page);
  });

  test("opens the pickers inside the window", async () => {
    const page = await openPage(browser, served.url(`campaign=${main}`), PHONE);
    await expect(page.page.getByRole("heading", { level: 1, name: "fixture" })).toBeVisible();
    for (const name of [/^Project/u, /^Campaign/u]) {
      await page.page.getByRole("combobox", { name }).click();
      const list = page.page.getByRole("listbox");
      await expect(list).toBeInViewport({ ratio: 1 });
      await page.page.keyboard.press("Escape");
      await expect(list).toHaveCount(0);
    }
    await close(page);
  });
});

describe("every pane", () => {
  for (const [width, viewing] of [
    ["a desktop's", DESKTOP],
    ["a phone's", PHONE],
  ] as const) {
    test(`fits ${width} width and breaks no WCAG 2.2 AA rule axe-core tests`, async () => {
      for (const { pane, heading } of EVERY_PANE) {
        const page = await openPage(browser, served.url(`campaign=${main}&pane=${pane}`), viewing);
        await expect(page.page.getByRole("heading", heading)).toBeVisible();
        expect({ pane, sideways: await scrollsSideways(page.page) }).toEqual({ pane, sideways: false });
        expect({ pane, violations: await accessibilityViolations(page.page) }).toEqual({
          pane,
          violations: [],
        });
        await close(page);
      }
    });
  }

  test("breaks no rule with the sidebar collapsed", async () => {
    const page = await openPage(browser, served.url(`campaign=${main}`));
    await expect(page.page.getByRole("heading", { level: 1, name: "fixture" })).toBeVisible();
    await page.page.getByRole("button", { name: "Collapse" }).click();
    await expect(page.page.locator(".ana-sidebar")).toHaveClass(/is-collapsed/u);
    expect(await accessibilityViolations(page.page)).toEqual([]);
    expect(await scrollsSideways(page.page)).toBe(false);
    await close(page);
  });
});

describe("the poll", () => {
  test("shows an event appended to the log without a reload", async () => {
    const page = await openPage(browser, served.url(`campaign=${folder}/early&pane=log`));
    await withClock(page.page);
    await expect(page.page.getByRole("heading", { level: 2, name: "Log" })).toBeVisible();
    const count = page.page.getByText(/^1–\d+ of \d+ events$/u);
    await expect(count).toBeVisible();
    const before = Number(/of (\d+)/u.exec((await count.textContent()) ?? "")?.[1]);
    expect(before).toBeGreaterThan(0);
    append(join(served.fixture.root, ".ana", "d2", "early", "log.jsonl"), "campaign.waited", {
      task: "word-01",
      harness: served.fixture.harnesses.starter,
      load: 30,
      cores: 12,
      ms: 1_000,
    });
    await nextPolls(page.page, 1);
    await expect(
      page.page.getByText(`1–${String(before + 1)} of ${String(before + 1)} events`),
    ).toBeVisible();
    await close(page);
  });
});
