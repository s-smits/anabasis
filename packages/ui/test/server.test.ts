import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "../../../src/meta/filesystem.ts";
import { tmpdir } from "../../../src/meta/os.ts";
import { join } from "../../../src/meta/path.ts";
import { parseJsonAs } from "../../../src/meta/json-runtime.ts";
import { type AnswerOf, type ApiError, type Endpoint, type Query, TOKEN_HEADER } from "../src/models.ts";
import { handleApiRequest, type ServerOptions } from "../src/server/api.ts";
import { answersOver, type Fixture, writeFixtureCampaign } from "./fixture-campaign.ts";

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
): Promise<Response> {
  return handleApiRequest(served, new Request(`http://127.0.0.1:5173${path}`, { headers }));
}

function pathOf<Name extends Endpoint>(endpoint: Name, query: Query<Name>): string {
  const values: Readonly<Record<string, string | undefined>> = query;
  const search = new URLSearchParams(
    Object.entries(values).flatMap(([name, value]) => (value === undefined ? [] : [[name, value]])),
  );
  return `/api/${endpoint}?${search.toString()}`;
}

describe("the API's refusals", () => {
  test("refuses a request with no token or another token, before reading anything", async () => {
    for (const headers of [
      { host: "127.0.0.1:5173" },
      { host: "127.0.0.1:5173", [TOKEN_HEADER]: "fake-token-that-is-wrong" },
    ]) {
      const response = await get("/api/campaigns", options, headers);
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ refused: "token" });
    }
  });

  test("refuses a Host that is not the loopback, whatever the token, and answers the loopback names", async () => {
    for (const host of ["evil.example", "127.0.0.1.evil.example:5173", "192.168.1.4:5173"]) {
      const response = await get("/api/campaigns", options, { host, [TOKEN_HEADER]: TOKEN });
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ refused: "host" });
    }
    for (const host of ["localhost:5173", "127.0.0.1", "[::1]:5173"]) {
      expect((await get("/api/campaigns", options, { host, [TOKEN_HEADER]: TOKEN })).status).toBe(200);
    }
  });

  test("refuses the exam-side endpoint without --exam-side and answers it with the flag", async () => {
    const event = { key: fixture.key, index: "3" };
    const refused = await get(pathOf("event", event));
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ refused: "exam-side" });
    expect((await get(pathOf("event", event), { ...options, examSide: true })).status).toBe(200);
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
      const opened = await get(pathOf("move", { key: fixture.key, move: place(step) }));
      expect(parseJsonAs<AnswerOf<"move">>(await opened.text()).kind).toBe(kind);
    }
    const refused = await get(pathOf("move", { key: fixture.key, move: "b-1" }));
    expect(refused.status).toBe(400);
    const error = parseJsonAs<ApiError>(await refused.text()).error;
    for (const fact of [
      "b-1",
      "2 moves",
      `builder at ${place("builder")}`,
      `comparison at ${place("comparison")}`,
    ]) {
      expect(error).toContain(fact);
    }
    expect((await get(pathOf("move", { key: fixture.key, move: "1" }))).status).toBe(404);
  });
});
