import { existsSync, readFileSync } from "node:fs";
import { resolve, sep, basename } from "node:path";

/**
 * Humanize a filename: strip .md extension, replace hyphens with spaces,
 * and title-case each word.
 */
export function humanizeFilename(filename: string): string {
  const name = filename.endsWith(".md") ? filename.slice(0, -3) : filename;
  return name
    .replace(/-/g, " ")
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

/**
 * Extract the title field from YAML frontmatter using a minimal sync reader.
 * Returns the title string, or null if frontmatter is missing or has no title.
 */
function extractFrontmatterTitle(filePath: string): string | null {
  let content: string;
  try {
    content = readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }

  content = content.replace(/\r\n/g, "\n");

  if (!content.startsWith("---")) return null;

  const closingIndex = content.indexOf("\n---", 3);
  if (closingIndex === -1) return null;

  const fmStart = content.indexOf("\n", 3) + 1;
  const frontmatterBlock = content.slice(fmStart, closingIndex);

  for (const line of frontmatterBlock.split("\n")) {
    const trimmed = line.trim();
    const colonIndex = trimmed.indexOf(":");
    if (colonIndex === -1) continue;

    const key = trimmed.slice(0, colonIndex).trim();
    if (key !== "title") continue;

    let value = trimmed.slice(colonIndex + 1).trim();
    // Strip surrounding quotes if present
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    return value || null;
  }

  return null;
}

export function resolveWikiLinks(body: string, basePath: string): string {
  const normalizedBase = resolve(basePath) + sep;

  return body.replace(/\[\[([^\]]+)\]\]/g, (_match, relativePath: string) => {
    const absolute = resolve(basePath, relativePath);

    if (!absolute.startsWith(normalizedBase)) {
      console.warn(
        `engrams: wiki-link escapes base path: [[${relativePath}]]`,
      );
      return `[[${relativePath}]]`;
    }

    const filename = basename(relativePath);

    if (existsSync(absolute)) {
      const title = extractFrontmatterTitle(absolute);
      if (title) {
        return `(see: ${title})`;
      }
      return `(see: ${humanizeFilename(filename)})`;
    }

    return `(see: ${humanizeFilename(filename)})`;
  });
}
