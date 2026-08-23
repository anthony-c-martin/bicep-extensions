import { SampleConfigEntry } from './config.js';

export interface FetchedSample {
  title: string;
  description?: string;
  /** The original, human-facing URL. */
  url: string;
  /** Contents of the .bicep file at the time types were refreshed. */
  content: string;
}

/**
 * Resolves a browsable GitHub URL to the raw file content endpoint. Other URLs
 * are returned unchanged, so raw links and non-GitHub hosts also work.
 */
export function toRawUrl(url: string): string {
  const blob = url.match(
    /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/(.+)$/,
  );
  if (blob) {
    const [, owner, repo, rest] = blob;
    return `https://raw.githubusercontent.com/${owner}/${repo}/${rest}`;
  }
  return url;
}

async function fetchSample(sample: SampleConfigEntry): Promise<FetchedSample> {
  const rawUrl = toRawUrl(sample.url);
  const response = await fetch(rawUrl, {
    headers: { Accept: 'text/plain' },
  });

  if (!response.ok) {
    throw new Error(
      `Failed to fetch sample '${sample.title}' from ${rawUrl} (${response.status} ${response.statusText}).`,
    );
  }

  const content = (await response.text()).replace(/\r\n/g, '\n').trimEnd();
  if (content.length === 0) {
    throw new Error(`Sample '${sample.title}' at ${rawUrl} is empty.`);
  }

  return {
    title: sample.title,
    description: sample.description,
    url: sample.url,
    content,
  };
}

/** Fetches every sample declared for an extension, preserving their order. */
export async function fetchSamples(samples: SampleConfigEntry[] = []): Promise<FetchedSample[]> {
  if (samples.length === 0) {
    return [];
  }
  return Promise.all(samples.map(fetchSample));
}
