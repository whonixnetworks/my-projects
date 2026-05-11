import { encode, DELIMITERS } from '@toon-format/toon';

export function jsonToToon(data: unknown): string {
  try {
    return encode(data, { delimiter: DELIMITERS.tab });
  } catch {
    return encode(data);
  }
}

export function extractText(data: unknown): string {
  if (data === null || data === undefined) return '';
  if (typeof data === 'string') return data;
  if (typeof data === 'number' || typeof data === 'boolean') return String(data);
  if (Array.isArray(data)) return data.map(extractText).filter(Boolean).join(' ');
  if (typeof data === 'object') {
    return Object.entries(data as Record<string, unknown>)
      .map(([k, v]) => `${k} ${extractText(v)}`)
      .filter(Boolean)
      .join(' ');
  }
  return String(data);
}
