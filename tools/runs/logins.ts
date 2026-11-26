/**
 * How much of each login's five-hour and weekly window is used, when each runs out at its pace, and
 * when the pool runs out. Usage comes from GET /api/oauth/usage (after steipete/CodexBar), or, for a
 * `claude setup-token` token that lacks the `user:profile` scope, from the
 * `anthropic-ratelimit-unified-*` headers of a one-token Haiku call. `active` asks no provider.
 *
 *   bun --env-file=<file> run runs usage [N ...] [--json] [--open] [--closed]
 *   bun run runs active [--here [--login N]]
 */
import { openingOf, type SEATS } from "#src/campaign/opening.ts";
import type { LogEvent } from "#src/kernel/log.ts";
import { HOUR_MS } from "#src/meta/clock.ts";
import { capturedJsonParse, capturedJsonStringify } from "#src/meta/json-runtime.ts";
import { asRecord, isNumber, isString, type JsonValue } from "#src/meta/json-shape.ts";
import { keysIf } from "#src/meta/optional-key.ts";
import { parseArgs, runtimeProcess } from "#src/meta/process.ts";
import { errorMessage } from "#src/meta/runtime-values.ts";
import { runSync, zeroExitText } from "#src/meta/subprocess.ts";
import { hasText, textOr } from "#src/meta/text.ts";
import { recordedSetting } from "../campaign/setting.ts";
import { asked } from "./hosts.ts";
import { hostsOf, isLocalOnly } from "./host-config.ts";
import { CODEX, countedAgainst, type Live, liveHere, liveOf, seatFlagsOf } from "./live.ts";
import { remember } from "./pulse-readers.ts";
import { archived, isCampaign } from "./registry.ts";
import {
  closedResets,
  historyFile,
  cachedUsageHistory,
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
  readonly fiveHour: Window | null;
  readonly sevenDay: Window;
  readonly notes: readonly string[];
}

export type Reading = { readonly login: string; readonly plain: boolean } & (Read | Failed);

interface Failed {
  readonly error: string;
}

export type Env = Readonly<Record<string, string | undefined>>;

export const TOKEN = "CLAUDE_CODE_OAUTH_TOKEN";
export const NUMBERED = new RegExp(`^${TOKEN}(\\d+)$`);
const PLAIN = "";
const BASE = "https://api.anthropic.com";
const BETA = "oauth-2025-04-20";
const TIMEOUT_MS = 30_000;
const HISTORY_RETENTION_MS = 28 * 24 * HOUR_MS;
const RATE_MS = 8 * 24 * HOUR_MS;
const ACTIVE_SHARE = 16 / 24;
/** The hours a run is read to live. Reading each run to live until its login's reset would call a
 *  login with days to go oversubscribed while its runs need a fraction of what is left. */
const RUN_HOURS = 12;
const LEAST_RUN_HOURS = 6;
const FIVE_HOURS = 5 * 60;
/** The upper end of what is observed, used only where a login's own pace says nothing; the pace
 *  varies severalfold by login. */
const RUN_FIVE_HOUR = 15;
const NOTED = [
  ["seven_day_opus", "opus"],
  ["seven_day_sonnet", "sonnet"],
  ["seven_day_oauth_apps", "oauth apps"],
  ["seven_day_routines", "routines"],
] as const;

const SUBS: Readonly<Record<"claude" | "codex", Readonly<Record<string, string>>>> = {
  claude: { max: "1", ultra: "2" },
  codex: { pro100: "2", pro200: "4" },
};

const FLAG = { type: "boolean", default: false } as const;

/** A key left empty holds none, since a copied `.env.example` names `CLAUDE_CODE_OAUTH_TOKEN2=`. */
function loginsIn(env: Env): string[] {
  return Object.entries(env)
    .flatMap(([key, value]) => (hasText(value) ? (NUMBERED.exec(key)?.[1] ?? []) : []))
    .toSorted((one, other) => Number(one) - Number(other));
}

export function tokenOf(env: Env, login: string): string | undefined {
  const token = env[`${TOKEN}${login}`];
  return hasText(token) ? token : undefined;
}

export function noLogin(env: Env, allowed: readonly string[]): string | null {
  if (allowed.some((login) => tokenOf(env, login) !== undefined)) return null;
  const keys = allowed.length === 0 ? TOKEN : allowed.map((login) => `${TOKEN}${login}`).join(" or ");
  return `no login here: set ${keys} in the process environment, or in a file named with bun --env-file=<file>`;
}

export function allowedLogins(env: Env): string[] {
  const named = env.ANA_LOGINS?.split(",")
    .map((login) => login.trim())
    .filter((login) => login !== "");
  return named ?? loginsIn(env);
}

export function plainOnly(env: Env): boolean {
  return allowedLogins(env).length === 0 && hasText(env[TOKEN]);
}

type SeatModels = Readonly<Record<(typeof SEATS)[number] | "solver", string | undefined>>;

export function seatModels(events: readonly LogEvent[], flags: readonly string[]): SeatModels {
  const values = seatFlagsOf(flags);
  const opening = openingOf(events);
  return {
    builder: values.builder ?? opening?.seats.builder?.model,
    examiner: values.examiner ?? opening?.seats.examiner?.model,
    reviewer: values.reviewer ?? opening?.seats.reviewer?.model,
    solver: values.solver ?? opening?.solver?.model ?? recordedSetting(events)?.solver?.model,
  };
}

export function billsLogin(events: readonly LogEvent[], flags: readonly string[]): boolean {
  return Object.values(seatModels(events, flags)).some(
    (model) => isString(model) && model.startsWith("claude/"),
  );
}

function subOf(env: Env, login: string): { readonly sub: string; readonly runs: string } | null {
  const offered = SUBS[login === CODEX ? "codex" : "claude"];
  const entries = (env.ANA_LOGIN_SUBS ?? "").split(",").map((entry) => entry.trim().split(":"));
  const sub = entries.find(([who]) => who === login)?.[1];
  const runs = sub === undefined || !Object.hasOwn(offered, sub) ? undefined : offered[sub];
  return sub === undefined || runs === undefined ? null : { sub, runs };
}

export function capOf(env: Env, login: string): string | null {
  const entries = (env.ANA_LOGIN_RUNS ?? "").split(",").map((entry) => entry.trim().split(":"));
  const own =
    entries.find(([who, most]) => who === login && most !== undefined)?.[1] ?? subOf(env, login)?.runs;
  if (login === CODEX) return own ?? "1";
  return own ?? entries.find(([most, rest]) => most !== "" && rest === undefined)?.[0] ?? null;
}

export function atCap(env: Env, allowed: readonly string[], live: readonly Live[]): Set<string> {
  return new Set(
    allowed.filter((login) => {
      const cap = login === CODEX ? null : capOf(env, login);
      return cap !== null && live.filter((run) => run.login === login).length >= Number(cap);
    }),
  );
}

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
    ? `${host} carries ${String(on)} live ${CODEX} run(s), at most ${cap ?? "1"} per host (ANA_LOGIN_RUNS): pass another --host or omit it`
    : null;
}

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

export async function roomToStart(
  payer: string | undefined,
  host: string,
  name: string,
  stands = "nothing was stopped or started",
): Promise<void> {
  if (payer === undefined) return;
  const counted = asGathered(await liveEverywhere("configured"));
  const refused = startRefusal(runtimeProcess.env, payer, host, counted, name);
  if (refused !== null) throw new Error(`${name}: ${refused}; ${stands}`);
}

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

function planned(reading: Reading, env: Env): Reading {
  const five = "error" in reading ? null : reading.fiveHour;
  const silent = five?.pct === null && five.resetsAt === null && five.status === undefined;
  return silent && subOf(env, reading.login)?.sub === "ultra" ? { ...reading, fiveHour: null } : reading;
}

export async function readLogins(wanted: readonly string[], env: Env): Promise<Reading[]> {
  const version = zeroExitText(runSync(["claude", "--version"]))?.split(/\s+/)[0];
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
        if (!("error" in first)) return planned({ login, plain, ...first }, env);
        const second = await viaRateLimitHeaders(token, agent);
        if (!("error" in second)) return planned({ login, plain, ...second }, env);
        return { login, plain, error: `${first.error}; ${second.error}` };
      } catch (error) {
        return { login, plain, error: errorMessage(error) };
      }
    }),
  );
}

export const readNotClosed: typeof readLogins = (wanted, env) =>
  readLogins(notClosed(wanted, cachedUsageHistory(historyFile()), Date.now()), env);

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
      (reading.fiveHour !== null && !windowOpen(reading.fiveHour))
        ? []
        : [{ login: reading.login, reset: resetOf(reading.sevenDay.resetsAt) ?? Number.POSITIVE_INFINITY }],
    )
    .toSorted((one, other) => one.reset - other.reset)
    .map(({ login }) => login);
}

function atReset(window: Window, length: number, now: number): number | null {
  const reset = resetOf(window.resetsAt);
  if (reset === null || window.pct === null) return null;
  const used = length - (reset - now) / 60_000;
  return used <= 0 ? window.pct : (window.pct * length) / used;
}

export function fiveHourWith(reading: Reading, on: number, now: number): number | null {
  if ("error" in reading) return null;
  const { fiveHour } = reading;
  if (fiveHour === null) return 0;
  const { pct } = fiveHour;
  const reset = resetOf(fiveHour.resetsAt);
  if (pct === null || (pct > 0 && reset === null)) return null;
  if (on > 0) return pct + (((atReset(fiveHour, FIVE_HOURS, now) ?? pct) - pct) * (on + 1)) / on;
  return pct + RUN_FIVE_HOUR * (reset === null ? FIVE_HOURS / 60 : Math.max(0, (reset - now) / HOUR_MS));
}

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

function weeksFor(weeks: readonly Week[], kept: readonly Snapshot[], now: number): Snapshot["weeks"] {
  const others = Object.entries(byTime(kept).at(-1)?.weeks ?? {});
  return {
    ...Object.fromEntries(others.filter(([, { reset }]) => reset > now)),
    ...Object.fromEntries(weeks.map(({ login, pct, reset }) => [login, { pct, reset }])),
  };
}

function perRunRate(history: readonly Snapshot[]): number | null {
  const sorted = byTime(history);
  const spans = sorted.flatMap((then, at) => {
    const next = sorted[at + 1];
    const hours = next === undefined ? 0 : (next.at - then.at) / HOUR_MS;
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

function perRunHour(week: Week, on: number, rate: number | null, now: number): number | null {
  if (rate !== null) return rate * ACTIVE_SHARE;
  return on > 0 ? weekPace(week, now) / on : null;
}

function fitOf(week: Week, perHour: number | null, now: number): number | null {
  if (perHour === null) return null;
  const need = perHour * Math.max(0, Math.min(RUN_HOURS, (week.reset - now) / HOUR_MS));
  return need <= 0 ? Number.POSITIVE_INFINITY : Math.floor(Math.max(0, 100 - week.pct) / need);
}

function carried(on: number, cap: string | null, fit: number | null): string {
  const fits = fit !== null && Number.isFinite(fit) ? fit : null;
  const most = [cap === null ? null : Number(cap), fits].filter((one): one is number => one !== null);
  const of = most.length === 0 ? "" : `/${String(Math.min(...most))}`;
  const week =
    fits !== null && cap !== null && fits < Number(cap) ? `, capped by weekly quota (plan cap: ${cap})` : "";
  return `${String(on)}${of} active${week}${fits !== null && on > fits ? " · oversubscribed" : ""}`;
}

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

/** A count with each unasked host counted as the gather last copied its campaigns (`lifeOf`), so
 *  one silent peer does not refuse every start; one with no copy stays unasked. A start reads it;
 *  placement and `sync`, which act on the host itself, do not. */
export function asGathered({ live, unasked }: { live: Live[]; unasked: string[] }, copies = archived()) {
  const gathered = unasked.map((host) => ({
    host,
    own: copies.filter((run) => run.archived === host && isCampaign(run)),
  }));
  return {
    live: [...live, ...gathered.flatMap(({ host, own }) => liveHere(host, [], own))],
    unasked: gathered.flatMap(({ host, own }) => (own.length === 0 ? [host] : [])),
  };
}

const uncounted = (hosts: readonly string[]) => `not counted on ${hosts.join(", ")}: no answer to \`active\``;

function activeLines(
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
          ? `${String(on.length)} live, at most ${cap} per host`
          : `${String(on.length)}/${cap} live`;
    return [
      `${head.padEnd(10)}${count}${sub === null ? "" : ` (${sub.sub})`}${on.length === 0 ? "" : `: ${on.join(", ")}`}`,
    ];
  });
  return unasked.length === 0 ? lines : [...lines, uncounted(unasked)];
}

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

export async function logins(args: readonly string[], readUsage = readLogins): Promise<void> {
  const { values, positionals } = parseArgs({
    args: [...args],
    allowPositionals: true,
    options: { json: FLAG, open: FLAG, closed: FLAG },
  });
  const numbered = loginsIn(runtimeProcess.env);
  const held = numbered.length === 0 && plainOnly(runtimeProcess.env) ? [PLAIN] : numbered;
  if (held.length === 0) {
    throw new Error(
      `neither ${TOKEN} nor ${TOKEN}<N> is set: add ${TOKEN} to .env (\`bun run setup --token\`) or pass bun --env-file=<file>`,
    );
  }
  const whole = !values.json && positionals.length === 0;
  const forwarded = isLocalOnly();
  const [readings, counted, refreshed] = await Promise.all([
    readUsage(positionals.length > 0 ? positionals : held, runtimeProcess.env),
    values.json ? null : liveEverywhere(),
    whole ? asked(["usage"]) : null,
  ]);
  const now = Date.now();
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
  const prior = cachedUsageHistory(history);
  const rate = perRunRate(prior.filter(({ at }) => now - at < RATE_MS));
  const complete = whole && weeks.length > 0;
  const read = weeksFor(weeks, complete ? [] : prior, now);
  const snapshot: Snapshot = {
    at: now,
    weeks: read,
    closed: closedResets(readings),
    ...keysIf(!forwarded && counted?.unasked.length === 0, () => ({
      runs: Object.fromEntries(Object.keys(read).map((login) => [login, onEach(login)])),
    })),
  };
  const recorded = [...prior.filter(({ at }) => now - at < HISTORY_RETENTION_MS), snapshot];
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
        : `${head}${reading.fiveHour === null ? "" : `\n  5h    ${shown(reading.fiveHour, 5 * 60, now)}`}\n  week  ${shown(reading.sevenDay, 7 * 1440, now, forecast?.ends?.get(reading.login))}${reading.notes.length > 0 ? `\n  ${reading.notes.join(" · ")}` : ""}`,
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
  const stale = (refreshed ?? []).flatMap(({ host, lines }) => (lines === null ? [host.name] : []));
  if (stale.length > 0) {
    console.log(`login cache not refreshed on ${stale.join(", ")}: no answer to \`usage\``);
  }
  if (forwarded && whole && !complete) {
    throw new Error("no weekly usage read, so the login cache was not refreshed");
  }
  if (!complete) return;
  console.log(poolLine(weeks, held.length - weeks.length, now));
  console.log(
    rate === null
      ? `  a run       no measured rate yet (under ${String(LEAST_RUN_HOURS)} run-hours): each login's week pace over its live runs`
      : `  a run       ~${rate.toFixed(2)}% of a login's week an hour, active ${String(Math.round(ACTIVE_SHARE * 24))} of 24h: the most each login carries for ${String(RUN_HOURS)}h`,
  );
  console.log(forecast?.lines.join("\n"));
  remember(history, `${recorded.map((one) => capturedJsonStringify(one)).join("\n")}\n`);
}
