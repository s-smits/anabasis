import { describe, expect, it } from "bun:test";
import {
  checkPlaces,
  fleetPlaces,
  namedPlaces,
  type Place,
  placeEnv,
  spread,
} from "../tools/runs/host-config.ts";

const CHECKS = [undefined, 1, 2, 3] as const;
const lists = (length: number): (number | undefined)[][] =>
  length === 0 ? [[]] : lists(length - 1).flatMap((list) => CHECKS.map((checks) => [...list, checks]));

function dealtInTurn(caps: readonly number[], slots: readonly number[], jobs: number | undefined): boolean {
  const total = Math.min(
    jobs ?? Infinity,
    caps.reduce((sum, cap) => sum + cap, 0),
  );
  if (slots.reduce((sum, slot) => sum + slot, 0) !== total) return false;
  return slots.every(
    (slot, i) =>
      slot <= (caps[i] ?? 0) &&
      slots.every((other, j) =>
        j <= i ? true : slot >= Math.min(caps[i] ?? 0, other) && other >= Math.min(caps[j] ?? 0, slot - 1),
      ),
  );
}

describe("where check tasks run", () => {
  it("deals every host list's slots in turn, or keeps one place where ANA_CHECK_HOST names one, no host is listed or a peer sent the verb", () => {
    const saved = { hosts: Bun.env.ANA_HOSTS, check: Bun.env.ANA_CHECK_HOST, hop: Bun.env.ANA_HOP };
    const set = (key: string, value: string | undefined) => {
      if (value === undefined) delete Bun.env[key];
      else Bun.env[key] = value;
    };
    const hostLists = [0, 1, 2, 3]
      .flatMap(lists)
      .map((caps) =>
        caps.map((checks, i) => ({ name: `h${String(i)}`, ssh: "s", tree: "/t", bun: "bun", checks })),
      );
    const cases = hostLists.flatMap((hosts) =>
      [undefined, "", "  ", "here", "auto", "all", "h0"].flatMap((check) =>
        [undefined, "1"].flatMap((hop) =>
          [undefined, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((jobs) => ({ hosts, check, hop, jobs })),
        ),
      ),
    );
    let dealt = 0;
    try {
      for (const { hosts, check, hop, jobs } of cases) {
        set("ANA_HOSTS", JSON.stringify(hosts));
        set("ANA_CHECK_HOST", check);
        set("ANA_HOP", hop);
        const places = fleetPlaces("/nowhere", jobs);
        expect(checkPlaces("/nowhere", jobs)).toStrictEqual(
          (check?.trim() ?? "") === "" ? places : [{ slots: jobs ?? 1 }],
        );
        if (hop === "1" || hosts.length === 0) {
          expect(places).toStrictEqual([{ slots: jobs ?? 1 }]);
          continue;
        }
        dealt += 1;
        const slots = hosts.map(({ name }) => places.find(({ remote }) => remote === name)?.slots ?? 0);
        expect(
          dealtInTurn(
            hosts.map(({ checks }) => checks ?? 2),
            slots,
            jobs,
          ),
        ).toBe(true);
        expect(places.map(({ remote }) => remote)).toStrictEqual(
          hosts.flatMap(({ name }, i) => ((slots[i] ?? 0) > 0 ? [name] : [])),
        );
      }
    } finally {
      set("ANA_HOSTS", saved.hosts);
      set("ANA_CHECK_HOST", saved.check);
      set("ANA_HOP", saved.hop);
    }
    expect([cases.length, dealt]).toEqual([85 * 7 * 2 * 11, 84 * 7 * 11]);
  });

  it("names each place with its slots, and sends a host's tasks there sparing held benchmarks, leaving the caller's own otherwise", () => {
    expect(namedPlaces([{ remote: "a", slots: 2 }, { slots: 1 }])).toBe("a (2), here (1)");
    expect(placeEnv({ remote: "a", slots: 2 })).toStrictEqual({
      ANA_CHECK_HOST: "a",
      ANA_RUNNER_SPARE_HELD: "1",
    });
    expect(placeEnv({ slots: 4 })).toStrictEqual({});
  });

  it("runs every task once over the places that stay, puts back what a fading place held, and loses none, whichever places are down or fade", async () => {
    const BEHAVIOURS = ["ok", "down", "fade0", "fade1", "fade2"] as const;
    type Behaviour = (typeof BEHAVIOURS)[number];
    const combos = (length: number): Behaviour[][] =>
      length === 0 ? [[]] : combos(length - 1).flatMap((list) => BEHAVIOURS.map((one) => [...list, one]));
    const slotLists = (length: number): number[][] =>
      length === 0 ? [[]] : slotLists(length - 1).flatMap((list) => [1, 2].map((slots) => [...list, slots]));
    const cases = [1, 2, 3].flatMap((count) =>
      combos(count).flatMap((behaviours) =>
        slotLists(count).flatMap((slots) =>
          [0, 1, 3, 6].flatMap((tasks) =>
            [false, true].map((alone) => ({ behaviours, slots, tasks, alone })),
          ),
        ),
      ),
    );
    let finished = 0;
    for (const { behaviours, slots, tasks, alone } of cases) {
      const places: Place[] = slots.map((count, at) => ({ remote: `p${String(at)}`, slots: count }));
      const kind = new Map<Place, Behaviour>(places.map((place, at) => [place, behaviours[at] ?? "ok"]));
      const runs = new Map(places.map((place) => [place, 0]));
      const active = new Map(places.map((place) => [place, 0]));
      const busy = new Set<number>();
      const done: number[] = [];
      const faults: string[] = [];
      let running = 0;
      const solo = (task: number) => alone && task === 0;
      const { unrun, refused } = await spread(
        places,
        Array.from({ length: tasks }, (_, at) => at),
        {
          qualify: async ({ place }) => (kind.get(place) === "down" ? "down" : null),
          startsAlone: solo,
          run: async (task, { place, index, leave }) => {
            if (kind.get(place) === "down") faults.push("ran on a down place");
            if (busy.has(index)) faults.push("two tasks on one seat");
            if (solo(task) && running > 0) faults.push("a lone task started beside another");
            busy.add(index);
            running += 1;
            active.set(place, (active.get(place) ?? 0) + 1);
            if ((active.get(place) ?? 0) > place.slots) faults.push("a place over its slots");
            for (let tick = 0; tick <= task % 3; tick += 1) await Promise.resolve();
            busy.delete(index);
            running -= 1;
            active.set(place, (active.get(place) ?? 0) - 1);
            const count = runs.get(place) ?? 0;
            runs.set(place, count + 1);
            const fade = kind.get(place) ?? "ok";
            if (fade.startsWith("fade") && count >= Number(fade.slice(4)) && leave()) return "elsewhere";
            done.push(task);
            return "done";
          },
        },
      );
      expect(faults).toStrictEqual([]);
      expect(refused.length).toBe(behaviours.filter((one) => one === "down").length);
      expect([...done, ...unrun].toSorted((a, b) => a - b)).toStrictEqual(
        Array.from({ length: tasks }, (_, at) => at),
      );
      expect(unrun).toStrictEqual(unrun.toSorted((a, b) => a - b));
      if (behaviours.some((one) => one !== "down")) expect(unrun).toStrictEqual([]);
      if (unrun.length === 0) finished += 1;
    }
    expect(cases.length).toBe(1110 * 8);
    expect(finished).toBeGreaterThan(cases.length / 2);
  });
});
