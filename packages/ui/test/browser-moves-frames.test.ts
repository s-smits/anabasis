/**
 * The Moves pane frame by frame: switching details, returning to the scrolled list, and keeping
 * evidence visible through delayed move and solve reads. Each transition is sampled on animation
 * frames (`watchFrames`); a resolver holds the detail endpoints until the loading state appears.
 */
import { afterAll, beforeAll, describe, test } from "bun:test";
import type { Browser, Page } from "@playwright/test";
import type { Move } from "../src/models.ts";
import {
  expect,
  expectQuiet,
  launchBrowser,
  type Opened,
  openPage,
  type Served,
  serveFixture,
} from "./browser.ts";
import { answersOver } from "./fixture-campaign.ts";

/** What the watcher counted since it was armed: frames, frames with no evidence shown, frames whose
 *  evidence was a placeholder, and when the first of those came, in milliseconds after arming. */
interface Frames {
  readonly frames: number;
  readonly blank: number;
  readonly loading: number;
  readonly firstLoading: number | null;
}

/** Where evidence stands in the pane: the list's table, a detail, or a quiet "nothing" line. */
const EVIDENCE = "main table, main .ana-detail, main .ana-nosignal";

let served: Served;
let browser: Browser;
let moves: readonly Move[];

beforeAll(async () => {
  [served, browser] = await Promise.all([serveFixture(), launchBrowser()]);
  moves = answersOver(served.fixture.root, "default").campaign(served.fixture.key).moves;
});
afterAll(async () => {
  await browser.close();
  await served.stop();
});

/**
 * Counts, on every animation frame once armed, the frames in which no element matching the
 * watched selector is shown with text, and those whose shown text is a placeholder. The state is
 * kept on the root element's dataset, so that the test reads strings and nothing else.
 */
function frameWatch(): void {
  const placeholder = /Reading (?:move|solve|the campaign)|is loading/u;
  let armedAt = 0;
  let counts = [0, 0, 0, -1];
  const tick = (now: number) => {
    // The init script runs before the document has its root element.
    const root = document.documentElement;
    const selector = root.dataset.anaWatch;
    if (selector !== undefined) {
      if (root.dataset.anaArm !== undefined) {
        delete root.dataset.anaArm;
        armedAt = now;
        counts = [0, 0, 0, -1];
      }
      const shown = [...document.querySelectorAll<HTMLElement>(selector)].flatMap((element) =>
        element.checkVisibility() && element.innerText.trim() !== "" ? [element.innerText] : [],
      );
      const [frames = 0, blank = 0, loading = 0, first = -1] = counts;
      const waiting = placeholder.test(shown.join("\n"));
      counts = [
        frames + 1,
        shown.length === 0 ? blank + 1 : blank,
        waiting ? loading + 1 : loading,
        waiting && first < 0 ? Math.round(now - armedAt) : first,
      ];
      root.dataset.anaFrames = counts.join(" ");
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/** The page at `query`, with the frame watcher installed before its first script. */
async function openWatched(query: string, height = 1000): Promise<Opened> {
  const opened = await openPage(browser, "about:blank", { height });
  await opened.context.addInitScript(frameWatch);
  await opened.page.goto(served.url(query));
  return opened;
}

/** Arm the watcher on `selector`; the returned function reads what it counted, two frames on. */
async function watchFrames(page: Page, selector = EVIDENCE): Promise<() => Promise<Frames>> {
  await page.evaluate((watched) => {
    document.documentElement.dataset.anaWatch = watched;
    document.documentElement.dataset.anaArm = "";
  }, selector);
  await page.waitForFunction(() => document.documentElement.dataset.anaArm === undefined);
  return async () => {
    await page.evaluate(
      () =>
        new Promise<void>((done) => {
          requestAnimationFrame(() => requestAnimationFrame(() => done()));
        }),
    );
    const text = await page.evaluate(() => document.documentElement.dataset.anaFrames ?? "");
    const [frames = 0, blank = 0, loading = 0, first = -1] = text.split(" ").map(Number);
    return { frames, blank, loading, firstLoading: first < 0 ? null : first };
  };
}

/** The place in the log of the move with this id and kind. */
function indexOf(id: string, step: Move["step"]): number {
  const found = moves.find((move) => move.id === id && move.step === step);
  if (found === undefined) throw new Error(`no ${step} ${id} in the fixture`);
  return found.index;
}

function listQuery(): string {
  return `campaign=${encodeURIComponent(served.fixture.key)}&pane=moves`;
}

function rowOf(page: Page, index: number) {
  return page.locator(`[data-row="${String(index)}"]`);
}

/** The solve chips of a comparison's scored tasks: a button whose accessible name says the solve. */
function chipOf(page: Page, id: string) {
  return page.getByRole("button", { name: new RegExp(`solve ${id}$`, "u") });
}

function expectSteady(frames: Frames): void {
  expect(frames.frames).toBeGreaterThan(0);
  expect({ blank: frames.blank, loading: frames.loading }).toEqual({ blank: 0, loading: 0 });
}

describe("the Moves pane between frames", () => {
  test("goes from one move to another without a placeholder between them", async () => {
    const first = indexOf("x-1", "examiner");
    const opened = await openWatched(`${listQuery()}&move=${String(first)}`);
    const { page } = opened;
    await expect(page.getByRole("heading", { level: 2, name: /x-1/u })).toBeVisible();
    const read = await watchFrames(page);
    const next = indexOf("b-1", "comparison");
    await page.evaluate((index) => {
      const url = new URL(window.location.href);
      url.searchParams.set("move", String(index));
      window.history.pushState(null, "", url);
      window.dispatchEvent(new PopStateEvent("popstate"));
    }, next);
    await expect(page.getByRole("heading", { level: 2, name: /b-1\s*Comparison/u })).toBeVisible();
    await page.goBack();
    await expect(page.getByRole("heading", { level: 2, name: /x-1/u })).toBeVisible();
    expectSteady(await read());
    expectQuiet(opened);
    await opened.context.close();
  });

  test("returns to the list in the frame the detail leaves, scrolled and focused where it was", async () => {
    const opened = await openWatched(listQuery(), 420);
    const { page } = opened;
    // A row at the foot of the window, where focusing it alone would scroll it to the middle.
    const row = rowOf(page, indexOf("x-2", "examiner"));
    await row.evaluate((element) => element.scrollIntoView({ block: "end", behavior: "instant" }));
    const scrolled = await page.evaluate(() => window.scrollY);
    expect(scrolled).toBeGreaterThan(0);
    await row.click();
    await expect(page.getByRole("heading", { level: 2, name: /x-2/u })).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
    const read = await watchFrames(page);
    await page.getByRole("button", { name: "Back to moves" }).click();
    await expect(row).toBeFocused();
    expect(await page.evaluate(() => window.scrollY)).toBe(scrolled);
    expectSteady(await read());
    expectQuiet(opened);
    await opened.context.close();
  });

  test.each(["move", "solve"] as const)(
    "keeps evidence while a slow %s is read, and delays its loading state",
    async (endpoint) => {
      const query =
        endpoint === "move" ? listQuery() : `${listQuery()}&move=${String(indexOf("b-1", "comparison"))}`;
      const opened = await openWatched(query);
      const { page } = opened;
      const trigger = endpoint === "move" ? rowOf(page, indexOf("x-1", "examiner")) : chipOf(page, "s-5-1");
      const id = endpoint === "move" ? "x-1" : "s-5-1";
      await expect(trigger).toBeVisible();
      const held = Promise.withResolvers<void>();
      await page.route(`**/api/${endpoint}?**`, async (route) => {
        await held.promise;
        await route.continue();
      });
      const read = await watchFrames(page);
      await trigger.click();
      await expect(page.locator("main .ana-nosignal")).toBeVisible();
      await expect(page.locator("main .ana-nosignal")).toContainText(id);
      const waiting = await read();
      expect(waiting.blank).toBe(0);
      expect(waiting.firstLoading ?? 0).toBeGreaterThanOrEqual(300);
      held.resolve();
      // A move's heading names it; a solve's names its task, with its id in the line beneath.
      await expect(
        page.locator(".ana-detail-head", { hasText: id }).getByRole("heading", { level: 2 }),
      ).toBeVisible();
      expect((await read()).blank).toBe(0);
      if (endpoint === "solve") {
        await page.getByRole("button", { name: "Back to b-1" }).click();
        await expect(trigger).toBeFocused();
      }
      expectQuiet(opened);
      await opened.context.close();
    },
  );
});
