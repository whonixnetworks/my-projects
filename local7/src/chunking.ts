export interface Chunk {
  id: string;
  text: string;
  startIndex: number;
  endIndex: number;
  heading?: string;
}

let chunkCounter = 0;

/**
 * Split text into semantic chunks.
 *
 * Strategy:
 * 1. Split by markdown headings (## headings)
 * 2. Within each section, split by paragraph boundaries
 * 3. Each chunk is ≤ maxTokens tokens (roughly 4 chars per token)
 * 4. Overlap by ~10% for better retrieval at boundaries
 */
export function chunkText(text: string, maxTokens: number = 500): Chunk[] {
  const chunks: Chunk[] = [];
  const sections = splitByHeadings(text);

  for (const section of sections) {
    const sectionTokens = estimateTokens(section.text);

    if (sectionTokens <= maxTokens) {
      chunks.push({
        id: `chunk_${chunkCounter++}`,
        text: section.text,
        startIndex: section.startIndex,
        endIndex: section.endIndex,
        heading: section.heading,
      });
    } else {
      const subChunks = splitByParagraphs(section.text, maxTokens, section.heading);
      for (const sc of subChunks) {
        chunks.push({
          id: `chunk_${chunkCounter++}`,
          text: sc.text,
          startIndex: section.startIndex + sc.startIndex,
          endIndex: section.startIndex + sc.endIndex,
          heading: sc.heading || section.heading,
        });
      }
    }
  }

  return chunks;
}

function splitByHeadings(text: string): Array<{ heading: string; text: string; startIndex: number; endIndex: number }> {
  const sections: Array<{ heading: string; text: string; startIndex: number; endIndex: number }> = [];
  const lines = text.split('\n');
  let currentHeading = 'Introduction';
  let currentText: string[] = [];
  let charIndex = 0;

  for (const line of lines) {
    const headingMatch = line.match(/^(#{1,6})\s+(.+)/);
    if (headingMatch) {
      if (currentText.length > 0) {
        const content = currentText.join('\n').trim();
        if (content) {
          const start = charIndex - content.length - currentText.length;
          sections.push({
            heading: currentHeading,
            text: content,
            startIndex: Math.max(0, start),
            endIndex: charIndex,
          });
        }
      }
      currentHeading = headingMatch[2].trim();
      currentText = [];
    } else {
      currentText.push(line);
    }
    charIndex += line.length + 1;
  }

  if (currentText.length > 0) {
    const content = currentText.join('\n').trim();
    if (content) {
      sections.push({
        heading: currentHeading,
        text: content,
        startIndex: Math.max(0, charIndex - content.length),
        endIndex: charIndex,
      });
    }
  }

  return sections;
}

function splitByParagraphs(
  text: string,
  maxTokens: number,
  parentHeading?: string,
): Array<{ text: string; heading?: string; startIndex: number; endIndex: number }> {
  const paragraphs = text.split(/\n\n+/);
  const chunks: Array<{ text: string; heading?: string; startIndex: number; endIndex: number }> = [];
  let current: string[] = [];
  let currentTokens = 0;
  let charIndex = 0;

  for (const para of paragraphs) {
    const tokens = estimateTokens(para);

    if (currentTokens + tokens > maxTokens && current.length > 0) {
      const chunkText = current.join('\n\n');
      chunks.push({
        text: chunkText,
        heading: parentHeading,
        startIndex: Math.max(0, charIndex - chunkText.length),
        endIndex: charIndex,
      });

      // Overlap: keep last paragraph for context
      const overlap = current.length > 3 ? current.slice(-1) : [];
      current = [...overlap, para];
      currentTokens = overlap.reduce((s, p) => s + estimateTokens(p), 0) + tokens;
    } else {
      current.push(para);
      currentTokens += tokens;
    }

    charIndex += para.length + 2;
  }

  if (current.length > 0) {
    const chunkText = current.join('\n\n');
    chunks.push({
      text: chunkText,
      heading: parentHeading,
      startIndex: Math.max(0, charIndex - chunkText.length),
      endIndex: charIndex,
    });
  }

  return chunks;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}