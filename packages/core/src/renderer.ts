import { join } from "node:path";
import type { RenderInput, SelectedTopic } from "./types.js";
import { parseTopic } from "./parser.js";
import { resolveWikiLinks } from "./wiki-links.js";

const USE_POLICY_HEADER_BASE = `## Engrams — Active Knowledge

These topics represent what the user is currently focused on.
For every user message, check whether it relates to any topic below.

If a topic is relevant:
- Apply the knowledge in the topic to your response
- Follow any [[linked resources]] in the topic and read them
  when you need more depth
- Do not ask the user whether to consult these — just use them

If no topic is relevant, ignore this section entirely.

`;

function usePolicyHeader(engramsPath: string): string {
  return USE_POLICY_HEADER_BASE + `Topics are stored at ${engramsPath}\n\n`;
}

/**
 * Render selected topics into a context block string.
 *
 * 1. Read each topic file, extract body, resolve wiki-links.
 * 2. Prepend use-policy header.
 * 3. Enforce maxBytes budget: drop lowest-ranked topics first, then truncate
 *    the body of a single oversized topic.
 * 4. Return empty string when no topics survive.
 */
export async function renderOutput(input: RenderInput): Promise<string> {
  const { selectedTopics, engramsPath, maxBytes } = input;

  if (selectedTopics.length === 0) return "";

  // Load topic bodies in order (highest ranked first)
  const sections: { topic: SelectedTopic; body: string }[] = [];

  for (const st of selectedTopics) {
    const filePath = join(engramsPath, st.file);
    const parsed = await parseTopic(filePath);
    if (!parsed || !parsed.body.trim()) continue;

    const resolved = resolveWikiLinks(parsed.body, engramsPath);
    sections.push({ topic: st, body: resolved });
  }

  if (sections.length === 0) return "";

  const header = usePolicyHeader(engramsPath);
  const headerBytes = byteLength(header);

  // Drop lowest-ranked topics (from the end) until we fit
  while (sections.length > 0) {
    const total = headerBytes + sectionsBytes(sections);
    if (total <= maxBytes) break;
    // If only one section remains and it's still too big, we'll truncate below
    if (sections.length === 1) break;
    sections.pop();
  }

  if (sections.length === 0) return "";

  // If the single remaining section is still over budget, truncate its body
  let total = headerBytes + sectionsBytes(sections);
  if (total > maxBytes && sections.length === 1) {
    const section = sections[0];
    const sectionHeader = `## ${section.topic.title}\n\n`;
    const sectionTrailer = "\n\n";
    const sectionHeaderBytes = byteLength(sectionHeader);
    const budgetForBody = maxBytes - headerBytes - sectionHeaderBytes - byteLength(sectionTrailer);

    if (budgetForBody <= 0) {
      return "";
    }

    section.body = truncateToBytes(section.body, budgetForBody);
  }

  // Build final output
  let output = header;
  for (const section of sections) {
    output += `## ${section.topic.title}\n\n${section.body}\n\n`;
  }

  return output;
}

function byteLength(s: string): number {
  return Buffer.byteLength(s, "utf-8");
}

function sectionsBytes(sections: { topic: SelectedTopic; body: string }[]): number {
  let total = 0;
  for (const s of sections) {
    total += byteLength(`## ${s.topic.title}\n\n${s.body}\n\n`);
  }
  return total;
}

function truncateToBytes(s: string, maxBytes: number): string {
  const buf = Buffer.from(s, "utf-8");
  if (buf.length <= maxBytes) return s;
  let end = maxBytes;
  while (end > 0 && (buf[end] & 0xc0) === 0x80) end--;
  return buf.subarray(0, end).toString("utf-8");
}
