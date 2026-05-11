export const DEFAULT_NAMESPACE = process.env.LOCAL7_NAMESPACE || 'default';

export function resolveNamespace(requested?: string): string {
  if (!requested) return DEFAULT_NAMESPACE;
  const normalized = requested.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_');
  return normalized || DEFAULT_NAMESPACE;
}
