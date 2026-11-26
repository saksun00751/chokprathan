import { describe, expect, test } from "vitest";
import type { RoundConfig } from "chokprathan-core/rules/roundConfig";
import { betWindow, billMoney, discountPercent, liveRate, mergeLines, packageRows, parsePackageId, planPaste, slipDue, unofferedLines } from "./bet-packages";

const offered = new Map([
  ["top2", { digits: 2, discountBp: 1500 }],
  ["bottom2", { digits: 2, discountBp: 0 }],
] as const);

const risk = { enabled: false, tiers: [], cap: null };
const config: RoundConfig = {
  format: "standard",
  maxPerBill: 10_000,
  maxLines: 100,
  betTypes: { top2: { minStake: 1, maxPerNumber: 1000, risk }, top3: { minStake: 1, maxPerNumber: 1000, risk } },
  packages: [
    { id: 1, code: "standard", name: "มาตรฐาน", rates: { top2: { rate100: 9500, discountBp: 0 }, top3: { rate100: 90000, discountBp: 0 } } },
    { id: 2, code: "d15", name: "ลด 15", rates: { top2: { rate100: 7500, discountBp: 1500 } } },
  ],
};

describe("parsePackageId", () => {
  test("absent means the standard package", () => {
    expect(parsePackageId(undefined)).toBeUndefined();
  });
  test("accepts a positive whole number only", () => {
    expect(parsePackageId(2)).toBe(2);
    for (const bad of [0, -1, 1.5, "2", null, {}, Number.NaN, 2 ** 40]) expect(parsePackageId(bad)).toBeNull();
  });
});

describe("liveRate", () => {
  test("is the package's own rate when the number has no badge", () => {
    expect(liveRate(7500, undefined)).toBe(7500);
  });
  test("applies the cut percent to the package's rate, rounded down", () => {
    expect(liveRate(7500, { percent: 75 })).toBe(5625);
    expect(liveRate(333, { percent: 50 })).toBe(166);
  });
  test("null percent is a closed number", () => {
    expect(liveRate(7500, { percent: null })).toBeNull();
  });
});

describe("slipDue", () => {
  test("takes each line's discount off in satang", () => {
    const due = slipDue(
      [
        { betType: "top2", number: "25", stake: 100 },
        { betType: "bottom2", number: "25", stake: 10 },
      ],
      offered,
    );
    expect(due).toEqual({ stake: 110, discount: 1500, net: 9500 });
  });
  test("a line being typed (stake 0) and a type the package lacks carry no discount", () => {
    expect(
      slipDue(
        [
          { betType: "top2", number: "25", stake: 0 },
          { betType: "top3", number: "123", stake: 10 },
        ],
        offered,
      ),
    ).toEqual({ stake: 10, discount: 0, net: 1000 });
  });
});

describe("unofferedLines", () => {
  test("lists what the package does not offer", () => {
    const lines = [
      { betType: "top2" as const, number: "25", stake: 1 },
      { betType: "top3" as const, number: "123", stake: 1 },
    ];
    expect(unofferedLines(lines, offered)).toEqual([lines[1]]);
  });
});

describe("mergeLines", () => {
  const have = [{ betType: "top2" as const, number: "25", stake: 10 }];
  test("adds several bet types in one go and keeps what is already there", () => {
    const r = mergeLines(have, [
      { betType: "top2", number: "26", stake: 5 },
      { betType: "bottom2", number: "26", stake: 7 },
    ]);
    expect(r.lines.map((l) => [l.betType, l.number, l.stake])).toEqual([
      ["top2", "25", 10],
      ["top2", "26", 5],
      ["bottom2", "26", 7],
    ]);
    expect(r.added).toBe(2);
  });
  test("never changes the stake of a number already in the slip", () => {
    const r = mergeLines(have, [{ betType: "top2", number: "25", stake: 99 }]);
    expect(r).toEqual({ lines: have, added: 0 });
  });
});

describe("planPaste", () => {
  const plan = (text: string, taken: string[] = [], closed: string[] = []) => planPaste(text, { offered, taken: new Set(taken), closed: new Set(closed) });

  test("takes readable lines with their own stakes", () => {
    const r = plan("12 34 = 50x20");
    expect(r.add).toHaveLength(4);
    expect(r.rejected).toEqual([]);
  });

  test("rejects a whole line, with its reason, and keeps the other lines", () => {
    const r = plan("hello\n\n123 = 10\n11 = 5\n22 = 5\n33 = 5", ["top2:22"], ["top2:33"]);
    expect(r.add).toEqual([{ betType: "top2", number: "11", stake: 5 }]);
    expect(r.rejected).toEqual([
      { line: 1, text: "hello", reason: "format" },
      { line: 3, text: "123 = 10", reason: "unoffered" },
      { line: 5, text: "22 = 5", reason: "duplicate" },
      { line: 6, text: "33 = 5", reason: "closed" },
    ]);
  });

  test("a number repeated in the text is a duplicate the second time", () => {
    expect(plan("11 = 5\n11 = 9").rejected).toEqual([{ line: 2, text: "11 = 9", reason: "duplicate" }]);
    expect(plan("11 11 = 5").rejected).toEqual([{ line: 1, text: "11 11 = 5", reason: "duplicate" }]);
  });
});

describe("betWindow", () => {
  const round = { phase: "upcoming" as const, opensAt: 100, closesAt: 200 };
  test("follows the clock after the page was loaded", () => {
    expect(betWindow(round, 99)).toBe("upcoming");
    expect(betWindow(round, 100)).toBe("open");
    expect(betWindow(round, 200)).toBe("closed");
  });
  test("a resulted or cancelled round is closed whatever the time", () => {
    expect(betWindow({ ...round, phase: "cancelled" }, 150)).toBe("closed");
    expect(betWindow({ ...round, phase: "resulted" }, 50)).toBe("closed");
  });
});

describe("billMoney", () => {
  test("shows the stake before discount and what was paid, with the package of that bill", () => {
    expect(billMoney({ totalPaid: 8500, discount: 1500, packageId: 2 }, config)).toEqual({ stake: 10000, discount: 1500, paid: 8500, packageName: "ลด 15", standard: false });
  });
  test("a bill from before packages has no package name", () => {
    expect(billMoney({ totalPaid: 8500, discount: 0, packageId: null }, undefined)).toEqual({ stake: 8500, discount: 0, paid: 8500, packageName: null, standard: false });
  });
  test("marks the standard package so the page can name it in the member's language", () => {
    expect(billMoney({ totalPaid: 100, discount: 0, packageId: 1 }, config).standard).toBe(true);
  });
});

describe("packageRows", () => {
  test("lists each package with its rate and discount per bet type, standard order", () => {
    expect(packageRows(config)).toEqual([
      { id: 1, code: "standard", name: "มาตรฐาน", rates: [{ code: "top3", rate100: 90000, discountBp: 0 }, { code: "top2", rate100: 9500, discountBp: 0 }] },
      { id: 2, code: "d15", name: "ลด 15", rates: [{ code: "top2", rate100: 7500, discountBp: 1500 }] },
    ]);
  });
});

describe("discountPercent", () => {
  test("writes basis points as a percent", () => {
    expect([discountPercent(1500), discountPercent(250), discountPercent(5)]).toEqual(["15", "2.5", "0.05"]);
  });
});
