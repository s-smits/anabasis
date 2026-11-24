import { describe, expect, it } from "bun:test";
import { checkPlaces, namedPlaces, placeEnv } from "../tools/runs/host-config.ts";

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
      [undefined, "", "  ", "here", "auto", "h0"].flatMap((check) =>
        [undefined, "1"].flatMap((hop) =>
          [undefined, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((jobs) => ({ hosts, check, hop, jobs })),
        ),
      ),
    );
    let spread = 0;
    try {
      for (const { hosts, check, hop, jobs } of cases) {
        set("ANA_HOSTS", JSON.stringify(hosts));
        set("ANA_CHECK_HOST", check);
        set("ANA_HOP", hop);
        const places = checkPlaces("/nowhere", jobs);
        if ((check?.trim() ?? "") !== "" || hop === "1" || hosts.length === 0) {
          expect(places).toStrictEqual([{ slots: jobs ?? 1 }]);
          continue;
        }
        spread += 1;
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
    expect([cases.length, spread]).toEqual([85 * 6 * 2 * 11, 84 * 3 * 11]);
  });

  it("names each place with its slots, and sends a host's tasks there sparing held benchmarks, leaving the caller's own otherwise", () => {
    expect(namedPlaces([{ remote: "a", slots: 2 }, { slots: 1 }])).toBe("a (2), here (1)");
    expect(placeEnv({ remote: "a", slots: 2 })).toStrictEqual({
      ANA_CHECK_HOST: "a",
      ANA_RUNNER_SPARE_HELD: "1",
    });
    expect(placeEnv({ slots: 4 })).toStrictEqual({});
  });
});
