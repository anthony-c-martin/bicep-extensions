import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export interface SampleConfigEntry {
  title: string;
  description?: string;
  url: string;
}

export interface ExtensionConfigEntry {
  id: string;
  displayName: string;
  description: string;
  repository: string;
  artifact: string;
  communityContributed: boolean;
  publisher?: string;
  category?: string;
  tags?: string[];
  license?: string;
  samples?: SampleConfigEntry[];
  docsUrl?: string;
}

export const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
export const configPath = fileURLToPath(new URL('../../extensions.json', import.meta.url));
export const generatedDir = fileURLToPath(new URL('../../generated', import.meta.url));
export const proseDir = fileURLToPath(new URL('../../docs/extensions', import.meta.url));
export const websiteDir = fileURLToPath(new URL('../../website', import.meta.url));

export async function loadCatalogue(): Promise<ExtensionConfigEntry[]> {
  const raw = await readFile(configPath, 'utf8');
  const parsed = JSON.parse(raw) as { extensions?: ExtensionConfigEntry[] };
  const extensions = parsed.extensions ?? [];

  const seen = new Set<string>();
  for (const extension of extensions) {
    for (const field of ['id', 'displayName', 'description', 'repository', 'artifact'] as const) {
      if (!extension[field]) {
        throw new Error(`Extension '${extension.id ?? '(unknown)'}' is missing required field '${field}'.`);
      }
    }
    if (typeof extension.communityContributed !== 'boolean') {
      throw new Error(
        `Extension '${extension.id ?? '(unknown)'}' is missing required boolean field 'communityContributed'.`,
      );
    }
    if (seen.has(extension.id)) {
      throw new Error(`Duplicate extension id '${extension.id}' in extensions.json.`);
    }
    seen.add(extension.id);
  }

  return extensions;
}
