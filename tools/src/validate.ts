import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import Ajv from 'ajv';
import addFormats from 'ajv-formats';

import { configPath, generatedDir, loadCatalogue, proseDir } from './config.js';

const schemaPath = fileURLToPath(new URL('../../schemas/extensions.schema.json', import.meta.url));

async function exists(target: string): Promise<boolean> {
  try {
    await readFile(target);
    return true;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const problems: string[] = [];
  const warnings: string[] = [];

  const schema = JSON.parse(await readFile(schemaPath, 'utf8'));
  const document = JSON.parse(await readFile(configPath, 'utf8'));

  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);

  const validate = ajv.compile(schema);
  if (!validate(document)) {
    for (const error of validate.errors ?? []) {
      problems.push(`extensions.json${error.instancePath}: ${error.message}`);
    }
  }

  const catalogue = await loadCatalogue();
  const ids = new Set(catalogue.map(extension => extension.id));

  for (const extension of catalogue) {
    if (!(await exists(path.join(generatedDir, `${extension.id}.json`)))) {
      warnings.push(
        `'${extension.id}' has no generated type data. Run: npm run refresh -- ${extension.id}`,
      );
    }
    if (!(await exists(path.join(proseDir, `${extension.id}.md`)))) {
      warnings.push(`'${extension.id}' has no prose at docs/extensions/${extension.id}.md`);
    }
  }

  // Files left behind when an extension is removed from the catalogue would
  // otherwise linger unnoticed, since nothing reads them.
  for (const [directory, extension, label] of [
    [generatedDir, '.json', 'generated'],
    [proseDir, '.md', 'docs/extensions'],
  ] as const) {
    const entries = await readdir(directory).catch(() => [] as string[]);
    for (const entry of entries) {
      if (!entry.endsWith(extension)) {
        continue;
      }
      const id = path.basename(entry, extension);
      if (!ids.has(id)) {
        problems.push(`${label}/${entry} does not match any extension in extensions.json.`);
      }
    }
  }

  for (const warning of warnings) {
    console.warn(`warning: ${warning}`);
  }

  if (problems.length > 0) {
    for (const problem of problems) {
      console.error(`error: ${problem}`);
    }
    console.error(`\n${problems.length} validation error(s).`);
    process.exit(1);
  }

  console.log(`extensions.json is valid (${catalogue.length} extension(s)).`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
