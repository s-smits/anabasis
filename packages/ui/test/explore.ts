/**
 * The page explored as a person would, without a script of what to click: every kind of control it
 * offers clicked once from a fresh page (`sweep`), and long seeded runs of clicks, keys, history steps and
 * window sizes (`walk`), with what must hold after every step (`unsound`).
 *
 * The other browser tests click what their author chose, and on 14 October each fault they found
 * was one a person met by clicking where no test had: an axis label that opened two comparisons, a
 * label crossed by a divider, focus lost on the inspector's close. The hypothesis repository's
 * `merge-and-verify` skill holds the same line, that whatever a page offers is clicked in the
 * browser before it ships. A walk is the stateful form of a property test: a failure names its seed
 * and the steps taken, and `replay` runs those steps again on a fresh page.
 *
 * What must hold after a step is what holds of every state the page can reach: the browser reported
 * nothing wrong, the page settled with a pane drawn and nothing still loading, the page is no wider
 * than its window, the default tier shows no exam-side value, and axe-core finds no WCAG 2.2 AA
 * rule broken, once for each kind of address and width.
 */
import type { Locator, Page, Request } from "@playwright/test";
import { ACTION_MS, accessibilityViolations, DESKTOP, drawn, expect, type Opened, PHONE } from "./browser.ts";
import { MARKERS } from "./fixture-campaign.ts";

/** What can be acted on: a native control or an element with an interactive role. */
const CONTROLS = [
  "button",
  "a[href]",
  "input",
  "select",
  "summary",
  "[role='button']",
  "[role='option']",
  "[role='tab']",
  "[role='combobox']",
  "[tabindex]:not([tabindex='-1'])",
].join(", ");

/** The keys a person reaches for besides a click. */
const KEYS = ["Escape", "Tab", "Shift+Tab", "Enter", "ArrowLeft", "ArrowRight"] as const;

/** How long a pointer is given to reach a control, and a resized page to settle its width. */
const REACH_MS = 1_000;

/** What a search field is given: nothing, a word the fixture holds, and one it does not. */
const TYPED = ["", "word", "zz-none", "b-1"] as const;

/** One step, as `replay` takes it again: a control is named by its description, not its place. */
export type Step =
  | { readonly click: string }
  | { readonly fill: string; readonly text: string }
  | { readonly choose: string; readonly option: number }
  | { readonly key: (typeof KEYS)[number] }
  | { readonly history: "back" | "forward" }
  | { readonly width: number };

/** A control on the page now: its description and how to reach it. */
interface Control {
  readonly described: string;
  readonly kind: "click" | "fill" | "choose";
  readonly locator: Locator;
}

/** What an exploration saw: the distinct states it checked and the steps it took. */
export interface Explored {
  readonly steps: Step[];
  readonly states: number;
}

/** A tier's settings for what must hold: the default tier withholds the exam side's values. */
export interface Rules {
  readonly withheld: boolean;
}

/** One exploration under way: its page, its rules, the states it checked and the steps so far. */
interface Run {
  readonly opened: Opened;
  /** The page's reads of the API that have not yet answered. */
  readonly pending: () => number;
  readonly rules: Rules;
  readonly label: string;
  readonly checked: Set<string>;
  readonly trail: Step[];
}

/** Counters of each page's reads of the API in flight, kept once a page however many runs begin on it. */
const counted = new WeakMap<Page, () => number>();

/** A small seeded generator (mulberry32), so a walk is the same walk for the same seed. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** The controls a person can act on now, in document order, each described by its tag, role and
 *  name, with a number after a repeated description. Hidden, disabled and inert ones are left out,
 *  as is a link that leaves the page's origin. */
async function controlsOf(page: Page): Promise<Control[]> {
  const found = await page.evaluate((selector) => {
    for (const stale of document.querySelectorAll("[data-ana-control]")) {
      stale.removeAttribute("data-ana-control");
    }
    const seen = new Map<string, number>();
    const list: { described: string; kind: "click" | "fill" | "choose" }[] = [];
    for (const [at, element] of [...document.querySelectorAll<HTMLElement>(selector)].entries()) {
      const box = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      const hidden = box.width === 0 || box.height === 0 || style.visibility === "hidden";
      const disabled =
        element.matches(":disabled") || element.closest("[inert], [aria-disabled='true']") !== null;
      const away = element instanceof HTMLAnchorElement && new URL(element.href).origin !== location.origin;
      if (hidden || disabled || away) continue;
      const name =
        [element.getAttribute("aria-label"), element.textContent, element.getAttribute("title")]
          .map((each) => (each ?? "").replace(/\s+/gu, " ").trim())
          .find((each) => each !== "") ?? "";
      const role = element.getAttribute("role") ?? element.tagName.toLowerCase();
      const base = `${role} "${name.slice(0, 60)}"`;
      const count = (seen.get(base) ?? 0) + 1;
      seen.set(base, count);
      element.setAttribute("data-ana-control", String(at));
      const kind =
        element instanceof HTMLInputElement
          ? "fill"
          : element instanceof HTMLSelectElement
            ? "choose"
            : "click";
      list.push({ described: count === 1 ? base : `${base} #${String(count)}`, kind });
    }
    return list.map((each, index) => ({ ...each, index }));
  }, CONTROLS);
  const marked = page.locator("[data-ana-control]");
  return found.map(({ described, kind, index }) => ({ described, kind, locator: marked.nth(index) }));
}

/** Waits until the page has settled: no read of the API in flight, two frames painted since, a pane
 *  drawn in `main`, and nothing busy or loading. A read says nothing for its first 400 ms
 *  (`waited.ts`), so a page that looks settled may still be about to replace what it shows: on
 *  14 October a walk over a real campaign read the Tasks pane's filters while a task was read, and
 *  waited on them once the task's detail had hidden them. */
async function settle(page: Page, pending: () => number): Promise<void> {
  await expect
    .poll(async () => (pending() > 0 ? "reading" : await drawn(page)), { timeout: ACTION_MS })
    .toBe("settled");
}

/** What does not hold of the page now, each as a sentence; empty where all of it holds. */
async function unsound(opened: Opened, rules: Rules, checked: Set<string>): Promise<string[]> {
  const { page } = opened;
  const wrong = opened.problems.splice(0).map((problem) => `the browser reported ${problem}`);
  // A chart takes its new width on the frame after a resize, so the width is read until it holds.
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  const wider = await expect
    .poll(overflow, { timeout: REACH_MS })
    .toBeLessThanOrEqual(0)
    .then(() => 0, overflow);
  // axe runs once for each kind of address, its parameters by name and its pane by value: a hundred
  // rows of the log, each its own address, are one kind, and checking each took a minute and a half.
  const { text, kind, width } = await page.evaluate(() => {
    const query = new URLSearchParams(location.search);
    query.delete("token");
    const names = [...query.keys()].map((name) => (name === "pane" ? `pane=${query.get(name) ?? ""}` : name));
    return { text: document.body.innerText, kind: names.toSorted().join("&"), width: window.innerWidth };
  });
  if (wider > 0) wrong.push(`the page is ${String(wider)} px wider than its window`);
  if (rules.withheld) {
    for (const [what, marker] of Object.entries(MARKERS)) {
      if (text.includes(marker)) wrong.push(`the default tier shows the ${what} value ${marker}`);
    }
  }
  const state = `${String(width)} ${kind}`;
  if (!checked.has(state)) {
    checked.add(state);
    for (const violation of await accessibilityViolations(page)) wrong.push(`axe: ${violation}`);
  }
  return wrong;
}

/** Takes one step on the page. */
async function take(page: Page, step: Step): Promise<void> {
  if ("history" in step) {
    await (step.history === "back" ? page.goBack() : page.goForward());
    // Back from the first page leaves it for the blank one a context opens on, which is the
    // browser's and not the page's: the step comes back.
    if (!page.url().startsWith("http")) await page.goForward();
  } else if ("key" in step) {
    await page.keyboard.press(step.key);
  } else if ("width" in step) {
    await page.setViewportSize({
      width: step.width,
      height: step.width === PHONE.width ? PHONE.height : DESKTOP.height,
    });
  } else {
    const described = "click" in step ? step.click : "fill" in step ? step.fill : step.choose;
    const control = (await controlsOf(page)).find((each) => each.described === described);
    if (control === undefined) throw new Error(`no control ${described} on ${page.url()}`);
    if ("fill" in step) await control.locator.fill(step.text);
    else if ("choose" in step) {
      const values = await control.locator
        .locator("option")
        .evaluateAll((options) =>
          options.map((option) => option.getAttribute("value") ?? option.textContent ?? ""),
        );
      await control.locator.selectOption(values[step.option % Math.max(values.length, 1)] ?? "");
    } else {
      // A control only the keyboard reaches, as the skip link and the chart's table for a screen
      // reader are, is focused and pressed, as a person on the keyboard would.
      const pointed = await control.locator.click({ trial: true, timeout: REACH_MS }).then(
        () => true,
        () => false,
      );
      await (pointed ? control.locator.click() : control.locator.press("Enter"));
    }
  }
}

/** A run from `start` on a fresh load of it. */
async function begin(opened: Opened, start: string, rules: Rules, label: string): Promise<Run> {
  const pending = inFlight(opened.page);
  await opened.page.goto(start);
  await settle(opened.page, pending);
  return { opened, pending, rules, label: `${label} from ${start}`, checked: new Set(), trail: [] };
}

/** How many reads of the API the page has asked for and not yet had answered or failed. */
function inFlight(page: Page): () => number {
  const known = counted.get(page);
  if (known !== undefined) return known;
  const open = new Set<Request>();
  const api = (request: Request) => new URL(request.url()).pathname.startsWith("/api/");
  page.on("request", (request) => {
    if (api(request)) open.add(request);
  });
  page.on("requestfinished", (request) => open.delete(request));
  page.on("requestfailed", (request) => open.delete(request));
  const pending = () => open.size;
  counted.set(page, pending);
  return pending;
}

/** Takes a step and lets the page settle, and throws what then does not hold, with the run's
 *  label and every step it took, so that `replay` can take them again. */
async function stepAndCheck(run: Run, step: Step): Promise<void> {
  run.trail.push(step);
  const failed = await take(run.opened.page, step)
    .then(() => settle(run.opened.page, run.pending))
    .then(
      () => null,
      (error: Error) => error.message,
    );
  const wrong = failed === null ? await unsound(run.opened, run.rules, run.checked) : [failed];
  if (wrong.length > 0) {
    throw new Error(`${run.label}, after ${JSON.stringify(run.trail)}:\n${wrong.join("\n")}`);
  }
}

/** The step a control asks for, with the generator's choice of text or option. */
function stepFor(control: Control, random: () => number): Step {
  if (control.kind === "fill") {
    return { fill: control.described, text: TYPED[Math.floor(random() * TYPED.length)] ?? "" };
  }
  if (control.kind === "choose") return { choose: control.described, option: Math.floor(random() * 8) };
  return { click: control.described };
}

/** The first and the last control of each kind, in document order. A kind is a description with
 *  its numbers and its repeat count taken out, so the hundred rows of the log, `button "1"` to
 *  `button "100"`, are one; a row is drawn by the code that draws its neighbours, and a list's ends
 *  are where it meets what is around it. */
function representatives(described: readonly string[]): [number, string][] {
  const ends = new Map<string, [number, number]>();
  for (const [at, name] of described.entries()) {
    const kind = name.replace(/ #\d+$/u, "").replace(/\d+/gu, "#");
    ends.set(kind, [ends.get(kind)?.[0] ?? at, at]);
  }
  const chosen = new Set([...ends.values()].flat());
  return [...described.entries()].filter(([at]) => chosen.has(at));
}

/**
 * Every kind of control the page at `start` offers, acted on once from a fresh load of it, then
 * Escape and one step back, with what must hold checked after each. The first and last of each
 * kind are acted on (`representatives`): on 18 October the log pane offered 113 controls of 14
 * kinds, 100 of them its rows, and a sweep of every control took 51 seconds on a quiet host and two
 * minutes in a loaded gate, against 10 seconds for the kinds. A control is found again by its description, so
 * a page that draws its controls in another order on a second load still lines up.
 */
export async function sweep(opened: Opened, start: string, rules: Rules): Promise<Explored> {
  const { page } = opened;
  const first = await begin(opened, start, rules, "the sweep");
  const described = (await controlsOf(page)).map((control) => control.described);
  const steps: Step[] = [];
  for (const [at, name] of representatives(described)) {
    const run = { ...(await begin(opened, start, rules, `the sweep of ${name}`)), checked: first.checked };
    // A part read after the pane, as a harness's files are, draws its controls a moment later.
    let control: Control | undefined;
    await expect
      .poll(
        async () => {
          control = (await controlsOf(page)).find((each) => each.described === name);
          return control !== undefined;
        },
        { timeout: ACTION_MS, message: `a fresh load of ${start} has no control ${name}` },
      )
      .toBe(true);
    if (control === undefined) throw new Error(`a fresh load of ${start} has no control ${name}`);
    for (const step of [
      stepFor(control, seeded(at)),
      { key: "Escape" } as const,
      { history: "back" } as const,
    ]) {
      await stepAndCheck(run, step);
    }
    steps.push(...run.trail);
  }
  return { steps, states: first.checked.size };
}

/** `length` steps from `start`, each drawn by the seed's generator: mostly a click on a control the
 *  page offers then, else a key, a history step or the other window width. */
export async function walk(opened: Opened, start: string, seed: number, length: number, rules: Rules) {
  const { page } = opened;
  const random = seeded(seed);
  const run = await begin(opened, start, rules, `the walk with seed ${String(seed)}`);
  for (let taken = 0; taken < length; taken += 1) {
    const roll = random();
    let step: Step;
    if (roll < 0.7) {
      const controls = await controlsOf(page);
      const control = controls[Math.floor(random() * controls.length)];
      step = control === undefined ? { key: "Escape" } : stepFor(control, random);
    } else if (roll < 0.85) step = { key: KEYS[Math.floor(random() * KEYS.length)] ?? "Escape" };
    else if (roll < 0.95) step = { history: random() < 0.7 ? "back" : "forward" };
    else step = { width: page.viewportSize()?.width === PHONE.width ? DESKTOP.width : PHONE.width };
    await stepAndCheck(run, step);
  }
  return { steps: run.trail, states: run.checked.size };
}

/** Takes `steps` again from `start`, as a failed walk printed them, checking after each. */
export async function replay(opened: Opened, start: string, steps: readonly Step[], rules: Rules) {
  const run = await begin(opened, start, rules, "the replay");
  for (const step of steps) await stepAndCheck(run, step);
}
