import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveWikiLinks, humanizeFilename } from "../src/wiki-links.js";

describe("humanizeFilename", () => {
  it("strips .md extension, replaces hyphens, and title-cases", () => {
    assert.equal(
      humanizeFilename("stride-privacy-review-deadline.md"),
      "Stride Privacy Review Deadline",
    );
  });

  it("handles filename without .md extension", () => {
    assert.equal(
      humanizeFilename("stride-privacy-review-deadline"),
      "Stride Privacy Review Deadline",
    );
  });

  it("handles single-word filename", () => {
    assert.equal(humanizeFilename("guide.md"), "Guide");
  });

  it("handles filename with no hyphens and no extension", () => {
    assert.equal(humanizeFilename("readme"), "Readme");
  });
});

describe("resolveWikiLinks", () => {
  let basePath: string;

  beforeEach(() => {
    basePath = mkdtempSync(join(tmpdir(), "engrams-wikilinks-"));
  });

  afterEach(() => {
    rmSync(basePath, { recursive: true, force: true });
  });

  it("resolves wiki-link to frontmatter title when file exists with title", () => {
    const target = join(basePath, "guide.md");
    writeFileSync(
      target,
      "---\ntitle: Getting Started Guide\n---\nGuide content.",
    );

    const body = "See [[guide.md]] for details.";
    const result = resolveWikiLinks(body, basePath);

    assert.equal(result, "See (see: Getting Started Guide) for details.");
  });

  it("resolves wiki-link to humanized filename when file exists without title", () => {
    const target = join(basePath, "quick-start.md");
    writeFileSync(target, "No frontmatter here, just plain content.");

    const body = "See [[quick-start.md]] for details.";
    const result = resolveWikiLinks(body, basePath);

    assert.equal(result, "See (see: Quick Start) for details.");
  });

  it("resolves wiki-link to humanized filename when file does not exist", () => {
    const body = "See [[missing-file.md]] for details.";
    const result = resolveWikiLinks(body, basePath);

    assert.equal(result, "See (see: Missing File) for details.");
  });

  it("resolves multiple wiki-links in the same body", () => {
    const file1 = join(basePath, "a.md");
    const file2 = join(basePath, "b.md");
    writeFileSync(file1, "---\ntitle: Alpha\n---\nA");
    writeFileSync(file2, "---\ntitle: Bravo\n---\nB");

    const body = "Ref [[a.md]] and [[b.md]].";
    const result = resolveWikiLinks(body, basePath);

    assert.equal(result, "Ref (see: Alpha) and (see: Bravo).");
  });

  it("handles body with no wiki-links", () => {
    const body = "No links in this text.";
    const result = resolveWikiLinks(body, basePath);

    assert.equal(result, "No links in this text.");
  });

  it("handles mix of existing (with title) and missing links", () => {
    const existing = join(basePath, "exists.md");
    writeFileSync(
      existing,
      "---\ntitle: Existing Resource\n---\nContent",
    );

    const body = "[[exists.md]] and [[gone-resource.md]]";
    const result = resolveWikiLinks(body, basePath);

    assert.equal(
      result,
      "(see: Existing Resource) and (see: Gone Resource)",
    );
  });

  it("handles nested directory paths", () => {
    const nested = join(basePath, "OpenClaw", "learning-companion-guide.md");
    mkdirSync(join(basePath, "OpenClaw"), { recursive: true });
    writeFileSync(
      nested,
      "---\ntitle: Learning Companion Guide\n---\nGuide content.",
    );

    const body = "See [[OpenClaw/learning-companion-guide.md]].";
    const result = resolveWikiLinks(body, basePath);

    assert.equal(result, "See (see: Learning Companion Guide).");
  });

  it("blocks path traversal outside base path", () => {
    const body = "See [[../../etc/passwd]] for details.";
    const result = resolveWikiLinks(body, basePath);

    assert.equal(result, "See [[../../etc/passwd]] for details.");
  });

  it("falls back to humanized filename for file with frontmatter but empty title", () => {
    const target = join(basePath, "no-title-field.md");
    writeFileSync(
      target,
      "---\nweight: 3\norigin: agent-a\n---\nSome body.",
    );

    const body = "Check [[no-title-field.md]].";
    const result = resolveWikiLinks(body, basePath);

    assert.equal(result, "Check (see: No Title Field).");
  });

  it("does not leak absolute paths in output", () => {
    const target = join(basePath, "secret-path.md");
    writeFileSync(target, "---\ntitle: My Secret\n---\nContent.");

    const body = "Link: [[secret-path.md]]";
    const result = resolveWikiLinks(body, basePath);

    assert.ok(!result.includes(basePath), "Output should not contain absolute base path");
    assert.equal(result, "Link: (see: My Secret)");
  });
});
