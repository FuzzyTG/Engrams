import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { selectTopics } from "../src/selector.js";
import type { IndexEntry, SelectionInput } from "../src/types.js";

const NOW = new Date("2026-05-15T00:00:00Z");

function entry(overrides: Partial<IndexEntry> = {}): IndexEntry {
  return {
    file: "topic.md",
    title: "Default topic",
    weight: 1,
    origin: "agent-a",
    last_seen: "2026-05-14",
    participants: ["agent-a"],
    evergreen: false,
    ...overrides,
  };
}

function input(
  index: IndexEntry[],
  overrides: Partial<SelectionInput> = {},
): SelectionInput {
  return {
    index,
    agentId: "agent-a",
    timeWindowHours: 84,
    topN: 3,
    now: NOW,
    ...overrides,
  };
}

describe("selectTopics", () => {
  it("returns empty array when index is empty", () => {
    const result = selectTopics(input([]));
    assert.deepEqual(result, []);
  });

  it("selects a single eligible topic", () => {
    const result = selectTopics(input([entry()]));
    assert.equal(result.length, 1);
    assert.equal(result[0].file, "topic.md");
    assert.equal(result[0].tier, 1);
  });

  it("excludes topics where agent is neither origin nor participant", () => {
    const result = selectTopics(
      input([
        entry({ origin: "other", participants: ["other"], file: "excluded.md" }),
      ]),
    );
    assert.equal(result.length, 0);
  });

  it("excludes topics outside time window that are not evergreen", () => {
    const result = selectTopics(
      input([entry({ last_seen: "2026-01-01", evergreen: false })]),
    );
    assert.equal(result.length, 0);
  });

  it("keeps evergreen topics regardless of last_seen", () => {
    const result = selectTopics(
      input([entry({ last_seen: "2020-01-01", evergreen: true })]),
    );
    assert.equal(result.length, 1);
  });

  it("assigns tier 1 when origin matches agentId", () => {
    const result = selectTopics(
      input([entry({ origin: "agent-a", participants: ["agent-a"] })]),
    );
    assert.equal(result[0].tier, 1);
  });

  it("assigns tier 2 when agent is participant but not origin", () => {
    const result = selectTopics(
      input([
        entry({
          origin: "other",
          participants: ["agent-a", "other"],
          file: "t2.md",
        }),
      ]),
    );
    assert.equal(result.length, 1);
    assert.equal(result[0].tier, 2);
  });

  it("fills tier 1 before tier 2", () => {
    const result = selectTopics(
      input([
        entry({ file: "t2.md", origin: "other", participants: ["agent-a"], weight: 10 }),
        entry({ file: "t1.md", origin: "agent-a", participants: ["agent-a"], weight: 1 }),
      ]),
    );
    assert.equal(result[0].file, "t1.md");
    assert.equal(result[0].tier, 1);
    assert.equal(result[1].file, "t2.md");
    assert.equal(result[1].tier, 2);
  });

  it("sorts by weight descending within a tier", () => {
    const result = selectTopics(
      input([
        entry({ file: "low.md", weight: 1 }),
        entry({ file: "high.md", weight: 5 }),
        entry({ file: "mid.md", weight: 3 }),
      ]),
    );
    assert.equal(result[0].file, "high.md");
    assert.equal(result[1].file, "mid.md");
    assert.equal(result[2].file, "low.md");
  });

  it("breaks weight ties by more recent last_seen", () => {
    const result = selectTopics(
      input([
        entry({ file: "older.md", weight: 5, last_seen: "2026-05-13" }),
        entry({ file: "newer.md", weight: 5, last_seen: "2026-05-14" }),
      ]),
    );
    assert.equal(result[0].file, "newer.md");
    assert.equal(result[1].file, "older.md");
  });

  it("limits results to topN", () => {
    const entries = [
      entry({ file: "a.md", weight: 5 }),
      entry({ file: "b.md", weight: 4 }),
      entry({ file: "c.md", weight: 3 }),
      entry({ file: "d.md", weight: 2 }),
      entry({ file: "e.md", weight: 1 }),
    ];
    const result = selectTopics(input(entries, { topN: 2 }));
    assert.equal(result.length, 2);
  });

  it("returns fewer than topN when not enough eligible topics", () => {
    const result = selectTopics(input([entry()], { topN: 5 }));
    assert.equal(result.length, 1);
  });

  it("fills all slots from tier 1 when enough tier 1 topics exist", () => {
    const entries = [
      entry({ file: "t1-a.md", weight: 3, origin: "agent-a" }),
      entry({ file: "t1-b.md", weight: 2, origin: "agent-a" }),
      entry({ file: "t1-c.md", weight: 1, origin: "agent-a" }),
      entry({ file: "t2.md", weight: 10, origin: "other", participants: ["agent-a"] }),
    ];
    const result = selectTopics(input(entries, { topN: 3 }));
    assert.ok(result.every((t) => t.tier === 1));
  });

  it("handles invalid last_seen dates as non-matching", () => {
    const result = selectTopics(
      input([entry({ last_seen: "invalid", evergreen: false })]),
    );
    assert.equal(result.length, 0);
  });

  it("handles empty last_seen as non-matching for time window", () => {
    const result = selectTopics(
      input([entry({ last_seen: "", evergreen: false })]),
    );
    assert.equal(result.length, 0);
  });

  it("uses consistent day-precision cutoff regardless of time of day", () => {
    // With 24h window, a date exactly 1 day ago should always be included
    // regardless of whether now is morning or evening
    const morning = new Date("2026-05-15T08:00:00Z");
    const evening = new Date("2026-05-15T20:00:00Z");
    const e = entry({ last_seen: "2026-05-14", evergreen: false });

    const resultMorning = selectTopics(input([e], { now: morning, timeWindowHours: 24 }));
    const resultEvening = selectTopics(input([e], { now: evening, timeWindowHours: 24 }));

    assert.equal(resultMorning.length, resultEvening.length, "cutoff should not vary by time of day");
    assert.equal(resultMorning.length, 1);
  });
});
