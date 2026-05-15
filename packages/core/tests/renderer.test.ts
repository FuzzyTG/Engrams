import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { renderOutput } from "../src/renderer.js";
import type { SelectedTopic } from "../src/types.js";

function writeTopic(dir: string, filename: string, title: string, body: string): void {
  writeFileSync(
    join(dir, filename),
    [
      "---",
      `title: ${title}`,
      "created: 2026-03-15",
      "origin: agent-a",
      "last_seen: 2026-05-10",
      "weight: 3",
      "participants: [agent-a]",
      "evergreen: false",
      "---",
      "",
      body,
    ].join("\n"),
  );
}

function topic(overrides: Partial<SelectedTopic> = {}): SelectedTopic {
  return {
    file: "topic.md",
    title: "Test Topic",
    weight: 3,
    tier: 1,
    ...overrides,
  };
}

describe("renderOutput", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "engrams-renderer-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns empty string when no topics are selected", async () => {
    const result = await renderOutput({
      selectedTopics: [],
      engramsPath: dir,
      maxBytes: 2048,
    });
    assert.equal(result, "");
  });

  it("renders a single topic with header", async () => {
    writeTopic(dir, "topic.md", "Test Topic", "Topic body content.");
    const result = await renderOutput({
      selectedTopics: [topic()],
      engramsPath: dir,
      maxBytes: 2048,
    });
    assert.ok(result.startsWith("## Engrams — Active Knowledge"));
    assert.ok(result.includes("check whether it relates to any topic below"));
    assert.ok(result.includes("## Test Topic"));
    assert.ok(result.includes("Topic body content."));
  });

  it("renders multiple topics in order", async () => {
    writeTopic(dir, "first.md", "First", "First body.");
    writeTopic(dir, "second.md", "Second", "Second body.");
    const result = await renderOutput({
      selectedTopics: [
        topic({ file: "first.md", title: "First", weight: 5 }),
        topic({ file: "second.md", title: "Second", weight: 3 }),
      ],
      engramsPath: dir,
      maxBytes: 2048,
    });
    const firstIdx = result.indexOf("## First");
    const secondIdx = result.indexOf("## Second");
    assert.ok(firstIdx < secondIdx, "First topic should appear before second");
  });

  it("drops lowest-ranked topic when exceeding maxBytes", async () => {
    writeTopic(dir, "high.md", "High", "Important content.");
    writeTopic(dir, "low.md", "Low", "A".repeat(2000));
    const result = await renderOutput({
      selectedTopics: [
        topic({ file: "high.md", title: "High", weight: 5 }),
        topic({ file: "low.md", title: "Low", weight: 1 }),
      ],
      engramsPath: dir,
      maxBytes: 600,
    });
    assert.ok(result.includes("## High"));
    assert.ok(!result.includes("## Low"));
  });

  it("truncates single oversized topic body", async () => {
    const longBody = "B".repeat(3000);
    writeTopic(dir, "big.md", "Big", longBody);
    const result = await renderOutput({
      selectedTopics: [topic({ file: "big.md", title: "Big" })],
      engramsPath: dir,
      maxBytes: 600,
    });
    assert.ok(result.includes("## Big"));
    assert.ok(Buffer.byteLength(result, "utf-8") <= 600);
  });

  it("returns empty string when topic file does not exist", async () => {
    const result = await renderOutput({
      selectedTopics: [topic({ file: "missing.md" })],
      engramsPath: dir,
      maxBytes: 2048,
    });
    assert.equal(result, "");
  });

  it("resolves wiki-links in topic bodies", async () => {
    const linkedFile = join(dir, "linked.md");
    writeFileSync(linkedFile, "---\ntitle: Linked\n---\nLinked content.");
    writeTopic(dir, "topic.md", "Test Topic", "See [[linked.md]] for details.");

    const result = await renderOutput({
      selectedTopics: [topic()],
      engramsPath: dir,
      maxBytes: 2048,
    });
    assert.ok(result.includes(linkedFile));
    assert.ok(!result.includes("[[linked.md]]"));
  });

  it("strips frontmatter from topic body", async () => {
    writeTopic(dir, "topic.md", "Test Topic", "Only this body.");
    const result = await renderOutput({
      selectedTopics: [topic()],
      engramsPath: dir,
      maxBytes: 2048,
    });
    assert.ok(!result.includes("origin:"));
    assert.ok(!result.includes("weight:"));
    assert.ok(result.includes("Only this body."));
  });

  it("handles fewer than 3 topics", async () => {
    writeTopic(dir, "solo.md", "Solo", "Solo content.");
    const result = await renderOutput({
      selectedTopics: [topic({ file: "solo.md", title: "Solo" })],
      engramsPath: dir,
      maxBytes: 2048,
    });
    assert.ok(result.includes("## Solo"));
    assert.ok(result.includes("Solo content."));
  });

  it("truncates multi-byte content without exceeding byte budget", async () => {
    const body = "Hello " + "\u{1F600}".repeat(500);
    writeTopic(dir, "emoji.md", "Emoji", body);
    const maxBytes = 600;
    const result = await renderOutput({
      selectedTopics: [topic({ file: "emoji.md", title: "Emoji" })],
      engramsPath: dir,
      maxBytes,
    });
    assert.ok(Buffer.byteLength(result, "utf-8") <= maxBytes);
  });

  it("skips topics with empty body", async () => {
    writeFileSync(
      join(dir, "empty.md"),
      ["---", "title: Empty", "weight: 5", "origin: agent-a", "---", ""].join("\n"),
    );
    writeTopic(dir, "real.md", "Real", "Real content.");
    const result = await renderOutput({
      selectedTopics: [
        topic({ file: "empty.md", title: "Empty", weight: 5 }),
        topic({ file: "real.md", title: "Real", weight: 3 }),
      ],
      engramsPath: dir,
      maxBytes: 2048,
    });
    assert.ok(!result.includes("## Empty"));
    assert.ok(result.includes("## Real"));
  });

  it("returns empty when all topics have empty bodies", async () => {
    writeFileSync(
      join(dir, "empty.md"),
      ["---", "title: Empty", "weight: 5", "origin: agent-a", "---", ""].join("\n"),
    );
    const result = await renderOutput({
      selectedTopics: [topic({ file: "empty.md", title: "Empty" })],
      engramsPath: dir,
      maxBytes: 2048,
    });
    assert.equal(result, "");
  });
});
