import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { injectEngramsContext } from "../src/bootstrap.js";
import handler from "../hooks/engrams/handler.js";
import type { BootstrapContext } from "../src/bootstrap.js";

const RECENT_DATE = new Date().toISOString().slice(0, 10);

function writeTopicFile(
  dir: string,
  filename: string,
  title: string,
  body: string,
  overrides: Record<string, string | number | boolean> = {},
): void {
  const fields = {
    origin: "test-agent",
    last_seen: RECENT_DATE,
    weight: 3,
    participants: "[test-agent]",
    evergreen: false,
    ...overrides,
  };
  writeFileSync(
    join(dir, filename),
    [
      "---",
      `title: ${title}`,
      `origin: ${fields.origin}`,
      `last_seen: ${fields.last_seen}`,
      `weight: ${fields.weight}`,
      `participants: ${fields.participants}`,
      `evergreen: ${fields.evergreen}`,
      "---",
      "",
      body,
    ].join("\n"),
  );
}

function writeIndex(dir: string, entries: unknown[]): void {
  writeFileSync(join(dir, "engrams.json"), JSON.stringify(entries, null, 2));
}

describe("injectEngramsContext", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "engrams-bootstrap-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("injects context when topics are available", async () => {
    writeTopicFile(dir, "topic-a.md", "Topic A", "Body of topic A.");
    writeIndex(dir, [
      {
        file: "topic-a.md",
        title: "Topic A",
        weight: 3,
        origin: "test-agent",
        last_seen: RECENT_DATE,
        participants: ["test-agent"],
        evergreen: false,
      },
    ]);

    const context: BootstrapContext = {
      agentId: "test-agent",
      bootstrapFiles: [],
    };

    const result = await injectEngramsContext(context, { path: dir });

    assert.equal(result, true);
    assert.equal(context.bootstrapFiles!.length, 1);
    assert.equal(context.bootstrapFiles![0].path, "ENGRAMS_CONTEXT.md");
    assert.ok(context.bootstrapFiles![0].content.includes("Topic A"));
    assert.ok(context.bootstrapFiles![0].content.includes("Body of topic A."));
  });

  it("handler updates the original event context bootstrapFiles", async () => {
    writeTopicFile(dir, "topic-a.md", "Topic A", "Body of topic A.");
    writeIndex(dir, [
      {
        file: "topic-a.md",
        title: "Topic A",
        weight: 3,
        origin: "test-agent",
        last_seen: RECENT_DATE,
        participants: ["test-agent"],
        evergreen: false,
      },
    ]);

    const event = {
      type: "agent",
      action: "bootstrap",
      context: {
        agentId: "test-agent",
        bootstrapFiles: [] as Array<{ path: string; content: string }>,
        cfg: {
          plugins: {
            entries: {
              engrams: {
                config: { path: dir },
              },
            },
          },
        },
      },
    };

    await handler(event);

    assert.equal(event.context.bootstrapFiles.length, 1);
    assert.equal(event.context.bootstrapFiles[0].path, "ENGRAMS_CONTEXT.md");
    assert.ok(event.context.bootstrapFiles[0].content.includes("Topic A"));
  });

  it("returns false when no topics match the agent", async () => {
    writeTopicFile(dir, "topic.md", "Topic", "Body.", {
      origin: "other-agent",
      participants: "[other-agent]",
    });
    writeIndex(dir, [
      {
        file: "topic.md",
        title: "Topic",
        weight: 3,
        origin: "other-agent",
        last_seen: RECENT_DATE,
        participants: ["other-agent"],
        evergreen: false,
      },
    ]);

    const context: BootstrapContext = {
      agentId: "test-agent",
      bootstrapFiles: [],
    };

    const result = await injectEngramsContext(context, { path: dir });
    assert.equal(result, false);
    assert.equal(context.bootstrapFiles!.length, 0);
  });

  it("returns false when path is not configured", async () => {
    const context: BootstrapContext = { agentId: "test-agent" };
    const result = await injectEngramsContext(context, {});
    assert.equal(result, false);
  });

  it("returns false when engrams.json does not exist", async () => {
    const emptyDir = mkdtempSync(join(tmpdir(), "engrams-empty-"));
    const context: BootstrapContext = {
      agentId: "test-agent",
      bootstrapFiles: [],
    };

    const result = await injectEngramsContext(context, { path: emptyDir });
    assert.equal(result, false);
    rmSync(emptyDir, { recursive: true, force: true });
  });

  it("returns false when engrams.json is malformed", async () => {
    writeFileSync(join(dir, "engrams.json"), "not valid json{{{");

    const context: BootstrapContext = {
      agentId: "test-agent",
      bootstrapFiles: [],
    };

    const result = await injectEngramsContext(context, { path: dir });
    assert.equal(result, false);
  });

  it("initializes bootstrapFiles array if not present", async () => {
    writeTopicFile(dir, "topic.md", "Init Test", "Content.");
    writeIndex(dir, [
      {
        file: "topic.md",
        title: "Init Test",
        weight: 3,
        origin: "test-agent",
        last_seen: RECENT_DATE,
        participants: ["test-agent"],
        evergreen: false,
      },
    ]);

    const context: BootstrapContext = { agentId: "test-agent" };
    const result = await injectEngramsContext(context, { path: dir });

    assert.equal(result, true);
    assert.ok(Array.isArray(context.bootstrapFiles));
    assert.equal(context.bootstrapFiles!.length, 1);
  });

  it("respects custom topN config", async () => {
    for (let i = 0; i < 5; i++) {
      writeTopicFile(dir, `topic-${i}.md`, `Topic ${i}`, `Body ${i}.`, {
        weight: 5 - i,
      });
    }
    writeIndex(
      dir,
      Array.from({ length: 5 }, (_, i) => ({
        file: `topic-${i}.md`,
        title: `Topic ${i}`,
        weight: 5 - i,
        origin: "test-agent",
        last_seen: RECENT_DATE,
        participants: ["test-agent"],
        evergreen: false,
      })),
    );

    const context: BootstrapContext = {
      agentId: "test-agent",
      bootstrapFiles: [],
    };

    const result = await injectEngramsContext(context, {
      path: dir,
      topN: 1,
    });

    assert.equal(result, true);
    const content = context.bootstrapFiles![0].content;
    assert.ok(content.includes("Topic 0"));
    assert.ok(!content.includes("Topic 1"));
  });

  it("returns false when pluginConfig is undefined", async () => {
    const context: BootstrapContext = { agentId: "test-agent" };
    const result = await injectEngramsContext(context, undefined);
    assert.equal(result, false);
  });

  it("does not duplicate ENGRAMS_CONTEXT.md on repeated calls", async () => {
    writeTopicFile(dir, "topic.md", "Dup Test", "Content.");
    writeIndex(dir, [
      {
        file: "topic.md",
        title: "Dup Test",
        weight: 3,
        origin: "test-agent",
        last_seen: RECENT_DATE,
        participants: ["test-agent"],
        evergreen: false,
      },
    ]);

    const context: BootstrapContext = {
      agentId: "test-agent",
      bootstrapFiles: [],
    };

    const first = await injectEngramsContext(context, { path: dir });
    assert.equal(first, true);
    assert.equal(context.bootstrapFiles!.length, 1);

    const second = await injectEngramsContext(context, { path: dir });
    assert.equal(second, false);
    assert.equal(context.bootstrapFiles!.length, 1);
  });

  it("does not mutate a shared bootstrapFiles array reference", async () => {
    writeTopicFile(dir, "topic.md", "Mut Test", "Content.");
    writeIndex(dir, [
      {
        file: "topic.md",
        title: "Mut Test",
        weight: 3,
        origin: "test-agent",
        last_seen: RECENT_DATE,
        participants: ["test-agent"],
        evergreen: false,
      },
    ]);

    const shared: Array<{ path: string; content: string }> = [];
    const context: BootstrapContext = {
      agentId: "test-agent",
      bootstrapFiles: shared,
    };

    await injectEngramsContext(context, { path: dir });

    assert.equal(shared.length, 0, "original array must not be mutated");
    assert.equal(context.bootstrapFiles!.length, 1);
  });
});
