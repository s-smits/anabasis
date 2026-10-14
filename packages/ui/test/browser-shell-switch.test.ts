/**
 * What the page paints while it changes what it shows: a switch of project or campaign, a slow read
 * of the next campaign, a pane switch, and a poll that brings nothing new. The operator's recording
 * of 14 October showed a switch of project painting "Reading the campaign" over the whole page for
 * four frames; the frame sampler (`sampleFrames`) counts such frames where they are painted.
 */
import { afterAll, beforeAll, describe, test } from "bun:test";
import { type Browser, expect, type Page } from "@playwright/test";
import { TOKEN_HEADER } from "../src/models.ts";
import {
  expectQuiet,
  framesSeen,
  launchBrowser,
  type Opened,
  openPage,
  routeParameters,
  type Served,
  sampleFrames,
  serveFixture,
} from "./browser.ts";

/** When the option was clicked and when the placeholder was first painted, in the page's clock; and
 *  whether the campaign held meanwhile was the previous one, inert and busy. */
interface Timeline {
  clickedAt: number | null;
  placeholderAt: number | null;
  keptTitle: boolean;
  busy: boolean;
}

declare global {
  interface Window {
    anaMutations?: { mutations: number };
    anaTimeline?: Timeline;
  }
}

/** The fixture's three campaigns' keys. */
interface Keys {
  readonly fixture: string;
  readonly early: string;
  readonly units: string;
}

let served: Served;
let browser: Browser;
/** The key of each fixture campaign, as the server forms it. */
let keys: Keys;

const POLL_MS = 5_000;

beforeAll(async () => {
  [served, browser] = await Promise.all([serveFixture(), launchBrowser()]);
  const folder = served.fixture.key.split("/")[0] ?? "";
  keys = { fixture: served.fixture.key, early: `${folder}/early`, units: `${folder}/units` };
  // Each campaign read once, so that a switch below waits on a folded log, as it does on a server
  // that has been running, and not on the first fold of it.
  await Promise.all(
    [keys.fixture, keys.early, keys.units].map((key) =>
      fetch(`${served.origin}/api/campaign?key=${encodeURIComponent(key)}`, {
        headers: { [TOKEN_HEADER]: served.token },
      }),
    ),
  );
});
afterAll(async () => {
  await browser.close();
  await served.stop();
});

/** The page at `query` with the frame sampler installed, its counts reset once the campaign shows. */
async function sampled(query: string, title: string): Promise<Opened> {
  const opened = await openPage(browser, served.url(query));
  await sampleFrames(opened.context);
  await opened.page.reload();
  await expect(opened.page.getByRole("heading", { level: 1, name: title })).toBeVisible();
  await framesSeen(opened.page);
  return opened;
}

/** Pick `option` in the sidebar's picker named `picker`. */
async function pick(page: Page, picker: "Project" | "Campaign", option: string): Promise<void> {
  await page.getByRole("combobox", { name: new RegExp(`^${picker}`, "u") }).click();
  await page.getByRole("option", { name: new RegExp(`^${option}`, "u") }).click();
}

/** The number of DOM mutations under the first match of `selector`, counted from now. */
async function observe(page: Page, selector: string): Promise<() => Promise<number>> {
  await page.evaluate((watched) => {
    const target = document.querySelector(watched);
    if (target === null) throw new Error(`nothing matches ${watched}`);
    const counted = { mutations: 0 };
    window.anaMutations = counted;
    new MutationObserver((records) => {
      counted.mutations += records.length;
    }).observe(target, { subtree: true, childList: true, attributes: true, characterData: true });
  }, selector);
  return () => page.evaluate(() => window.anaMutations?.mutations ?? -1);
}

/** Resolves once the page has read the selected campaign `count` more times. */
async function polls(page: Page, count: number): Promise<void> {
  let seen = 0;
  const counting = (response: { url: () => string }) => {
    if (response.url().includes("/api/campaign?")) seen += 1;
  };
  page.on("response", counting);
  // The next poll starts 5 s after the last read answered (`poll.ts`), and on a loaded host on
  // 14 October one test saw a single read in 15 s: the bound leaves three periods over the count.
  await expect.poll(() => seen, { timeout: (count + 3) * POLL_MS }).toBeGreaterThanOrEqual(count);
  page.off("response", counting);
}

describe("a switch of project or campaign", () => {
  test("paints no placeholder and no blank frame when the project changes", async () => {
    const opened = await sampled(`campaign=${keys.fixture}`, "fixture");
    const { page } = opened;
    await pick(page, "Project", "unit-conversion");
    await expect(page.getByRole("heading", { level: 1, name: "units" })).toBeVisible();
    await pick(page, "Project", "vowel-counts");
    await expect(page.getByRole("heading", { level: 1, name: "fixture" })).toBeVisible();
    const seen = await framesSeen(page);
    expect(seen.frames).toBeGreaterThan(0);
    expect({ placeholder: seen.placeholder, blank: seen.blank }).toEqual({ placeholder: 0, blank: 0 });
    expectQuiet(opened);
    await opened.context.close();
  });

  test("paints no placeholder and no blank frame when the campaign changes", async () => {
    const opened = await sampled(`campaign=${keys.fixture}`, "fixture");
    const { page } = opened;
    await pick(page, "Campaign", "early");
    await expect(page.getByRole("heading", { level: 1, name: "early" })).toBeVisible();
    await pick(page, "Campaign", "fixture");
    await expect(page.getByRole("heading", { level: 1, name: "fixture" })).toBeVisible();
    const seen = await framesSeen(page);
    expect({ placeholder: seen.placeholder, blank: seen.blank }).toEqual({ placeholder: 0, blank: 0 });
    expectQuiet(opened);
    await opened.context.close();
  });

  test("keeps the previous campaign inert and busy through a slow read, then says it is reading", async () => {
    const opened = await sampled(`campaign=${keys.fixture}`, "fixture");
    const { page } = opened;
    await page.route(`**/api/campaign?key=${encodeURIComponent(keys.units)}`, async (route) => {
      // The network a slow server would be: the read answers, 1.5 s late.
      await Bun.sleep(1_500);
      await route.continue();
    });
    // Read in the page at each change of its document, since a loaded host can take longer than the
    // wait between two assertions made from here, and can paint a frame later than Playwright reads
    // the document: a loop on animation frames once missed the placeholder Playwright then found.
    await page.evaluate(() => {
      const timeline: Timeline = { clickedAt: null, placeholderAt: null, keptTitle: false, busy: false };
      window.anaTimeline = timeline;
      // The wait starts no earlier than the last click, the option's, so the placeholder's distance
      // from it is at least the wait, whatever a loaded host does between.
      document.addEventListener(
        "click",
        () => {
          timeline.clickedAt = performance.now();
        },
        { capture: true },
      );
      const watcher = new MutationObserver(() => {
        const pending = document.querySelector(".ana-pending");
        if (pending !== null) {
          timeline.keptTitle ||= pending.querySelector("h1")?.textContent === "fixture";
          timeline.busy ||= pending.hasAttribute("inert") && pending.getAttribute("aria-busy") === "true";
        }
        if (document.querySelector("main")?.textContent?.includes("Reading the campaign") === true) {
          timeline.placeholderAt ??= performance.now();
          watcher.disconnect();
        }
      });
      watcher.observe(document.body, {
        subtree: true,
        childList: true,
        attributes: true,
        characterData: true,
      });
    });
    await pick(page, "Project", "unit-conversion");
    await expect(page.getByText("Reading the campaign", { exact: true })).toBeVisible();
    const timeline = await page.evaluate(() => window.anaTimeline);
    expect(timeline?.keptTitle).toBe(true);
    expect(timeline?.busy).toBe(true);
    expect(
      (timeline?.placeholderAt ?? 0) - (timeline?.clickedAt ?? Number.POSITIVE_INFINITY),
    ).toBeGreaterThanOrEqual(390);
    await expect(page.getByRole("heading", { level: 1, name: "units" })).toBeVisible();
    await expect(page.locator(".ana-pending")).toHaveCount(0);
    expectQuiet(opened);
    await opened.context.close();
  });

  test("lets no click on the previous campaign act while the next is read", async () => {
    const opened = await sampled(`campaign=${keys.fixture}`, "fixture");
    const { page } = opened;
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(`**/api/campaign?key=${encodeURIComponent(keys.early)}`, async (route) => {
      await held;
      await route.continue();
    });
    await pick(page, "Campaign", "early");
    const card = page
      .getByRole("list", { name: /Harness versions/u })
      .getByRole("button", { name: /^B\s*fa7c79d2/u });
    await expect(page.locator(".ana-pending")).toHaveAttribute("inert", "");
    // Forced: Playwright would otherwise refuse the click as one an inert element cannot receive,
    // which is the property under test; the browser decides where the click lands.
    await card.click({ force: true });
    expect(routeParameters(page)).toEqual({ campaign: keys.early });
    release();
    await expect(page.getByRole("heading", { level: 1, name: "early" })).toBeVisible();
    expect(routeParameters(page)).toEqual({ campaign: keys.early });
    expectQuiet(opened);
    await opened.context.close();
  });
});

describe("a poll that brings nothing new", () => {
  test("redraws nothing of the comparisons chart", async () => {
    const opened = await sampled(`campaign=${keys.fixture}`, "fixture");
    const { page } = opened;
    await polls(page, 1);
    const mutations = await observe(page, ".ana-comparisons-frame svg");
    await polls(page, 2);
    expect(await mutations()).toBe(0);
    expectQuiet(opened);
    await opened.context.close();
  });

  test("redraws nothing of the moves table", async () => {
    const opened = await openPage(browser, served.url(`campaign=${keys.fixture}&pane=moves`));
    const { page } = opened;
    await expect(page.getByRole("table")).toBeVisible();
    await polls(page, 1);
    const mutations = await observe(page, "main table");
    await polls(page, 2);
    expect(await mutations()).toBe(0);
    expectQuiet(opened);
    await opened.context.close();
  });
});

describe("a pane switch", () => {
  test("keeps the sidebar and the tier line painted and paints no blank frame", async () => {
    const opened = await sampled(`campaign=${keys.fixture}`, "fixture");
    const { page } = opened;
    const nav = page.getByRole("navigation", { name: "Campaign panes" });
    for (const pane of ["Moves", "Tasks", "Log", "Campaign"]) {
      await nav.getByRole("button", { name: pane }).click();
      await expect(nav.getByRole("button", { name: pane })).toHaveAttribute("aria-current", "page");
      await expect(page.locator("main").getByText("default tier")).toBeVisible();
      await expect(page.locator("main h2, main h1").first()).toBeVisible();
    }
    const seen = await framesSeen(page);
    expect({ placeholder: seen.placeholder, blank: seen.blank }).toEqual({ placeholder: 0, blank: 0 });
    expectQuiet(opened);
    await opened.context.close();
  });
});
