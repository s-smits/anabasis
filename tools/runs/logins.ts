/**
 * How much of each login's 5-hour and weekly window is used, when each runs out at its pace so far,
 * and, read over every login, when the pool runs out. A move to another login reads the windows
 * alone (`room`, `keep.ts`).
 *
 *   bun --env-file=<file> run runs usage [N ...] [--json] [--open] [--closed]
 *   bun run runs active [--here [--login N]]
 *
 * A login is `CLAUDE_CODE_OAUTH_TOKEN<N>` in this process's environment, which Bun's own
 * `--env-file` loads: the verb opens no file of credentials, and prints no token. With no number it
 * reads every login the environment holds. `--open` and `--closed` are `login-state.ts`'s.
 *
 * Two routes, the first taken from steipete/CodexBar@afeb28146cec
 * (Sources/CodexBarCore/Providers/Claude/ClaudeOAuth/ClaudeOAuthUsageFetcher.swift): GET
 * /api/oauth/usage with its headers, window keys, `limits` entries and `extra_usage`. That endpoint
 * needs the `user:profile` scope, and a `claude setup-token` token carries only `user:inference`
 * (403 oauth_scope_insufficient), so for those the verb reads the `anthropic-ratelimit-unified-*`
 * headers off a one-token Haiku call instead: the numbers the CLI shows, for one output token.
 *
 * When the pool runs out is `usage-model.ts`'s, from the readings kept in the main worktree's
 * `.ana/logins-history.jsonl` (28 days). The 5-hour windows are left out: they cap how fast one
 * login spends, not what a week holds. These forecasts are printed for a person and feed no choice;
 * a keeper asks of one login's five hours by themselves, with the run it would move there added
 * (`fiveHourWith`).
 *
 * `bun run runs active` names the runs a process writes, by the login each run's last launch named,
 * and the live seats of `system-path-simulation`, by the login each seat names (`liveHere`), on this
 * machine and every host `ANA_HOSTS` lists (`liveEverywhere`), and asks no provider; `--here` prints
 * this machine's alone as JSON, which is what each host is asked, and with `--login N` whether this
 * machine's environment holds that login. `usage` puts
 * each login's count on its head line, out of the most `ANA_LOGIN_RUNS` or its subscription in
 * `ANA_LOGIN_SUBS` lets that login carry (`capOf`), and sums the subscriptions' most under the logins.
 *
 * Each reading keeps that count beside each login's week, and the rises between readings over the
 * runs counted give the share of a week a run spends an hour (`perRunRate`). The most a login can
 * carry is then the lower of its cap and the runs its week left fits over a run's twelve hours, or
 * until the reset where that comes sooner, each run active 16 of 24 hours (`fitOf`), and a login with
 * more live runs than that reads oversubscribed (`carried`), so a cap of two does not read 0/2 on a
 * login at 92% of its week with 11 hours of it left. Until that rate is measured, a login with live
 * runs reads its own week's pace shared over them (`perRunHour`).
 *
 * `ANA_LOGINS` in the environment, such as `2,3,4`, names the logins a run may take (`allowedLogins`),
 * every login the environment holds where it is unset.
 */
import { openingOf, SEATS } from "#src/campaign/opening.ts";
import type { LogEvent } from "#src/kernel/log.ts";
import { mkdirSync, writeFileSync } from "#src/meta/filesystem.ts";
import { capturedJsonParse, capturedJsonStringify } from "#src/meta/json-runtime.ts";
import { asRecord, isNumber, isString, type JsonValue } from "#src/meta/json-shape.ts";
import { keysIf } from "#src/meta/optional-key.ts";
import { dirname } from "#src/meta/path.ts";
import { parseArgs, runtimeProcess } from "#src/meta/process.ts";
import { errorMessage } from "#src/meta/runtime-values.ts";
import { runSync, zeroExitText } from "#src/meta/subprocess.ts";
import { hasText, textOr } from "#src/meta/text.ts";
import { looseFlagsOf } from "../d2/campaign-terms.ts";
import { recordedSetting } from "../d2/setting.ts";
import { asked } from "./hosts.ts";
import { hostsOf } from "./host-config.ts";
import { CODEX, countedAgainst, type Live, liveHere, liveOf } from "./live.ts";
import {
  closedResets,
  historyFile,
  keptReadings,
  listedBy,
  notClosed,
  resetOf,
  stateWords,
  windowOpen,
} from "./login-state.ts";
import {
  assess,
  byTime,
  clock,
  type End,
  endWords,
  modelLines,
  poolLine,
  sameWindow,
  type Snapshot,
  spanOf,
  type Week,
  weekPace,
} from "./usage-model.ts";

export interface Window {
  readonly pct: number | null;
  readonly resetsAt: string | null;
  readonly status?: string;
}

interface Read {
  readonly via: "oauth-usage" | "ratelimit-headers";
  readonly fiveHour: Window;
  readonly sevenDay: Window;
  readonly notes: readonly string[];
}

/** One login's reading, or why there is none. */
export type Reading = { readonly login: string; readonly plain: boolean } & (Read | Failed);

interface Failed {
  readonly error: string;
}

/** A process environment, as `runtimeProcess.env` holds it. */
export type Env = Readonly<Record<string, string | undefined>>;

export const TOKEN = "CLAUDE_CODE_OAUTH_TOKEN";
/** A numbered login's key, with its number captured. */
export const NUMBERED = new RegExp(`^${TOKEN}(\\d+)$`);
/** The plain login's name among the logins `readLogins` is asked for: its key is `TOKEN` and nothing. */
const PLAIN = "";
const BASE = "https://api.anthropic.com";
const BETA = "oauth-2025-04-20";
const TIMEOUT_MS = 30_000;
const HOUR = 3_600_000;
/** The readings kept, for `usage-model.ts`'s longest window; the per-run rate reads the last `RATE_MS`. */
const KEPT_MS = 28 * 24 * HOUR;
const RATE_MS = 8 * 24 * HOUR;
/** The share of a day a run is read active for the runs a week fits: 16 of 24 hours (operator, 22 October). */
const ACTIVE_SHARE = 16 / 24;
/** The hours a run is read to live: the release cycle stops its runs twelve hours after their
 *  opening (`AGENTS.md`, section 1). Until 29 October each run was read to live until its login's
 *  reset, so login 1 at 84% of its week with 83 hours to go read 2/0 and oversubscribed while its two
 *  runs needed about 7% of the 16% left before their stop, and a fresh week read 1/1. */
const RUN_HOURS = 12;
/** Fewer run-hours than this on record measure no rate a run spends (`perRunRate`). */
const LEAST_RUN_HOURS = 6;
const FIVE_HOURS = 5 * 60;
/** The % of a login's five-hour window a run is taken to spend an hour where the login carries no run
 *  to read it from (`fiveHourWith`). This is the upper end of what was printed: over 126 readings of a
 *  window at least an hour old up to 5 November, its pace over its live runs read a median of 6.0 and
 *  a ninetieth percentile of 15.5, with medians from 1.9 to 12.8 by login, so one number serves only
 *  where a login's own pace says nothing. An empty window reads 75% at its reset. */
const RUN_FIVE_HOUR = 15;
const NOTED = [
  ["seven_day_opus", "opus"],
  ["seven_day_sonnet", "sonnet"],
  ["seven_day_oauth_apps", "oauth apps"],
  ["seven_day_routines", "routines"],
] as const;

/** The live runs each subscription carries, by provider (operator, 4 November): a Claude login two
 *  on `max` and four on `ultra`, the Codex login two on `pro100` and four on `pro200`, which counts
 *  a machine as its cap does. */
const SUBS: Readonly<Record<"claude" | "codex", Readonly<Record<string, string>>>> = {
  claude: { max: "2", ultra: "4" },
  codex: { pro100: "2", pro200: "4" },
};

/** Every login `env` holds, by its number. A key left empty holds none: a copied `.env.example`
 *  names `CLAUDE_CODE_OAUTH_TOKEN2=`, and until 5 November that made a login nobody can pay with, so
 *  `fresh` said no login had room. */
function loginsIn(env: Env): string[] {
  return Object.entries(env)
    .flatMap(([key, value]) => (hasText(value) ? (NUMBERED.exec(key)?.[1] ?? []) : []))
    .toSorted((one, other) => Number(one) - Number(other));
}

/** `login`'s credential in `env`, or undefined where it holds none or a blank one. */
export function tokenOf(env: Env, login: string): string | undefined {
  const token = env[`${TOKEN}${login}`];
  return hasText(token) ? token : undefined;
}

/** The key to set where none of `allowed` holds one, or null where one does. Until 5 November this
 *  read as no login having room, which names a limit where the credential is what is missing. */
export function noLogin(env: Env, allowed: readonly string[]): string | null {
  if (allowed.some((login) => tokenOf(env, login) !== undefined)) return null;
  const keys = allowed.length === 0 ? TOKEN : allowed.map((login) => `${TOKEN}${login}`).join(" or ");
  return `no login here: set ${keys} in the process environment, or in a file named with bun --env-file=<file>`;
}

/** The logins a run may take: those `ANA_LOGINS` names, or every login `env` holds. */
export function allowedLogins(env: Env): string[] {
  const named = env.ANA_LOGINS?.split(",")
    .map((login) => login.trim())
    .filter((login) => login !== "");
  return named === undefined || named.length === 0 ? loginsIn(env) : named;
}

/** Whether a run goes on the plain `CLAUDE_CODE_OAUTH_TOKEN` alone: no numbered login is allowed
 *  and the plain one is set, as on a machine with one Claude login. Until 28 October `fresh` and
 *  `keep` refused such a machine for want of a numbered login. */
export function plainOnly(env: Env): boolean {
  return allowedLogins(env).length === 0 && hasText(env[TOKEN]);
}

/** Whether a run bills a Claude login: whether an effective seat is a `claude/` model. The last
 *  flag for each seat overrides its opening, with the setting as the solver's fallback. The pickers
 *  that choose a login (`fresh`, `keep`) ask it; the launcher names only the login it is given. */
export function billsLogin(events: readonly LogEvent[], flags: readonly string[]): boolean {
  const values = looseFlagsOf(flags);
  const opening = openingOf(events);
  return [
    ...SEATS.map((seat) => values[seat] ?? opening?.seats[seat]?.model),
    values.solver ?? opening?.solver?.model ?? recordedSetting(events)?.solver?.model,
  ].some((model) => isString(model) && model.startsWith("claude/"));
}

/** The subscription `ANA_LOGIN_SUBS` names for `login`, such as `N:ultra` or `codex:pro200`, and
 *  the runs it carries; null where it names none or one its provider does not offer. */
function subOf(env: Env, login: string): { readonly sub: string; readonly runs: string } | null {
  const offered = SUBS[login === CODEX ? "codex" : "claude"];
  const entries = (env.ANA_LOGIN_SUBS ?? "").split(",").map((entry) => entry.trim().split(":"));
  const sub = entries.find(([who]) => who === login)?.[1];
  const runs = sub === undefined || !Object.hasOwn(offered, sub) ? undefined : offered[sub];
  return sub === undefined || runs === undefined ? null : { sub, runs };
}

/** The most live runs `login` may carry: its own `N:most` in `ANA_LOGIN_RUNS` such as `2,1:4`, then
 *  what its subscription carries (`subOf`), then the bare number there for every numbered login.
 *  `null` where none names it. The Codex CLI's login takes no bare number, and one a machine
 *  without an entry or a subscription (operator, 29 October). Until 4 November no subscription
 *  was read, and each larger login took an `N:4` by hand. */
export function capOf(env: Env, login: string): string | null {
  const entries = (env.ANA_LOGIN_RUNS ?? "").split(",").map((entry) => entry.trim().split(":"));
  const own =
    entries.find(([who, most]) => who === login && most !== undefined)?.[1] ?? subOf(env, login)?.runs;
  if (login === CODEX) return own ?? "1";
  return own ?? entries.find(([most, rest]) => most !== "" && rest === undefined)?.[0] ?? null;
}

/** The logins of `allowed` that carry as many live runs across the fleet (`live`) as their cap,
 *  which takes no other run: neither a fresh one nor one a keeper moves. */
export function atCap(env: Env, allowed: readonly string[], live: readonly Live[]): Set<string> {
  return new Set(
    allowed.filter((login) => {
      const cap = login === CODEX ? null : capOf(env, login);
      return cap !== null && live.filter((run) => run.login === login).length >= Number(cap);
    }),
  );
}

/** Why `host` takes no other run of `payer`, or null where it does: the Codex CLI's login is one a
 *  machine, so its cap from `ANA_LOGIN_RUNS` (`codex:1`) counts the runs on that machine alone. */
export function fullOn(
  env: Env,
  payer: string | undefined,
  host: string,
  live: readonly Live[],
): string | null {
  if (payer !== CODEX) return null;
  const cap = capOf(env, CODEX);
  const on = live.filter((run) => run.host === host && run.login === CODEX).length;
  return on >= Number(cap ?? 1)
    ? `${host} carries ${String(on)} live ${CODEX} run(s), at most ${cap ?? "1"} a machine (ANA_LOGIN_RUNS): name another --host, or none`
    : null;
}

/** Why a run that `payer` pays may not start on `host` beside the runs in `live`, less one named
 *  `name` (the run itself, live where it is moved from), or null where it may: a host that went
 *  uncounted, a login at its cap across the fleet (counting `countedAgainst` it), or a machine at its
 *  cap of Codex runs. Until 29 October only `fresh` and `keep` held a login to its cap, and
 *  `continue` and `move` were counted by hand. */
export function startRefusal(
  env: Env,
  payer: string | undefined,
  host: string,
  counted: { readonly live: readonly Live[]; readonly unasked: readonly string[] },
  name: string,
): string | null {
  if (payer === undefined) return null;
  if (counted.unasked.length > 0) return uncounted(counted.unasked);
  const others = countedAgainst(counted.live, name);
  return atCap(env, [payer], others).size > 0
    ? `login ${payer} is at its live-run cap across the fleet (ANA_LOGIN_RUNS, ANA_LOGIN_SUBS)`
    : fullOn(env, payer, host, others);
}

/** Refuse to start `name` on `host` for `payer` where `startRefusal` says why. */
export async function roomToStart(payer: string | undefined, host: string, name: string): Promise<void> {
  if (payer === undefined) return;
  const refused = startRefusal(runtimeProcess.env, payer, host, await liveEverywhere("configured"), name);
  if (refused !== null) throw new Error(`${name}: ${refused}; nothing was stopped or started`);
}

/** The usage endpoint's window `value`: its share used and its reset. */
function windowOf(value: JsonValue | undefined): Window {
  const window = asRecord(value);
  const used = window?.utilization;
  const reset = window?.resets_at;
  return { pct: isNumber(used) ? used : null, resetsAt: isString(reset) ? reset : null };
}

async function viaOAuthUsage(token: string, agent: string): Promise<Read | Failed> {
  const res = await fetch(`${BASE}/api/oauth/usage`, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/json",
      "content-type": "application/json",
      "anthropic-beta": BETA,
      "user-agent": agent,
    },
  });
  if (res.status === 401) return { error: "OAuth request unauthorized: the token needs a new login" };
  if (res.status === 429) {
    return {
      error: `the usage endpoint is rate limited (Retry-After ${res.headers.get("retry-after") ?? "?"})`,
    };
  }
  if (!res.ok) {
    const code = /"error_code":"([^"]+)"/.exec(await res.text())?.[1];
    return { error: `OAuth error: HTTP ${String(res.status)}${code === undefined ? "" : ` – ${code}`}` };
  }
  const body = asRecord(capturedJsonParse(await res.text())) ?? {};
  const notes = NOTED.flatMap(([key, label]) => {
    const { pct } = windowOf(body[key]);
    return pct === null ? [] : [`${label} week ${String(Math.round(pct))}%`];
  });
  for (const entry of Array.isArray(body.limits) ? body.limits : []) {
    const limit = asRecord(entry);
    const model = asRecord(asRecord(limit?.scope)?.model)?.display_name;
    const percent = limit?.percent;
    if (isString(model) && isNumber(percent)) {
      const group = [limit?.group, limit?.kind].find(isString) ?? "";
      notes.push(`${model} ${group} ${String(Math.round(percent))}%`.replaceAll(/\s+/g, " "));
    }
  }
  const extra = asRecord(body.extra_usage);
  if (extra?.is_enabled === true) {
    const currency = isString(extra.currency) ? extra.currency : "";
    const used = isNumber(extra.used_credits) ? extra.used_credits : 0;
    const limit = isNumber(extra.monthly_limit) ? String(extra.monthly_limit) : "?";
    notes.push(`extra usage ${String(used)}/${limit} ${currency}`.trim());
  }
  return {
    via: "oauth-usage",
    fiveHour: windowOf(body.five_hour),
    sevenDay: windowOf(body.seven_day),
    notes,
  };
}

async function viaRateLimitHeaders(token: string, agent: string): Promise<Read | Failed> {
  const res = await fetch(`${BASE}/v1/messages`, {
    method: "POST",
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: {
      authorization: `Bearer ${token}`,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": BETA,
      "content-type": "application/json",
      "user-agent": agent,
    },
    body: capturedJsonStringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1,
      system: "You are Claude Code, Anthropic's official CLI for Claude.",
      messages: [{ role: "user", content: "." }],
    }),
  });
  const header = (key: string) => res.headers.get(`anthropic-ratelimit-unified-${key}`);
  if (header("5h-utilization") === null && header("7d-utilization") === null) {
    const revoked = res.status === 401 ? " (token revoked or expired)" : "";
    return { error: `messages HTTP ${String(res.status)}, no rate-limit headers${revoked}` };
  }
  const win = (key: string): Window => {
    const used = header(`${key}-utilization`);
    const reset = header(`${key}-reset`);
    const window: Window = {
      pct: used === null ? null : Number(used) * 100,
      resetsAt:
        reset === null ? null : /^\d+$/.test(reset) ? new Date(Number(reset) * 1000).toISOString() : reset,
    };
    const status = header(`${key}-status`);
    return status === null ? window : { ...window, status };
  };
  const overage = header("overage-status");
  const why = header("overage-disabled-reason");
  const claim = header("representative-claim");
  const notes = [
    ...(overage === null ? [] : [`overage ${overage}${why === null ? "" : ` (${why})`}`]),
    ...(claim === null ? [] : [`binding ${claim}`]),
  ];
  return { via: "ratelimit-headers", fiveHour: win("5h"), sevenDay: win("7d"), notes };
}

/** Each of `wanted` read from `env`, by the first route that answers. */
export async function readLogins(wanted: readonly string[], env: Env): Promise<Reading[]> {
  const version = zeroExitText(runSync(["claude", "--version"]))?.split(/\s+/)[0];
  // CodexBar's fallbackClaudeCodeVersion where no CLI answers.
  const agent = `claude-code/${textOr(version, "2.1.0")}`;
  return Promise.all(
    wanted.map(async (login): Promise<Reading> => {
      const token = tokenOf(env, login);
      if (token === undefined) {
        return { login, plain: false, error: `no ${TOKEN}${login} in the environment` };
      }
      const plain = env[TOKEN] === token;
      try {
        const first = await viaOAuthUsage(token, agent);
        if (!("error" in first)) return { login, plain, ...first };
        const second = await viaRateLimitHeaders(token, agent);
        if (!("error" in second)) return { login, plain, ...second };
        return { login, plain, error: `${first.error}; ${second.error}` };
      } catch (error) {
        return { login, plain, error: errorMessage(error) };
      }
    }),
  );
}

/** `readLogins`, less each login the last `usage` found closed until its reset (`login-state.ts`). */
export const readNotClosed: typeof readLogins = (wanted, env) =>
  readLogins(notClosed(wanted, keptReadings(historyFile()), Date.now()), env);

/** The logins of `readings` a run may move to, the week that resets soonest first: in `allowed`,
 *  not in `spent`, neither window used up or refused. A nearly spent week is taken first where it
 *  resets first, so each login's week is used before it resets, and a run that meets the limit
 *  waits it out or moves on (operator, 25 October; until then a week past 90% was left). */
export function room(
  readings: readonly Reading[],
  allowed: readonly string[],
  spent: ReadonlySet<string>,
): string[] {
  return readings
    .flatMap((reading) =>
      "error" in reading ||
      !allowed.includes(reading.login) ||
      spent.has(reading.login) ||
      !windowOpen(reading.sevenDay) ||
      !windowOpen(reading.fiveHour)
        ? []
        : [{ login: reading.login, reset: resetOf(reading.sevenDay.resetsAt) ?? Number.POSITIVE_INFINITY }],
    )
    .toSorted((one, other) => one.reset - other.reset)
    .map(({ login }) => login);
}

/** What `window` of `length` minutes holds at its reset at the pace it was used so far, or null where
 *  either is unread. */
function atReset(window: Window, length: number, now: number): number | null {
  const reset = resetOf(window.resetsAt);
  if (reset === null || window.pct === null) return null;
  const used = length - (reset - now) / 60_000;
  return used <= 0 ? window.pct : (window.pct * length) / used;
}

/**
 * What the five-hour window of `reading` holds at its reset once one more run goes on there beside
 * the `on` it carries, or null where it cannot be said: no reading, no share, or a share with no
 * reset to read it against. Each run on the login is taken to spend what the window's pace so far
 * shares out to it, so a login's own runs are what prices the one added. An idle login has no such
 * pace, and what its window holds came from runs that have left, so it reads the window's share and
 * `RUN_FIVE_HOUR` to its reset. A person's own session on a login is charged to its runs, as in
 * `perRunRate`, and a window minutes old reads high until the next look. The week's forecast cannot
 * answer this: the readings kept hold no five-hour share, and a run's rate is in % of a week.
 */
export function fiveHourWith(reading: Reading, on: number, now: number): number | null {
  if ("error" in reading) return null;
  const { fiveHour } = reading;
  const { pct } = fiveHour;
  const reset = resetOf(fiveHour.resetsAt);
  if (pct === null || (pct > 0 && reset === null)) return null;
  if (on > 0) return pct + (((atReset(fiveHour, FIVE_HOURS, now) ?? pct) - pct) * (on + 1)) / on;
  return pct + RUN_FIVE_HOUR * (reset === null ? FIVE_HOURS / 60 : Math.max(0, (reset - now) / HOUR));
}

/** When `window` of `length` minutes runs out at the pace it was used so far: it opened `length`
 *  minutes before its reset, so 40% in the first 2 of 7 days runs out 3 days on. */
function pace(window: Window, length: number, now: number): string {
  const reset = resetOf(window.resetsAt);
  if (reset === null || window.pct === null) return "";
  if (window.pct >= 100) return "spent";
  const left = (reset - now) / 60_000;
  const used = length - left;
  if (window.pct <= 0 || used <= 0) return "lasts";
  const mins = Math.round(((100 - window.pct) * used) / window.pct);
  return mins >= left
    ? `lasts, ~${String(Math.round(atReset(window, length, now) ?? window.pct))}% at reset`
    : `ends in ${spanOf(mins)} (${clock(now + mins * 60_000)})`;
}

function shown(window: Window, length: number, now: number, end?: End): string {
  const filled = window.pct === null ? null : Math.min(20, Math.round(window.pct / 5));
  const bar = filled === null ? "?".repeat(20) : "#".repeat(filled) + ".".repeat(20 - filled);
  const pct = window.pct === null ? "  ?" : `${String(Math.round(window.pct)).padStart(3)}%`;
  const reset = resetOf(window.resetsAt);
  const until =
    reset === null
      ? ""
      : `resets in ${spanOf(Math.max(0, Math.round((reset - now) / 60_000))).padEnd(6)} (${clock(reset)})`;
  const status = window.status !== undefined && window.status !== "allowed";
  const said = end === undefined || (window.pct ?? 0) >= 100 ? pace(window, length, now) : endWords(end, now);
  const tail = status ? `  ${said.padEnd(26)}  [${window.status}]` : `  ${said}`;
  return `[${bar}] ${pct}  ${until}${tail.trimEnd()}`;
}

/** The weeks the model reads now: those `weeks` read, and the other logins' from the last of `kept`
 *  where still in their window, so a reading of a few logins reads every login as the whole view does
 *  and a head line names the same end in either. */
export function weeksFor(weeks: readonly Week[], kept: readonly Snapshot[], now: number): Snapshot["weeks"] {
  const others = Object.entries(byTime(kept).at(-1)?.weeks ?? {});
  return {
    ...Object.fromEntries(others.filter(([, { reset }]) => reset > now)),
    ...Object.fromEntries(weeks.map(({ login, pct, reset }) => [login, { pct, reset }])),
  };
}

/** The share of one login's week a live run spends an hour, over `history`: each login's rise
 *  between two readings a quarter of an hour to 3 hours apart in one window, over the runs the
 *  earlier reading counted on it. A person's own session on a login is charged to its runs, so the
 *  rate errs high. Null below `LEAST_RUN_HOURS`. */
export function perRunRate(history: readonly Snapshot[]): number | null {
  const sorted = byTime(history);
  const spans = sorted.flatMap((then, at) => {
    const next = sorted[at + 1];
    const hours = next === undefined ? 0 : (next.at - then.at) / HOUR;
    if (next === undefined || hours < 0.25 || hours > 3) return [];
    return Object.entries(then.runs ?? {}).flatMap(([login, runs]) => {
      const [was, now] = [then.weeks[login], next.weeks[login]];
      return runs === 0 || was === undefined || now === undefined || !sameWindow(was, now)
        ? []
        : [{ used: now.pct - was.pct, runHours: runs * hours }];
    });
  });
  const runHours = spans.reduce((sum, span) => sum + span.runHours, 0);
  return runHours < LEAST_RUN_HOURS ? null : spans.reduce((sum, span) => sum + span.used, 0) / runHours;
}

/** What one of `on` live runs on `week` spends an hour of the clock: the measured rate, active
 *  `ACTIVE_SHARE` of the time, or before there is one the week's own pace shared over its runs, so
 *  70% in 4 days with two runs left on it reads about 0.36% a run an hour. Null with neither. */
export function perRunHour(week: Week, on: number, rate: number | null, now: number): number | null {
  if (rate !== null) return rate * ACTIVE_SHARE;
  return on > 0 ? weekPace(week, now) / on : null;
}

/** How many runs `week` carries for `RUN_HOURS`, or to its reset where that is sooner, each spending
 *  `perHour` of it an hour; null without a rate. */
export function fitOf(week: Week, perHour: number | null, now: number): number | null {
  if (perHour === null) return null;
  const need = perHour * Math.max(0, Math.min(RUN_HOURS, (week.reset - now) / HOUR));
  return need <= 0 ? Number.POSITIVE_INFINITY : Math.floor(Math.max(0, 100 - week.pct) / need);
}

/** A login's live runs out of the most it carries, the lower of its cap (`capOf`) and what its
 *  week fits (`fitOf`), and whether more run on it than its week fits. Until 22 October the most
 *  was the cap alone, and a login at 92% of its week read 0/2 with 11 hours of it left. */
export function carried(on: number, cap: string | null, fit: number | null): string {
  const fits = fit !== null && Number.isFinite(fit) ? fit : null;
  const most = [cap === null ? null : Number(cap), fits].filter((one): one is number => one !== null);
  const of = most.length === 0 ? "" : `/${String(Math.min(...most))}`;
  return `${String(on)}${of} active${fits !== null && on > fits ? " · oversubscribed" : ""}`;
}

/** The runs a process writes on this machine and on every host that answered, and the hosts that
 *  did not. Each host answers `active --here` with one JSON list; any other answer leaves it
 *  uncounted, since on 22 October a tree that predates the verb answered with nothing and exit 0,
 *  which as lines would have read as no run live. */
export async function liveEverywhere(
  mode: "prepared" | "configured" = "prepared",
): Promise<{ live: Live[]; unasked: string[] }> {
  const answers = (await asked(["active", "--here"], hostsOf(), mode)).map(({ host, lines }) => ({
    host: host.name,
    live: liveOf(host.name, lines),
  }));
  return {
    live: [...liveHere(), ...answers.flatMap(({ live }) => live ?? [])],
    unasked: answers.flatMap(({ host, live }) => (live === null ? [host] : [])),
  };
}

const uncounted = (hosts: readonly string[]) => `not counted on ${hosts.join(", ")}: no answer to \`active\``;

/** One line a login of the runs in `live`, each login `allowed` names first, then any other a run
 *  names and the runs that name none, and the hosts in `unasked` that went uncounted. */
export function activeLines(
  live: readonly Live[],
  allowed: readonly string[],
  unasked: readonly string[],
  env: Env = {},
): string[] {
  const named = [...new Set([...allowed, CODEX, ...live.flatMap(({ login }) => login ?? [])])];
  const lines = [...named, null].flatMap((login) => {
    const on = live.filter((run) => run.login === login).map(({ name, host }) => `${name} (${host})`);
    if (login === null && on.length === 0) return [];
    const head = login === null ? "no login" : login === CODEX ? CODEX : `login ${login}`;
    const cap = login === null ? null : capOf(env, login);
    const sub = login === null ? null : subOf(env, login);
    const count =
      cap === null
        ? `${String(on.length)} live`
        : login === CODEX
          ? `${String(on.length)} live, at most ${cap} a machine`
          : `${String(on.length)}/${cap} live`;
    return [
      `${head.padEnd(10)}${count}${sub === null ? "" : ` (${sub.sub})`}${on.length === 0 ? "" : `: ${on.join(", ")}`}`,
    ];
  });
  return unasked.length === 0 ? lines : [...lines, uncounted(unasked)];
}

/** `bun run runs active [--here]`: the live runs on each login, on every host; with `--here` this
 *  machine's alone, as one JSON list, which is what each host is asked. */
export async function active(args: readonly string[]): Promise<void> {
  const { values } = parseArgs({
    args: [...args],
    options: {
      here: { type: "boolean", default: false },
      login: { type: "string" },
    },
  });
  if (values.here) {
    console.log(
      capturedJsonStringify(
        values.login === undefined ? liveHere() : loginsIn(runtimeProcess.env).includes(values.login),
      ),
    );
    return;
  }
  const { live, unasked } = await liveEverywhere();
  console.log(activeLines(live, allowedLogins(runtimeProcess.env), unasked, runtimeProcess.env).join("\n"));
}

const FLAG = { type: "boolean", default: false } as const;

/** `bun run runs usage`. */
export async function logins(args: readonly string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: [...args],
    allowPositionals: true,
    options: { json: FLAG, open: FLAG, closed: FLAG },
  });
  // A machine with one Claude login holds the plain credential: until 5 November `usage` refused it.
  const numbered = loginsIn(runtimeProcess.env);
  const held = numbered.length === 0 && plainOnly(runtimeProcess.env) ? [PLAIN] : numbered;
  if (held.length === 0) {
    throw new Error(
      `neither ${TOKEN} nor ${TOKEN}<N> is set: run the verb under bun --env-file=<the file that holds them>`,
    );
  }
  // Every host is asked for its live runs while the logins are read.
  const [readings, counted] = await Promise.all([
    readLogins(positionals.length > 0 ? positionals : held, runtimeProcess.env),
    values.json ? null : liveEverywhere(),
  ]);
  const now = Date.now();
  // A run on the plain login names no login.
  const onEach = (login: string) => counted?.live.filter((run) => (run.login ?? PLAIN) === login).length ?? 0;
  const allowed = allowedLogins(runtimeProcess.env);
  const weeks = readings.flatMap((reading): Week[] => {
    const reset = "error" in reading ? null : resetOf(reading.sevenDay.resetsAt);
    const spendable = allowed.length === 0 || allowed.includes(reading.login) || onEach(reading.login) > 0;
    return "error" in reading || reading.sevenDay.pct === null || reset === null
      ? []
      : [{ login: reading.login, pct: reading.sevenDay.pct, reset, room: spendable }];
  });
  const history = historyFile();
  const kept = keptReadings(history);
  const rate = perRunRate(kept.filter(({ at }) => now - at < RATE_MS));
  // The pool's lines and the history are the whole view's; a reading of a few logins writes no history.
  const whole = !values.json && positionals.length === 0 && weeks.length > 0;
  const read = weeksFor(weeks, whole ? [] : kept, now);
  const snapshot: Snapshot = {
    at: now,
    weeks: read,
    closed: closedResets(readings),
    ...keysIf(counted?.unasked.length === 0, () => ({
      runs: Object.fromEntries(Object.keys(read).map((login) => [login, onEach(login)])),
    })),
  };
  const recorded = [...kept.filter(({ at }) => now - at < KEPT_MS), snapshot];
  const forecast =
    values.json || weeks.length === 0
      ? null
      : modelLines(weeks, recorded, assess(recorded, now, perRunRate), now, rate);
  const listed = listedBy(readings, values);
  if (values.json) console.log(capturedJsonStringify(listed, null, 2));
  for (const reading of values.json ? [] : listed) {
    const week = weeks.find(({ login }) => login === reading.login);
    const fit =
      week === undefined ? null : fitOf(week, perRunHour(week, onEach(reading.login), rate, now), now);
    const runsOn =
      counted === null
        ? ""
        : ` · ${carried(onEach(reading.login), capOf(runtimeProcess.env, reading.login), fit)}`;
    const sub = subOf(runtimeProcess.env, reading.login);
    const own = reading.login === PLAIN ? `plain ${TOKEN}` : `login ${reading.login}`;
    const state = stateWords(reading, allowed, clock);
    const head = `${own}${sub === null ? "" : ` · ${sub.sub}`}${state}${runsOn}${reading.plain && reading.login !== PLAIN ? `  (= plain ${TOKEN})` : ""}`;
    console.log(
      "error" in reading
        ? `${head}\n  ${reading.error}`
        : `${head}\n  5h    ${shown(reading.fiveHour, 5 * 60, now)}\n  week  ${shown(reading.sevenDay, 7 * 1440, now, forecast?.ends?.get(reading.login))}${reading.notes.length > 0 ? `\n  ${reading.notes.join(" · ")}` : ""}`,
    );
  }
  const subs = held.flatMap((login) => subOf(runtimeProcess.env, login) ?? []);
  if (counted !== null && !values.json && subs.length > 0) {
    const kinds = Object.entries(SUBS.claude).flatMap(([sub, runs]) => {
      const many = subs.filter((one) => one.sub === sub).length;
      return many === 0 ? [] : [`${String(many)} ${sub} (${runs} runs each)`];
    });
    const most = held.reduce((sum, login) => sum + Number(capOf(runtimeProcess.env, login) ?? 0), 0);
    const on = held.reduce((sum, login) => sum + onEach(login), 0);
    console.log(`subs  ${kinds.join(", ")}: ${String(on)}/${String(most)} live runs across the logins`);
  }
  if (counted !== null && !values.json) {
    const codex = counted.live.filter((run) => run.login === CODEX);
    console.log(activeLines(codex, [CODEX], [], runtimeProcess.env).join("\n"));
  }
  if ((counted?.unasked.length ?? 0) > 0) console.log(uncounted(counted?.unasked ?? []));
  if (!whole) return;
  console.log(poolLine(weeks, held.length - weeks.length, now));
  console.log(
    rate === null
      ? `  a run       no measured rate yet (under ${String(LEAST_RUN_HOURS)} run-hours): each login's week pace over its live runs`
      : `  a run       ~${rate.toFixed(2)}% of a login's week an hour, active ${String(Math.round(ACTIVE_SHARE * 24))} of 24h: the most each login carries for ${String(RUN_HOURS)}h`,
  );
  console.log(forecast?.lines.join("\n"));
  mkdirSync(dirname(history), { recursive: true });
  const lines = recorded.map((one) => capturedJsonStringify(one));
  writeFileSync(history, `${lines.join("\n")}\n`);
}
