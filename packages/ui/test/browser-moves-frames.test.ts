/**
 * The Moves pane frame by frame: switching details, returning to the scrolled list, and keeping
 * evidence visible through delayed move and solve reads. Each transition is sampled on animation
 * frames (`watchFrames`); `slowed` holds the detail endpoints back.
 */
import { afterAll, beforeAll, describe, test } from "bun:test";
import { type Browser, type Page } from "@playwright/test";
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
const SLOW_MS = 1_500;

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

/** Every answer to `endpoint` held back by `ms` before it goes on. */
async function slowed(page: Page, endpoint: "move" | "solve", ms: number): Promise<void> {
  await page.route(`**/api/${endpoint}?**`, async (route) => {
    await Bun.sleep(ms);
    await route.continue();
  });
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

  test("keeps the list on screen while a slow move is read, and shows that it waits only later", async () => {
    const opened = await openWatched(listQuery());
    const { page } = opened;
    await slowed(page, "move", SLOW_MS);
    await expect(rowOf(page, indexOf("x-1", "examiner"))).toBeVisible();
    const read = await watchFrames(page);
    await rowOf(page, indexOf("x-1", "examiner")).click();
    await expect(page.getByRole("heading", { level: 2, name: /x-1/u })).toBeVisible();
    const frames = await read();
    expect(frames.blank).toBe(0);
    expect(frames.firstLoading ?? SLOW_MS).toBeGreaterThanOrEqual(300);
    expectQuiet(opened);
    await opened.context.close();
  });

  test("keeps the move on screen while a slow solve is read, and shows that it waits only later", async () => {
    const opened = await openWatched(`${listQuery()}&move=${String(indexOf("b-1", "comparison"))}`);
    const { page } = opened;
    const chip = chipOf(page, "s-5-1");
    await expect(chip).toBeVisible();
    await slowed(page, "solve", SLOW_MS);
    const read = await watchFrames(page);
    await chip.click();
    await expect(page.getByRole("heading", { level: 2, name: /s-5-1/u })).toBeVisible();
    const frames = await read();
    expect(frames.blank).toBe(0);
    expect(frames.firstLoading ?? SLOW_MS).toBeGreaterThanOrEqual(300);
    expectQuiet(opened);
    await opened.context.close();
  });
});
