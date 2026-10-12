import { expect, test } from "bun:test";
import { changedRoute, type Route, routeOf, searchOf } from "../src/route.ts";

const FULL: Route = {
  project: "Exact integer arithmetic: a prompt with spaces & signs",
  campaign: "anabasis-arith/arith",
  pane: "moves",
  move: 418,
  solve: "g5-expr-05-150",
  task: "3f2a",
  harness: "f8140c25",
  file: "agent/BUILT_AGENTS.md",
  diff: "da806c2c",
  event: 42,
  token: "a1b2c3",
};

test("a route survives its URL, every field and the bare page alike, the project written only where no campaign names it", () => {
  expect(routeOf(searchOf(FULL))).toEqual({ ...FULL, project: null });
  expect(searchOf(FULL)).not.toContain("project=");
  const unchosen = { ...FULL, campaign: null };
  expect(routeOf(searchOf(unchosen))).toEqual(unchosen);
  const bare = routeOf("");
  expect(bare.pane).toBe("campaign");
  expect(searchOf(bare)).toBe("");
  expect(routeOf(searchOf({ ...bare, token: "t" }))).toEqual({ ...bare, token: "t" });
});

test("an unknown pane reads as the Campaign pane, and a move or an event that is no place in the log as none", () => {
  expect(routeOf("?pane=forge&event=-3").pane).toBe("campaign");
  expect(routeOf("?pane=forge&event=-3").event).toBeNull();
  expect(routeOf("?event=1.5").event).toBeNull();
  // A move is named by its place: a round's Builder session and comparison share their id.
  expect(routeOf("?move=b-1").move).toBeNull();
  expect(routeOf("?move=57").move).toBe(57);
  expect(searchOf(routeOf("?pane=campaign"))).toBe("");
});

test("a new campaign clears every selection inside it, and a new project the campaign too", () => {
  const campaign = changedRoute(FULL, { campaign: "anabasis/arith" });
  expect(campaign).toEqual({
    ...FULL,
    campaign: "anabasis/arith",
    move: null,
    solve: null,
    task: null,
    harness: null,
    file: null,
    diff: null,
    event: null,
  });
  const project = changedRoute(FULL, { project: "another" });
  expect([project.campaign, project.move, project.pane, project.token]).toEqual([
    null,
    null,
    "moves",
    "a1b2c3",
  ]);
  expect(changedRoute(FULL, { campaign: FULL.campaign })).toEqual(FULL);
});

test("a change of pane clears the move, the solve and the task and closes the inspector, unless it names them", () => {
  const cleared = { move: null, solve: null, task: null, file: null, diff: null, event: null };
  expect(changedRoute(FULL, { pane: "tasks" })).toEqual({ ...FULL, pane: "tasks", ...cleared });
  expect(changedRoute(FULL, { pane: "log", event: 7 })).toEqual({
    ...FULL,
    pane: "log",
    ...cleared,
    event: 7,
  });
  // A link into another pane names what it opens there, and keeps the harness of the Campaign pane.
  expect(changedRoute(FULL, { pane: "tasks", task: "9a1c" })).toEqual({
    ...FULL,
    pane: "tasks",
    ...cleared,
    task: "9a1c",
  });
  expect(changedRoute(FULL, { pane: "moves", solve: null })).toEqual({ ...FULL, solve: null });
});

test("a project read off the link's own campaign keeps every selection the link named", () => {
  const linked = { ...FULL, project: null };
  // What the shell writes back for a link that names a campaign and a move but no project.
  expect(changedRoute(linked, { project: FULL.project, campaign: FULL.campaign })).toEqual(FULL);
  expect(routeOf(searchOf(changedRoute(linked, { project: FULL.project, campaign: FULL.campaign })))).toEqual(
    linked,
  );
  // A project chosen in the picker is a change of project, and clears the campaign with the rest.
  expect(changedRoute(FULL, { project: "another" }).move).toBeNull();
  expect(changedRoute(linked, { project: "another", campaign: "another/arith" }).move).toBeNull();
});
