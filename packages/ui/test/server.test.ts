import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "../../../src/meta/filesystem.ts";
import { tmpdir } from "../../../src/meta/os.ts";
import { join } from "../../../src/meta/path.ts";
import { parseJsonAs } from "../../../src/meta/json-runtime.ts";
import {
  type AnswerOf,
  type ApiError,
  type Endpoint,
  PARAMETERS,
  type Query,
  TOKEN_HEADER,
} from "../src/models.ts";
import { handleApiRequest, type ServerOptions } from "../src/server/api.ts";
import { answersOver, type Fixture, writeFixtureCampaign } from "./fixture-campaign.ts";

/** One query of every endpoint. */
type Samples = { readonly [Name in Endpoint]: Query<Name> };

const TOKEN = "fake-token-of-this-test";
const scratch = realpathSync(mkdtempSync(join(tmpdir(), "ana-ui-server-")));
let fixture: Fixture;
let options: ServerOptions;

beforeAll(() => {
  fixture = writeFixtureCampaign(join(scratch, "main"));
  options = { repo: fixture.root, trees: "directory", token: TOKEN, examSide: false };
});
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/** A GET of `path` as a browser on the loopback sends it, with the token unless told otherwise. */
function get(
  path: string,
  served: ServerOptions = options,
  headers: Readonly<Record<string, string>> = { host: "127.0.0.1:5173", [TOKEN_HEADER]: TOKEN },
): Response {
  return handleApiRequest(served, new Request(`http://127.0.0.1:5173${path}`, { headers }));
}

/** The fixture's main campaign and one id of each kind of detail in it, read from its own answers. */
function sampleQueries() {
  const answers = answersOver(fixture.root, "exam");
  const key = fixture.key;
  const reading = answers.campaign(key);
  const comparison = reading.comparisons.at(-1);
  if (comparison === undefined) throw new Error("the fixture holds no comparison");
  const detail = answers.move(key, String(comparison.move));
  const solve = detail.kind === "comparison" ? (detail.tasks[0]?.fresh[0]?.id ?? "") : "";
  const digests = reading.harnesses.map((card) => card.digest ?? "");
  const [first = "", last = ""] = [digests[0], digests.at(-1)];
  const grid = answers.tasks(key);
  return {
    campaigns: {},
    campaign: { key },
    move: { key, move: String(comparison.move) },
    solve: { key, id: solve },
    tasks: { key },
    task: { key, id: grid.rows[4]?.version ?? "" },
    log: { key, offset: "100", kind: "solve.finished" },
    event: { key, index: "3" },
    harness: { key, digest: last },
    "harness-file": { key, digest: last, path: "agent/BUILT_AGENTS.md" },
    "harness-diff": { key, a: first, b: last },
  } satisfies Samples;
}

function pathOf<Name extends Endpoint>(endpoint: Name, query: Query<Name>): string {
  const values: Readonly<Record<string, string | undefined>> = query;
  const { required, optional } = PARAMETERS[endpoint];
  const search = new URLSearchParams(
    [...required, ...optional].flatMap((name) => {
      const value = values[name];
      return value === undefined ? [] : [[name, value]];
    }),
  );
  return `/api/${endpoint}?${search.toString()}`;
}

describe("the API's refusals", () => {
  test("refuses a request with no token or another token, before reading anything", async () => {
    for (const headers of [
      { host: "127.0.0.1:5173" },
      { host: "127.0.0.1:5173", [TOKEN_HEADER]: "fake-token-that-is-wrong" },
    ]) {
      const response = get("/api/campaigns", options, headers);
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ refused: "token" });
    }
  });

  test("refuses a Host that is not the loopback, whatever the token, and answers the loopback names", async () => {
    for (const host of ["evil.example", "127.0.0.1.evil.example:5173", "192.168.1.4:5173"]) {
      const response = get("/api/campaigns", options, { host, [TOKEN_HEADER]: TOKEN });
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ refused: "host" });
    }
    for (const host of ["localhost:5173", "127.0.0.1", "[::1]:5173"]) {
      expect(get("/api/campaigns", options, { host, [TOKEN_HEADER]: TOKEN }).status).toBe(200);
    }
  });

  test("refuses the exam-side endpoint without --exam-side and answers it with the flag", async () => {
    const { event } = sampleQueries();
    const refused = get(pathOf("event", event));
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ refused: "exam-side" });
    expect(get(pathOf("event", event), { ...options, examSide: true }).status).toBe(200);
  });
});

describe("the router", () => {
  test("opens a move by its place, refuses one named by an id two moves share, naming both places, and a place no move starts at", async () => {
    const { moves } = answersOver(fixture.root, "default").campaign(fixture.key);
    const place = (step: string): string =>
      String(moves.find((move) => move.step === step && move.id === "b-1")?.index ?? "none");
    for (const [step, kind] of [
      ["builder", "session"],
      ["comparison", "comparison"],
    ] as const) {
      const opened = get(pathOf("move", { key: fixture.key, move: place(step) }));
      expect(parseJsonAs<AnswerOf<"move">>(await opened.text()).kind).toBe(kind);
    }
    const refused = get(pathOf("move", { key: fixture.key, move: "b-1" }));
    expect(refused.status).toBe(400);
    expect(parseJsonAs<ApiError>(await refused.text()).error).toContain(
      `b-1 names 2 moves, the builder at ${place("builder")} and the comparison at ${place("comparison")}`,
    );
    expect(get(pathOf("move", { key: fixture.key, move: "1" })).status).toBe(404);
  });
});
