/**
 * The page in a real browser, for the browser tests (`browser-*.test.ts`): the fixture's three
 * campaigns written once a file, `serve.ts` started on them as the operator starts it, and Chrome
 * driven by Playwright over that server.
 *
 * The other page tests render the panes to a string (`panes.test.tsx`), which proves what a pane
 * says and nothing of what a person can do with it: no effect runs, no click lands, no history
 * entry is pushed and no layout is measured. These tests drive the page the operator opens. They
 * run Chrome as installed (`channel: "chrome"`), as CI's macOS runner and the operator's Mac have
 * it, so the suite downloads no browser; `ANA_UI_CHROME` names another executable. A host without
 * either fails the launch with Playwright's own message rather than skipping, since a browser test
 * that skips says nothing.
 *
 * Assertions are Playwright's own web-first ones (`expect` of `@playwright/test`), which retry until
 * their timeout, so no test sleeps: Playwright's runner needs Node, which this repository does not
 * run, and its `expect` works under `bun:test` as it is. A test reads the page as a person does,
 * by role and accessible name, and reaches for a class only where the page has no role to offer.
 *
 * Every page records what the browser reported as wrong: a console error or warning, an uncaught
 * exception, and an HTTP failure of the API. A test ends by asserting that list empty
 * (`expectQuiet`), so a page that renders and throws behind it fails.
 */
import { AxeBuilder } from "@axe-core/playwright";
import {
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  chromium,
  type Page,
  expect as web,
} from "@playwright/test";
import { mkdtempSync, realpathSync, rmSync } from "../../../src/meta/filesystem.ts";
import { tmpdir } from "../../../src/meta/os.ts";
import { join } from "../../../src/meta/path.ts";
import { interruptAndReapProcessGroup } from "../../../src/meta/subprocess.ts";
import type { Tier } from "../src/models.ts";
import { type Fixture, writeFixtureCampaign } from "./fixture-campaign.ts";

/** One server: its origin and token, and how to stop it. */
export interface Server {
  readonly origin: string;
  readonly token: string;
  /** The page's address for a query string without the token, `?` excluded; the token is added. */
  readonly url: (query?: string) => string;
  readonly stop: () => Promise<void>;
}

/** One server over the fixture, which it writes and removes. */
export interface Served extends Server {
  readonly fixture: Fixture;
}

/** A page and what the browser reported against it. */
export interface Opened {
  readonly page: Page;
  readonly context: BrowserContext;
  /** Console errors and warnings, uncaught exceptions and failed API answers, in order. */
  readonly problems: string[];
}

/** Where a page is opened: the viewport, and the colour scheme and motion the browser reports. */
export interface Viewing {
  readonly width?: number;
  readonly height?: number;
  readonly reducedMotion?: "reduce" | "no-preference";
}

/** The sampler's counts, as the page holds them between two reads. */
interface Sampled {
  placeholder: number;
  blank: number;
  frames: number;
  /** When the last click landed, in the page's clock. */
  clickedAt: number;
  /** The address of each frame counted as a placeholder or as blank. */
  at: string[];
}

declare global {
  interface Window {
    anaFramesSeen?: Sampled;
  }
}

/** What the frame sampler counted since it was last read. */
export interface FramesSeen {
  /** Frames in which `main` showed the "Reading the campaign" placeholder sooner than the page's
   *  patience after the last click (`PATIENCE_FLOOR_MS`). */
  readonly placeholder: number;
  /** Frames in which `main` held no heading, no table and no placeholder: nothing was painted. */
  readonly blank: number;
  readonly frames: number;
}

const PACKAGE = join(import.meta.dir, "..");
const STARTED = /anabasis at (http:\/\/127\.0\.0\.1:\d+)\/\?token=([0-9a-f]+)/u;
const START_MS = 20_000;
/** How long one load, click or other action may wait. Playwright's own 30 s twice over is the test's
 *  whole 60 s, so a page that never loaded under ten parallel files on 14 October timed the test out
 *  and named no step; at 15 s the stuck step fails with its own message first. */
export const ACTION_MS = 15_000;
/** The page's patience (`waited.ts`, 400 ms), less a timer's granularity: no read the page waits on
 *  says it is reading sooner than this after the click that began it. */
export const PATIENCE_FLOOR_MS = 390;
/** Playwright's web-first assertions, each retried for as long as an action may wait. Its own `expect`
 *  gives up at 5 s, which `setDefaultTimeout` does not reach: on 17 October, with campaigns solving on
 *  the host at a load of 30 on 12 cores, 13 browser cases failed a pre-push gate at 5 s each. */
export const expect = web.configure({ timeout: ACTION_MS });
/** How long the page waits after a read answers before it reads again (`POLL_MS`, `live.ts`). */
const POLL_MS = 5_000;
/** A desktop window, the width the operator reads the page at. */
export const DESKTOP = { width: 1440, height: 1000 } as const;
/** A phone held upright. */
export const PHONE = { width: 390, height: 844 } as const;

/** The fixture written under a fresh directory, and `serve.ts` started on it. */
export async function serveFixture(tier: Tier = "default"): Promise<Served> {
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), "ana-ui-browser-")));
  try {
    const fixture = writeFixtureCampaign(join(scratch, "repo"));
    const server = await serveDirectory(fixture.root, tier);
    const stop = async () => {
      await server.stop();
      rmSync(scratch, { recursive: true, force: true });
    };
    return { ...server, fixture, stop };
  } catch (error) {
    rmSync(scratch, { recursive: true, force: true });
    throw error;
  }
}

/** `serve.ts` started on the campaigns under `root`, which the caller owns and removes. */
export async function serveDirectory(root: string, tier: Tier = "default"): Promise<Server> {
  const child = Bun.spawn(["bun", "serve.ts", "--repo", root, ...(tier === "exam" ? ["--exam-side"] : [])], {
    cwd: PACKAGE,
    env: { ...Bun.env, PORT: "0" },
    stdout: "pipe",
    stderr: "pipe",
    detached: true,
  });
  const stop = async () => {
    await interruptAndReapProcessGroup(child, 2_000);
  };
  try {
    const [origin, token] = await startLine(child.stdout);
    return {
      origin,
      token,
      url: (query = "") => `${origin}/?${query === "" ? "" : `${query}&`}token=${token}`,
      stop,
    };
  } catch (error) {
    await stop();
    throw new Error(`serve.ts did not start: ${await new Response(child.stderr).text()}`, { cause: error });
  }
}

/** The origin and the token of the line `serve.ts` prints at its start, within `START_MS`. Each read
 *  races that bound: checked only between reads, it held a server that printed nothing until Bun
 *  timed the hook out at 60 s. */
async function startLine(stdout: ReadableStream<Uint8Array>): Promise<[string, string]> {
  const reader = stdout.getReader();
  const decoder = new TextDecoder();
  const late = Bun.sleep(START_MS).then(() => ({ done: true, value: undefined }) as const);
  let text = "";
  for (;;) {
    const { done, value } = await Promise.race([reader.read(), late]);
    if (done) break;
    text += decoder.decode(value, { stream: true });
    const match = STARTED.exec(text);
    if (match?.[1] !== undefined && match[2] !== undefined) {
      reader.releaseLock();
      return [match[1], match[2]];
    }
  }
  throw new Error(`no start line within ${String(START_MS)} ms: ${text}`);
}

/** Chrome, headless unless `ANA_UI_HEADED=1` asks for its window, to watch a test click; then
 *  `ANA_UI_SLOW_MS` slows each action by that many milliseconds. Headless is the same Chrome, its
 *  engine, layout and frames, with no window drawn. A shown window takes the screen's focus on
 *  macOS each time a test opens a page, so it is for watching one test; to see what a run did,
 *  record it headless (`ANA_UI_VIDEO`, `openPage`).
 *
 *  The launch and the first context are each bounded at `START_MS`, inside Bun's 60 s for the hook.
 *  On 14 October, at loads of 15 to 54 on 12 cores, Chrome stalled at its start in 4 of the first
 *  15 commits the pre-push gate ran: the launch, or the first context after it, did not answer for
 *  60 s. Bun timed the test out and killed Chrome, and the awaited call rejected after its test had
 *  ended, outside any test, where the test wrapper runs no file again. Bounded here, the stall fails
 *  the file's `beforeAll`, which the wrapper runs again on a crowded host. */
export async function launchBrowser(): Promise<Browser> {
  const executable = Bun.env.ANA_UI_CHROME;
  const options = {
    headless: Bun.env.ANA_UI_HEADED !== "1",
    slowMo: Number(Bun.env.ANA_UI_SLOW_MS ?? "0"),
    timeout: START_MS,
  };
  const browser = await chromium.launch(
    executable === undefined ? { channel: "chrome", ...options } : { executablePath: executable, ...options },
  );
  const answered = browser.newContext().then(async (context) => {
    await context.close();
    return true;
  });
  if (await Promise.race([answered, Bun.sleep(START_MS).then(() => false)])) return browser;
  throw new Error(`Chrome opened no context within ${String(START_MS)} ms of its launch`);
}

/** A fresh context and page at `url`, recording what goes wrong. The page has loaded its first
 *  campaign reading, or its refusal, when this returns. `ANA_UI_VIDEO=<dir>` records each page as
 *  a video in that directory, written as its context closes. */
export async function openPage(browser: Browser, url: string, viewing: Viewing = {}): Promise<Opened> {
  const viewport = { width: viewing.width ?? DESKTOP.width, height: viewing.height ?? DESKTOP.height };
  const options: BrowserContextOptions = {
    viewport,
    reducedMotion: viewing.reducedMotion ?? "no-preference",
    colorScheme: "dark",
  };
  const videos = Bun.env.ANA_UI_VIDEO;
  if (videos !== undefined) options.recordVideo = { dir: videos, size: viewport };
  const context = await browser.newContext(options);
  context.setDefaultTimeout(ACTION_MS);
  const page = await context.newPage();
  const problems: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") {
      problems.push(`console ${message.type()}: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => problems.push(`uncaught: ${error.message}`));
  page.on("response", (response) => {
    if (response.url().includes("/api/") && response.status() >= 500) {
      problems.push(`HTTP ${String(response.status())} ${response.url()}`);
    }
  });
  await page.goto(url);
  return { page, context, problems };
}

/** The page loaded again on Playwright's clock, which runs as the real one until `nextPolls` moves
 *  it on, and settled. Eight tests waited out the page's real poll period, about 110 of the suite's
 *  seconds. The reload reads the campaign and each pane's parts afresh, and a test that began to
 *  watch for changes before they had all arrived counted them as a poll's: on CI on 14 October the
 *  harness strip's files drew twice inside "two polls of a campaign that did not change redraw
 *  nothing". So the reload waits for the network to be idle, 500 ms with no read where the page
 *  polls every 5 s, and then for the page to settle. A count of reads in flight, as the walker
 *  keeps, stayed above zero here: a poll the reload cancelled was reported neither finished nor
 *  failed. */
export async function withClock(page: Page): Promise<void> {
  await page.clock.install();
  await page.reload({ waitUntil: "networkidle" });
  await expect.poll(() => drawn(page), { timeout: ACTION_MS }).toBe("settled");
}

/** What the page shows two frames from now: "settled", or why not. */
export function drawn(page: Page): Promise<string> {
  return page.evaluate(async () => {
    await new Promise((done) => {
      requestAnimationFrame(() => requestAnimationFrame(done));
    });
    const main = document.querySelector("main");
    if (main === null) return "no main";
    if (document.querySelector("[aria-busy='true']") !== null) return "busy";
    if (main.querySelector("h1, h2, table") === null) return `blank: ${main.innerText.slice(0, 80)}`;
    if (document.body.innerText.includes("is loading")) return "loading";
    return "settled";
  });
}

/**
 * Brings the page's next `count` reads of its campaign, or of what `path` names, at once, on a page `withClock` loaded: the
 * clock is moved on a poll period until a read answers. The next poll is set only once the last read
 * has answered (`poll.ts`), so a move made while a read runs brings nothing, and the clock is moved
 * again. A read of the campaign already shown starts no slow-read wait (`waited.ts`), so moving the
 * clock past one changes nothing else on the page.
 */
export async function nextPolls(page: Page, count: number, path = "/api/campaign"): Promise<void> {
  for (let read = 0; read < count; read += 1) {
    let answered = false;
    const answer = page
      .waitForResponse((response) => new URL(response.url()).pathname === path)
      .then(() => {
        answered = true;
      });
    await expect
      .poll(async () => {
        if (!answered) await page.clock.fastForward(POLL_MS);
        return answered;
      })
      .toBe(true);
    await answer;
  }
}

/** The page reported nothing wrong, less what a test expected (`allowed`, matched by substring). */
export function expectQuiet(opened: Opened, allowed: readonly string[] = []): void {
  const unexpected = opened.problems.filter((problem) => !allowed.some((each) => problem.includes(each)));
  expect(unexpected).toEqual([]);
}

/** Every answer the page reads from the API, its body kept as it passes: a read the page cancels
 *  for a newer one keeps none to ask for once it has ended, which failed a test on CI on 14 October.
 *  A read still in flight when its page closes ends there and is no answer: on 20 October, under a
 *  load of 42 on 12 cores, a test that timed out left one, whose `socket hang up` was printed
 *  outside any test and failed `bun run land` on a commit that changed no test. */
export async function keepAnswers(page: Page): Promise<string[]> {
  const answers: string[] = [];
  await page.route("**/api/**", async (route) => {
    const response = await route.fetch().catch(() => null);
    if (response === null) return;
    answers.push(await response.text());
    await route.fulfill({ response }).catch(() => undefined);
  });
  return answers;
}

/** The search parameters of the page's address now, the token left out. */
export function routeParameters(page: Page): Record<string, string> {
  const query = new URL(page.url()).searchParams;
  query.delete("token");
  return Object.fromEntries(query.entries());
}

/** The axe-core rules the page breaks at WCAG 2.2 AA, each with the nodes it names. */
export async function accessibilityViolations(page: Page, within?: string): Promise<string[]> {
  const builder = new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]);
  const results = await (within === undefined ? builder : builder.include(within)).analyze();
  return results.violations.map(
    (violation) =>
      `${violation.id}: ${violation.help} (${violation.nodes.map((node) => node.target.join(" ")).join(", ")})`,
  );
}

/**
 * Count, on every animation frame of every page of `context`, whether `main` shows the placeholder
 * a campaign stands behind while it is read sooner than the page's patience after the last click,
 * and whether it shows nothing at all, with the address of each such frame. The operator's
 * recording of 14 October caught a switch of project painting the placeholder for four frames; a
 * screenshot taken before or after never would, so the page is sampled where it paints. A
 * placeholder after the patience is what the page owes a slow read, and on a host loaded to 14 on 8
 * cores on 21 October a switch whose read the test answered at once still took that long to draw,
 * so the count is held to the page's own clock. Read and reset the counts with `framesSeen`.
 */
export async function sampleFrames(context: BrowserContext): Promise<void> {
  await context.addInitScript((patienceMs: number) => {
    const seen: Sampled = { placeholder: 0, blank: 0, frames: 0, clickedAt: 0, at: [] };
    window.anaFramesSeen = seen;
    document.addEventListener(
      "click",
      () => {
        seen.clickedAt = performance.now();
      },
      { capture: true },
    );
    const sample = () => {
      const main = document.querySelector("main");
      seen.frames += 1;
      if (main !== null) {
        const placeholder = (main.textContent ?? "").includes("Reading the campaign");
        const early = placeholder && performance.now() - seen.clickedAt < patienceMs;
        const blank = !placeholder && main.querySelector("h1, h2, table") === null;
        if (early) seen.placeholder += 1;
        if (blank) seen.blank += 1;
        if (early || blank) seen.at.push(location.search);
      }
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  }, PATIENCE_FLOOR_MS);
}

/** The sampler's counts since it was installed or last read, which this resets. */
export async function framesSeen(page: Page): Promise<FramesSeen> {
  return await page.evaluate(() => {
    const seen = window.anaFramesSeen;
    if (seen === undefined) throw new Error("the frame sampler is not installed: call sampleFrames first");
    const counts = { placeholder: seen.placeholder, blank: seen.blank, frames: seen.frames };
    seen.placeholder = 0;
    seen.blank = 0;
    seen.frames = 0;
    seen.at = [];
    return counts;
  });
}
