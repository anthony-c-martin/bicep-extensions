import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { ExtensionConfigEntry, generatedDir, loadCatalogue } from './config.js';
import { FetchedSample, fetchSamples } from './samples.js';
import { extractTypeFiles } from './grpc.js';
import {
  assertBicepExtension,
  currentArchitecture,
  findBinaryLayer,
  parseArtifact,
  RegistryClient,
} from './oci.js';
import { SerializedTypeFile, TypeIndex } from './bicep-types.js';

/** Shape of the files written to `generated/`. */
export interface GeneratedExtension {
  id: string;
  version: string;
  artifact: string;
  digest: string;
  extractedAt: string;
  settings: TypeIndex['settings'];
  resources: TypeIndex['resources'];
  resourceFunctions: TypeIndex['resourceFunctions'];
  /**
   * Type declarations exactly as the extension returned them, keyed by the file
   * name that index pointers refer to. Kept in the serialized wire form so the
   * committed data stays a faithful record of the `GetTypeFiles` response.
   */
  typeFiles: Record<string, SerializedTypeFile>;
  /** Example Bicep files declared in extensions.json, fetched at refresh time. */
  samples: FetchedSample[];
}

function formatBytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Despite its name, the `indexFile` field carries the *content* of the index
 * rather than a path to it; Bicep writes it verbatim to `index.json` when
 * publishing. The `typeFiles` map holds the remaining files, keyed by the
 * relative path that type pointers such as `types.json#/4` refer to.
 */
function parseTypeFiles(indexFile: string, typeFiles: Record<string, string>) {
  const index = JSON.parse(indexFile) as TypeIndex;

  const parsed: Record<string, SerializedTypeFile> = {};
  // The response is a gRPC map, whose iteration order is not stable between
  // calls. Sorting keeps the committed file byte-stable so a refresh only
  // produces a diff when the types themselves have actually changed.
  for (const name of Object.keys(typeFiles).sort()) {
    if (name === 'index.json') {
      continue;
    }
    parsed[name] = JSON.parse(typeFiles[name]) as SerializedTypeFile;
  }

  if (Object.keys(parsed).length === 0) {
    throw new Error('The extension did not return any type files.');
  }

  return { index, typeFiles: parsed };
}

/** Returns the entries of a record ordered by key, for byte-stable output. */
function sortKeys<T>(record: Record<string, T> | undefined): Record<string, T> {
  return Object.fromEntries(Object.entries(record ?? {}).sort(([a], [b]) => a.localeCompare(b)));
}

async function refreshExtension(
  extension: ExtensionConfigEntry,
  architecture: string,
): Promise<GeneratedExtension> {
  const ref = parseArtifact(extension.artifact);
  const client = new RegistryClient(ref);

  const version = await client.resolveLatestVersion();
  console.log(`  resolved latest version ${version}`);

  const manifest = await client.getManifest(version);
  assertBicepExtension(manifest, extension.artifact);

  const config = await client.getConfig(manifest);
  const binaryLayer = findBinaryLayer(manifest, architecture);

  if (!binaryLayer) {
    const available = manifest.layers
      .map(layer => layer.mediaType.match(/layer\.v1\.(.+)\.binary$/)?.[1])
      .filter(Boolean);
    const reason = config.localDeployEnabled
      ? `it does not publish a '${architecture}' binary (available: ${available.join(', ') || 'none'})`
      : 'it is a types-only extension that does not support local deployment';
    throw new Error(`Cannot inspect '${extension.id}' because ${reason}.`);
  }

  console.log(`  downloading ${architecture} binary (${formatBytes(binaryLayer.size)})`);
  const binary = await client.getBlob(binaryLayer.digest);

  console.log('  starting extension and calling GetTypeFiles');
  const response = await extractTypeFiles({ binary });
  const { index, typeFiles } = parseTypeFiles(response.indexFile, response.typeFiles);

  console.log(`  found ${Object.keys(index.resources ?? {}).length} resource types`);

  const samples = await fetchSamples(extension.samples);
  if (samples.length > 0) {
    console.log(`  fetched ${samples.length} sample(s)`);
  }

  return {
    id: extension.id,
    version,
    artifact: extension.artifact,
    digest: binaryLayer.digest,
    // Recorded so the site can show when reference content was last refreshed.
    extractedAt: new Date().toISOString(),
    settings: index.settings,
    resources: sortKeys(index.resources),
    resourceFunctions: sortKeys(index.resourceFunctions),
    typeFiles,
    samples,
  };
}

/** Removes generated files for extensions that are no longer in the catalogue. */
async function pruneStaleFiles(validIds: Set<string>): Promise<void> {
  const entries = await readdir(generatedDir).catch(() => [] as string[]);
  for (const entry of entries) {
    if (!entry.endsWith('.json')) {
      continue;
    }
    if (!validIds.has(path.basename(entry, '.json'))) {
      console.log(`Removing stale ${entry}`);
      await rm(path.join(generatedDir, entry));
    }
  }
}

/**
 * Writes the extracted types, but leaves the file untouched when only the
 * extraction timestamp would change. Without this every refresh would produce a
 * diff, and the refresh workflow could not tell a real change from a no-op.
 */
async function writeIfChanged(target: string, generated: GeneratedExtension): Promise<boolean> {
  const existing = await readFile(target, 'utf8')
    .then(content => JSON.parse(content) as GeneratedExtension)
    .catch(() => undefined);

  if (existing) {
    const withPreviousTimestamp = { ...generated, extractedAt: existing.extractedAt };
    if (JSON.stringify(withPreviousTimestamp) === JSON.stringify(existing)) {
      return false;
    }
  }

  await writeFile(target, `${JSON.stringify(generated, null, 2)}\n`);
  return true;
}

/**
 * Re-fetches only the samples for an extension, reusing the type data already
 * committed. Sample metadata changes far more often than an extension's types,
 * and this avoids downloading and running a binary just to update a caption.
 */
async function refreshSamplesOnly(extension: ExtensionConfigEntry): Promise<GeneratedExtension> {
  const target = path.join(generatedDir, `${extension.id}.json`);
  const existing = await readFile(target, 'utf8')
    .then(content => JSON.parse(content) as GeneratedExtension)
    .catch(() => undefined);

  if (!existing) {
    throw new Error(
      `No existing type data for '${extension.id}'. Run a full refresh before using --samples-only.`,
    );
  }

  const samples = await fetchSamples(extension.samples);
  console.log(`  fetched ${samples.length} sample(s)`);
  return { ...existing, samples };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const samplesOnly = args.includes('--samples-only');
  const requested = args.filter(arg => !arg.startsWith('-'));
  const catalogue = await loadCatalogue();
  const architecture = currentArchitecture();

  const selected = requested.length > 0
    ? catalogue.filter(extension => requested.includes(extension.id))
    : catalogue;

  if (requested.length > 0 && selected.length !== requested.length) {
    const missing = requested.filter(id => !catalogue.some(extension => extension.id === id));
    throw new Error(`Unknown extension id(s): ${missing.join(', ')}`);
  }

  console.log(
    samplesOnly
      ? `Refreshing samples for ${selected.length} extension(s)\n`
      : `Refreshing ${selected.length} extension(s) for ${architecture}\n`,
  );
  await mkdir(generatedDir, { recursive: true });

  const failures: Array<{ id: string; error: unknown }> = [];

  for (const extension of selected) {
    console.log(`${extension.displayName} (${extension.id})`);
    try {
      const generated = samplesOnly
        ? await refreshSamplesOnly(extension)
        : await refreshExtension(extension, architecture);
      const target = path.join(generatedDir, `${extension.id}.json`);
      const changed = await writeIfChanged(target, generated);
      console.log(
        changed
          ? `  wrote ${path.relative(process.cwd(), target)}\n`
          : `  no change to ${path.relative(process.cwd(), target)}\n`,
      );
    } catch (error) {
      console.error(`  FAILED: ${(error as Error).message}\n`);
      failures.push({ id: extension.id, error });
    }
  }

  if (requested.length === 0) {
    await pruneStaleFiles(new Set(catalogue.map(extension => extension.id)));
  }

  if (failures.length > 0) {
    console.error(`${failures.length} extension(s) failed: ${failures.map(f => f.id).join(', ')}`);
    process.exitCode = 1;
    return;
  }

  console.log('All extensions refreshed successfully.');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
