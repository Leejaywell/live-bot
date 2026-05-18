export async function fetchJson<T>(path: string, fallback: T): Promise<T> {
  try {
    const response = await fetch(path, { cache: 'no-store' });
    if (!response.ok) return fallback;
    return await response.json() as T;
  } catch {
    return fallback;
  }
}

export function proxyImage(url: unknown): string | undefined {
  if (typeof url !== 'string' || !url.trim()) return undefined;
  return url.includes('hdslb.com') ? `/proxy?url=${encodeURIComponent(url)}` : url;
}

export function localResource(path: string | undefined): string {
  return `/local-resource?url=${encodeURIComponent(path || '')}`;
}
