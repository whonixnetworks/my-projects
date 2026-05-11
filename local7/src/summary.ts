export interface SummaryConfig {
  provider: 'openai' | 'anthropic' | 'ollama' | 'none';
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  maxLength?: number;
}

const DEFAULT_CONFIG: SummaryConfig = {
  provider: 'none',
  maxLength: 500,
};

let summaryConfig: SummaryConfig = { ...DEFAULT_CONFIG };

export function setSummaryConfig(config: Partial<SummaryConfig>): void {
  summaryConfig = { ...summaryConfig, ...config };

  if (process.env.LOCAL7_SUMMARY_PROVIDER) {
    summaryConfig.provider = process.env.LOCAL7_SUMMARY_PROVIDER as SummaryConfig['provider'];
  }
  if (process.env.LOCAL7_SUMMARY_API_KEY) {
    summaryConfig.apiKey = process.env.LOCAL7_SUMMARY_API_KEY;
  }
  if (process.env.LOCAL7_SUMMARY_MODEL) {
    summaryConfig.model = process.env.LOCAL7_SUMMARY_MODEL;
  }
  if (process.env.LOCAL7_SUMMARY_BASE_URL) {
    summaryConfig.baseUrl = process.env.LOCAL7_SUMMARY_BASE_URL;
  }
}

// Initialize from env on module load
setSummaryConfig({});

export function getSummaryConfig(): SummaryConfig {
  return { ...summaryConfig };
}

/**
 * Summarize text using the configured LLM provider.
 * Falls back to truncation if no provider is configured.
 */
export async function summarizeText(text: string, maxLength?: number): Promise<string> {
  const maxLen = maxLength || summaryConfig.maxLength || 500;

  if (text.length <= maxLen) return text;

  if (summaryConfig.provider === 'none') {
    return text.slice(0, maxLen) + (text.length > maxLen ? '...' : '');
  }

  try {
    switch (summaryConfig.provider) {
      case 'openai':
        return await summarizeWithOpenAI(text, maxLen);
      case 'anthropic':
        return await summarizeWithAnthropic(text, maxLen);
      case 'ollama':
        return await summarizeWithOllama(text, maxLen);
      default:
        return text.slice(0, maxLen) + '...';
    }
  } catch (err) {
    console.error('[local7] Summarization failed, truncating:', err);
    return text.slice(0, maxLen) + '...';
  }
}

async function summarizeWithOpenAI(text: string, maxLen: number): Promise<string> {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${summaryConfig.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: summaryConfig.model || 'gpt-4o-mini',
      messages: [{
        role: 'user',
        content: `Summarize in under ${maxLen} characters. Preserve key facts, decisions, and specifics. Omit filler.\n\n${text}`,
      }],
      max_tokens: Math.ceil(maxLen / 4),
      temperature: 0.3,
    }),
  });

  if (!response.ok) throw new Error(`OpenAI API error: ${response.status}`);
  const data = await response.json() as any;
  return data.choices[0].message.content.trim();
}

async function summarizeWithAnthropic(text: string, maxLen: number): Promise<string> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': summaryConfig.apiKey!,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: summaryConfig.model || 'claude-3-5-haiku-20241022',
      max_tokens: Math.ceil(maxLen / 4),
      messages: [{
        role: 'user',
        content: `Summarize in under ${maxLen} characters. Preserve key facts, decisions, and specifics. Omit filler.\n\n${text}`,
      }],
    }),
  });

  if (!response.ok) throw new Error(`Anthropic API error: ${response.status}`);
  const data = await response.json() as any;
  return data.content[0].text.trim();
}

async function summarizeWithOllama(text: string, maxLen: number): Promise<string> {
  const baseUrl = summaryConfig.baseUrl || 'http://localhost:11434';
  const response = await fetch(`${baseUrl}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: summaryConfig.model || 'llama3.2',
      prompt: `Summarize in under ${maxLen} characters. Preserve key facts, decisions, and specifics. Omit filler.\n\n${text}`,
      stream: false,
    }),
  });

  if (!response.ok) throw new Error(`Ollama API error: ${response.status}`);
  const data = await response.json() as any;
  return data.response.trim();
}

/**
 * Generate a hierarchical summary for a long document.
 * Creates: overall summary → section summaries
 */
export async function createHierarchicalSummary(
  text: string,
  title?: string,
): Promise<{
  fullSummary: string;
  sectionSummaries: Array<{ heading: string; summary: string }>;
}> {
  const { chunkText } = await import('./chunking.js');
  const chunks = chunkText(text, 1000);

  const sectionSummaries = await Promise.all(
    chunks.map(async (chunk) => ({
      heading: chunk.heading || 'Section',
      summary: await summarizeText(chunk.text, 200),
    })),
  );

  const combinedSummaries = sectionSummaries
    .map(s => `## ${s.heading}\n${s.summary}`)
    .join('\n\n');

  const fullSummary = await summarizeText(
    `Title: ${title || 'Untitled'}\n\n${combinedSummaries}`,
    500,
  );

  return { fullSummary, sectionSummaries };
}