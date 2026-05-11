import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';

export interface IngestResult {
  title: string;
  content: string;
  textContent: string;
  url: string;
}

export async function ingestUrl(url: string): Promise<IngestResult> {
  const resp = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; Local7/1.0)',
      'Accept': 'text/html,application/xhtml+xml',
    },
    signal: AbortSignal.timeout(30000),
  });

  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);

  const html = await resp.text();
  const dom = new JSDOM(html, { url });
  const reader = new Readability(dom.window.document);
  const article = reader.parse();

  if (!article || !article.textContent?.trim()) {
    throw new Error('Could not extract readable content from the page');
  }

  const content = article.textContent
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+/g, ' ')
    .trim();

  const structured: Record<string, unknown> = {
    title: article.title,
    url,
    content,
    excerpt: article.excerpt || undefined,
    siteName: article.siteName || undefined,
    byline: article.byline || undefined,
    length: content.length,
    extractedAt: new Date().toISOString(),
  };

  if (article.textContent && article.length > 500) {
    const sections = extractSections(content);
    if (sections.length > 1) {
      (structured as Record<string, unknown>).sections = sections;
    }
  }

  return {
    title: article.title,
    content: JSON.stringify(structured),
    textContent: content,
    url,
  };
}

function extractSections(text: string): { heading: string; content: string }[] {
  const sections: { heading: string; content: string }[] = [];
  const lines = text.split('\n');
  let currentHeading = 'Introduction';
  let currentContent: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length < 60 && trimmed.length > 2 && !trimmed.endsWith('.') && !trimmed.endsWith(',')) {
      if (currentContent.length > 0 && currentContent.join(' ').trim()) {
        sections.push({ heading: currentHeading, content: currentContent.join(' ').trim() });
      }
      currentHeading = trimmed;
      currentContent = [];
    } else if (trimmed) {
      currentContent.push(trimmed);
    }
  }

  if (currentContent.length > 0 && currentContent.join(' ').trim()) {
    sections.push({ heading: currentHeading, content: currentContent.join(' ').trim() });
  }

  return sections;
}
