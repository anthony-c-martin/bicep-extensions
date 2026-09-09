import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  BicepType,
  IndexTypeReference,
  ObjectTypeProperty,
  TypeBaseKind,
  describePropertyFlags,
  discriminatedElements,
  parseTypeFile,
} from './bicep-types.js';
import { ExtensionConfigEntry, generatedDir, loadCatalogue, proseDir, websiteDir } from './config.js';
import type { GeneratedExtension } from './refresh.js';
import type { FetchedSample } from './samples.js';
import {
  PageContext,
  TypeResolver,
  escapeCell,
  escapeDescription,
  isSensitive,
  renderFlags,
  renderTypeExpression,
  slugify,
  sortProperties,
} from './render.js';

const outputDir = path.join(websiteDir, 'docs', 'extensions');

/** Sub-directories created beneath each extension. */
const SAMPLES_DIR = 'samples';
const REFERENCE_DIR = 'reference';

interface ExtensionData {
  config: ExtensionConfigEntry;
  generated: GeneratedExtension;
  resolver: TypeResolver;
  prose?: string;
}

/** Bicep alias used in `extension <alias>` statements. */
function extensionAlias(data: ExtensionData): string {
  return data.generated.settings?.name ?? data.config.id;
}

function frontmatter(fields: Record<string, string | number | null | undefined>): string {
  const lines = Object.entries(fields)
    .filter(([, value]) => value !== undefined && value !== '')
    .map(([key, value]) => {
      // `null` disables features such as pagination, and must stay unquoted.
      if (value === null) {
        return `${key}: null`;
      }
      if (typeof value === 'number') {
        return `${key}: ${value}`;
      }
      const escaped = String(value).replace(/"/g, '\\"');
      return `${key}: "${escaped}"`;
    });
  return `---\n${lines.join('\n')}\n---\n`;
}

/** Turns a resource type name such as `Deployment@v1` into a file slug. */
function resourceSlug(name: string): string {
  return (
    name
      .replace(/@/g, '-')
      .replace(/[/.]/g, '-')
      .replace(/[^A-Za-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .toLowerCase() || 'resource'
  );
}

/**
 * Splits a resource type into the group it belongs to and its leaf name.
 *
 * Extensions such as Kubernetes namespace their types by API group, for example
 * `apps/Deployment@v1`. Those become a folder per group so the sidebar stays
 * navigable; types without a `/` sit directly under the reference folder.
 */
function splitResourceName(name: string): { group?: string; leaf: string } {
  const separator = name.lastIndexOf('/');
  if (separator < 0) {
    return { leaf: name };
  }
  return { group: name.slice(0, separator), leaf: name.slice(separator + 1) };
}

function renderPropertyTable(
  properties: Record<string, ObjectTypeProperty>,
  currentFile: string,
  context: PageContext,
): string {
  const rows = sortProperties(properties);
  if (rows.length === 0) {
    return '_This type has no properties._\n';
  }

  const lines = ['| Property | Type | Attributes | Description |', '| --- | --- | --- | --- |'];
  for (const { name, property } of rows) {
    const type = renderTypeExpression(property.type, currentFile, context);
    const attributes = describePropertyFlags(property.flags);
    if (isSensitive(property.type, currentFile, context)) {
      attributes.push('Sensitive');
    }
    const description = property.description ? escapeDescription(property.description) : '';
    lines.push(
      `| \`${escapeCell(name)}\` | ${type} | ${renderFlags(attributes)} | ${description} |`,
    );
  }
  return `${lines.join('\n')}\n`;
}

/**
 * Renders an object type's body: its property table, plus a note about any
 * additional properties it accepts.
 */
function renderObjectBody(type: BicepType, currentFile: string, context: PageContext): string {
  const sections: string[] = [];

  // A discriminated object selects its shape from a property's value, so it
  // carries `baseProperties` and `elements` instead of a flat `properties` map.
  if (type.type === TypeBaseKind.DiscriminatedObjectType) {
    sections.push(
      `The shape of this type is determined by the \`${escapeCell(type.discriminator)}\` property.\n`,
    );

    if (Object.keys(type.baseProperties).length > 0) {
      sections.push(renderPropertyTable(type.baseProperties, currentFile, context));
    }

    const variants = Object.entries(discriminatedElements(type));
    if (variants.length > 0) {
      const rows = [`| \`${escapeCell(type.discriminator)}\` | Shape |`, '| --- | --- |'];
      for (const [value, element] of variants) {
        rows.push(
          `| \`'${escapeCell(value)}'\` | ${renderTypeExpression(element, currentFile, context)} |`,
        );
      }
      sections.push(`${rows.join('\n')}\n`);
    }
    return sections.join('\n');
  }

  if (type.type !== TypeBaseKind.ObjectType) {
    return '_Type information is unavailable._\n';
  }

  if (Object.keys(type.properties).length > 0) {
    sections.push(renderPropertyTable(type.properties, currentFile, context));
  } else if (!type.additionalProperties) {
    sections.push('_This type has no properties._\n');
  }

  if (type.additionalProperties) {
    const additional = renderTypeExpression(type.additionalProperties, currentFile, context);
    sections.push(`Additional properties of type ${additional} are allowed.\n`);
  }

  return sections.join('\n');
}

/** Emits a section for every nested object type discovered while rendering. */
function renderNestedSections(context: PageContext): string {
  const sections: string[] = [];
  let pending = context.drain();

  while (pending.length > 0) {
    for (const section of pending) {
      const { type, file } = section.resolved;
      sections.push(`## ${escapeCell(section.title)} {#${section.anchor}}\n`);
      sections.push(renderObjectBody(type, file, context));
    }
    // Rendering a section can reference further object types.
    pending = context.drain();
  }

  return sections.join('\n');
}

function renderInstallation(data: ExtensionData): string {
  const alias = extensionAlias(data);
  const { artifact, version } = data.generated;

  return [
    'Register the extension in `bicepconfig.json`:',
    '',
    '```json',
    JSON.stringify(
      {
        experimentalFeaturesEnabled: { localDeploy: true, ociEnabled: true },
        // Bicep implicitly includes the `az` extension; an empty array opts out.
        implicitExtensions: [],
        extensions: { [alias]: `br:${artifact}:${version}` },
      },
      null,
      2,
    ),
    '```',
    '',
    'Then reference it from your Bicep file:',
    '',
    '```bicep',
    `extension ${alias}`,
    '```',
    '',
  ].join('\n');
}

function renderConfiguration(data: ExtensionData, context: PageContext): string {
  const resolved = data.resolver.resolveFromIndex(data.generated.settings?.configurationType);
  if (!resolved || resolved.type.type !== TypeBaseKind.ObjectType) {
    return '';
  }

  const alias = extensionAlias(data);
  const lines = [
    '## Configuration\n',
    `Configuration is supplied using \`extension ${alias} with { ... }\`.\n`,
    renderPropertyTable(resolved.type.properties, resolved.file, context),
  ];

  // The configuration object is documented inline, so don't repeat it below.
  context.markRendered(resolved, 'configuration', resolved.type.name ?? 'Configuration');
  return lines.join('\n');
}

interface ResourcePage {
  /** Path relative to the reference folder, without the `.md` extension. */
  path: string;
  title: string;
  group?: string;
}

async function generateResourcePage(
  data: ExtensionData,
  resourceName: string,
  reference: IndexTypeReference,
): Promise<ResourcePage> {
  const context = new PageContext(data.resolver);
  const resolved = data.resolver.resolveFromIndex(reference);
  const resourceType = resolved?.type;
  const body =
    resourceType?.type === TypeBaseKind.ResourceType
      ? data.resolver.resolve(resourceType.body, resolved!.file)
      : undefined;

  const { group, leaf } = splitResourceName(resourceName);
  const relativePath = group ? `${resourceSlug(group)}/${resourceSlug(leaf)}` : resourceSlug(leaf);
  const bodyFile = body?.file ?? data.resolver.defaultFile;

  // Reserve the properties anchor so nested sections cannot claim it.
  context.reserveAnchor('properties');
  if (body) {
    context.markRendered(body, 'properties', resourceName);
  }

  const parts: string[] = [];
  parts.push(
    frontmatter({
      title: resourceName,
      // The folder already shows the group, so the sidebar shows just the leaf.
      sidebar_label: leaf,
      description: `${resourceName} resource type in the ${data.config.displayName} Bicep extension.`,
      pagination_prev: null,
      pagination_next: null,
    }),
  );

  // The breadcrumb and sidebar already establish which extension this belongs
  // to, so the page goes straight from its title into the property reference.
  parts.push(`# ${escapeCell(resourceName)}\n`);

  parts.push('## Properties {#properties}\n');
  parts.push(body ? renderObjectBody(body.type, bodyFile, context) : '_Type information is unavailable._\n');

  const nested = renderNestedSections(context);
  if (nested.trim().length > 0) {
    parts.push(nested);
  }

  const target = path.join(outputDir, data.config.id, REFERENCE_DIR, `${relativePath}.md`);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${parts.join('\n')}`);

  return { path: relativePath, title: resourceName, group };
}

/** Derives a stable page slug for a sample, preferring its folder name. */
function sampleSlug(sample: FetchedSample, taken: Set<string>): string {
  const fromUrl = sample.url.match(/\/samples\/([^/]+)\//)?.[1];
  const base = slugify(fromUrl ?? sample.title) || 'sample';

  let slug = base;
  let suffix = 2;
  while (taken.has(slug)) {
    slug = `${base}-${suffix++}`;
  }
  taken.add(slug);
  return slug;
}

/** Writes one page per sample, plus an index listing them. */
async function generateSamplePages(
  data: ExtensionData,
  samples: FetchedSample[],
): Promise<void> {
  const directory = path.join(outputDir, data.config.id, SAMPLES_DIR);
  await mkdir(directory, { recursive: true });

  await writeFile(
    path.join(directory, '_category_.json'),
    `${JSON.stringify(
      {
        label: 'Samples',
        position: 1,
        link: { type: 'doc', id: `extensions/${data.config.id}/${SAMPLES_DIR}/index` },
      },
      null,
      2,
    )}\n`,
  );

  const taken = new Set<string>();
  const entries: Array<{ slug: string; sample: FetchedSample }> = [];

  for (const sample of samples) {
    entries.push({ slug: sampleSlug(sample, taken), sample });
  }

  for (const { slug, sample } of entries) {
    const parts: string[] = [];
    parts.push(
      frontmatter({
        title: sample.title,
        sidebar_label: sample.title,
        description: sample.description,
        pagination_prev: null,
        pagination_next: null,
      }),
    );
    parts.push(`# ${escapeCell(sample.title)}\n`);
    if (sample.description) {
      parts.push(`${sample.description}\n`);
    }

    // Samples assume the extension is already registered, so point at the
    // installation instructions before the reader copies any code.
    parts.push(
      `_Requires the ${escapeCell(data.config.displayName)} extension to be registered in ` +
        `\`bicepconfig.json\` — see [Installation](../index.md#installation)._\n`,
    );

    parts.push('```bicep');
    parts.push(sample.content);
    parts.push('```\n');
    parts.push(`[View on GitHub](${sample.url})\n`);

    await writeFile(path.join(directory, `${slug}.md`), parts.join('\n'));
  }

  const index: string[] = [];
  index.push(
    frontmatter({
      title: `${data.config.displayName} samples`,
      sidebar_label: 'Overview',
      description: `Example Bicep files using the ${data.config.displayName} extension.`,
      pagination_prev: null,
      pagination_next: null,
    }),
  );
  index.push('# Samples\n');
  index.push(
    `Example Bicep files that use the [${data.config.displayName}](../index.md) extension. ` +
      'Each is taken directly from the extension\'s repository.\n',
  );
  const rows = ['| Sample | Description |', '| --- | --- |'];
  for (const { slug, sample } of entries) {
    rows.push(
      `| [${escapeCell(sample.title)}](./${slug}.md) | ${escapeCell(sample.description ?? '')} |`,
    );
  }
  index.push(`${rows.join('\n')}\n`);

  await writeFile(path.join(directory, 'index.md'), index.join('\n'));
}

/** Writes the category metadata and index page for an extension's reference. */
async function generateReferenceIndex(
  data: ExtensionData,
  resources: ResourcePage[],
): Promise<void> {
  const directory = path.join(outputDir, data.config.id, REFERENCE_DIR);
  await mkdir(directory, { recursive: true });

  await writeFile(
    path.join(directory, '_category_.json'),
    `${JSON.stringify(
      {
        label: 'Reference',
        position: 2,
        link: { type: 'doc', id: `extensions/${data.config.id}/${REFERENCE_DIR}/index` },
      },
      null,
      2,
    )}\n`,
  );

  // Group folders are labelled with the API group they represent, and sorted
  // alphabetically so the sidebar order is predictable.
  const groups = [...new Set(resources.map(resource => resource.group).filter(Boolean))].sort() as string[];
  for (const [position, group] of groups.entries()) {
    await writeFile(
      path.join(directory, resourceSlug(group), '_category_.json'),
      `${JSON.stringify({ label: group, position: position + 1, collapsed: true }, null, 2)}\n`,
    );
  }

  const parts: string[] = [];
  parts.push(
    frontmatter({
      title: `${data.config.displayName} reference`,
      sidebar_label: 'Overview',
      description: `Resource types exposed by the ${data.config.displayName} extension.`,
      pagination_prev: null,
      pagination_next: null,
    }),
  );
  parts.push('# Reference\n');
  parts.push(
    `Resource types exposed by the [${data.config.displayName}](../index.md) extension, ` +
      `version \`${data.generated.version}\`.\n`,
  );

  const sorted = [...resources].sort((a, b) => a.title.localeCompare(b.title));
  const renderRows = (items: ResourcePage[]) => {
    const rows = ['| Resource type | Reference |', '| --- | --- |'];
    for (const item of items) {
      rows.push(`| \`${escapeCell(item.title)}\` | [View](./${item.path}.md) |`);
    }
    return `${rows.join('\n')}\n`;
  };

  if (groups.length === 0) {
    parts.push(renderRows(sorted));
  } else {
    const ungrouped = sorted.filter(resource => !resource.group);
    if (ungrouped.length > 0) {
      parts.push(renderRows(ungrouped));
    }
    for (const group of groups) {
      parts.push(`## ${escapeCell(group)}\n`);
      parts.push(renderRows(sorted.filter(resource => resource.group === group)));
    }
  }

  await writeFile(path.join(directory, 'index.md'), parts.join('\n'));
}

async function generateOverviewPage(
  data: ExtensionData,
  resources: ResourcePage[],
): Promise<void> {
  const context = new PageContext(data.resolver);
  const { config, generated } = data;

  const parts: string[] = [];
  parts.push(
    frontmatter({
      title: config.displayName,
      sidebar_label: config.displayName,
      sidebar_position: 0,
      description: config.description,
      pagination_prev: null,
      pagination_next: null,
    }),
  );

  parts.push(`# ${escapeCell(config.displayName)}\n`);
  parts.push(`${config.description}\n`);
  if (config.communityContributed) {
    parts.push(
      '<span className="community-badge" title="Community-maintained; not an official Bicep extension">Community Maintained</span>\n',
    );
  }

  const metadata = [
    '| | |',
    '| --- | --- |',
    `| **Version** | \`${generated.version}\` |`,
    `| **Artifact** | \`br:${generated.artifact}:${generated.version}\` |`,
    `| **Source** | [${escapeCell(config.repository.replace(/^https:\/\//, ''))}](${config.repository}) |`,
  ];
  if (config.publisher) {
    metadata.push(`| **Publisher** | ${escapeCell(config.publisher)} |`);
  }
  if (config.license) {
    metadata.push(`| **Licence** | ${escapeCell(config.license)} |`);
  }
  if (config.category) {
    metadata.push(`| **Category** | ${escapeCell(config.category)} |`);
  }
  parts.push(`${metadata.join('\n')}\n`);

  parts.push('## Installation\n');
  parts.push(renderInstallation(data));

  const configuration = renderConfiguration(data, context);
  if (configuration) {
    parts.push(configuration);
    const nested = renderNestedSections(context);
    if (nested.trim().length > 0) {
      parts.push(nested);
    }
  }

  if (data.prose) {
    parts.push(`${data.prose.trim()}\n`);
  }

  if (generated.samples?.length) {
    parts.push('## Samples\n');
    parts.push(
      `${generated.samples.length} example Bicep file${generated.samples.length === 1 ? '' : 's'} ` +
        `${generated.samples.length === 1 ? 'is' : 'are'} available under ` +
        `[Samples](./${SAMPLES_DIR}/index.md).\n`,
    );
  }

  parts.push('## Resource types\n');
  if (resources.length === 0) {
    parts.push(
      [
        ':::info',
        '',
        'This extension does not report any resource types over the Bicep extension gRPC',
        'interface. Extensions that generate their type definitions at publish time, rather',
        'than serving them from the running binary, cannot be catalogued here automatically.',
        `Refer to the [source repository](${config.repository}) for its resource types.`,
        '',
        ':::',
        '',
      ].join('\n'),
    );
  } else {
    parts.push(
      `This extension exposes ${resources.length} resource type${resources.length === 1 ? '' : 's'}, ` +
        `documented under [Reference](./${REFERENCE_DIR}/index.md).\n`,
    );
  }

  parts.push(
    `\n_Reference generated from \`${generated.artifact}:${generated.version}\` on ${new Date(
      generated.extractedAt,
    ).toISOString().slice(0, 10)}._\n`,
  );

  const page = parts.join('\n');

  // Prose is merged into a page that already has generated headings, so a
  // clashing heading would produce a duplicated entry in the table of contents.
  const headings = [...page.matchAll(/^## (.+?)(?: \{#.*\})?$/gm)].map(match => match[1].trim());
  const duplicates = headings.filter((heading, index) => headings.indexOf(heading) !== index);
  if (duplicates.length > 0) {
    throw new Error(
      `'${config.id}' has duplicate headings: ${[...new Set(duplicates)].join(', ')}. ` +
        `Rename the heading in docs/extensions/${config.id}.md.`,
    );
  }

  await writeFile(path.join(outputDir, config.id, 'index.md'), page);
}

/** Writes the landing page for the whole reference section. */
async function generateExtensionsIndex(
  summaries: Array<{ config: ExtensionConfigEntry; generated: GeneratedExtension; count: number }>,
): Promise<void> {
  const parts: string[] = [];
  parts.push(
    frontmatter({
      title: 'Catalogue',
      sidebar_label: 'Overview',
      sidebar_position: 0,
      description: 'Reference documentation for every extension in the catalogue.',
      pagination_prev: null,
      pagination_next: null,
    }),
  );

  parts.push('# Catalogue\n');
  parts.push(
    [
      'Reference documentation for every extension in the catalogue. Type information',
      'is extracted by running each published extension and calling the `GetTypeFiles`',
      'method of the Bicep extension gRPC interface.\n',
    ].join('\n'),
  );

  const byCategory = new Map<string, typeof summaries>();
  for (const summary of summaries) {
    const category = summary.config.category ?? 'Other';
    byCategory.set(category, [...(byCategory.get(category) ?? []), summary]);
  }

  for (const category of [...byCategory.keys()].sort()) {
    parts.push(`## ${escapeCell(category)}\n`);
    const rows = ['| Extension | Version | Resource types | Description |', '| --- | --- | --- | --- |'];
    const items = [...byCategory.get(category)!].sort((a, b) =>
      a.config.displayName.localeCompare(b.config.displayName),
    );
    for (const { config, generated, count } of items) {
      rows.push(
        `| [${escapeCell(config.displayName)}](./${config.id}/index.md) | \`${generated.version}\` | ${count} | ${escapeCell(config.description)} |`,
      );
    }
    parts.push(`${rows.join('\n')}\n`);
  }

  await writeFile(path.join(outputDir, 'index.md'), parts.join('\n'));
}

async function readProse(id: string): Promise<string | undefined> {
  try {
    return await readFile(path.join(proseDir, `${id}.md`), 'utf8');
  } catch {
    return undefined;
  }
}

async function main(): Promise<void> {
  const catalogue = await loadCatalogue();

  await rm(outputDir, { recursive: true, force: true });
  await mkdir(outputDir, { recursive: true });

  await writeFile(
    path.join(outputDir, '_category_.json'),
    `${JSON.stringify({ label: 'Catalogue', position: 2, collapsed: false }, null, 2)}\n`,
  );

  const summaries: Array<{ config: ExtensionConfigEntry; generated: GeneratedExtension; count: number }> = [];

  // The sidebar lists extensions alphabetically by display name, regardless of
  // the order they happen to appear in extensions.json.
  const sidebarPosition = new Map(
    [...catalogue]
      .sort((a, b) => a.displayName.localeCompare(b.displayName))
      .map((extension, index) => [extension.id, index + 1] as const),
  );

  for (const config of catalogue) {
    const generatedPath = path.join(generatedDir, `${config.id}.json`);
    let generated: GeneratedExtension;
    try {
      generated = JSON.parse(await readFile(generatedPath, 'utf8')) as GeneratedExtension;
    } catch {
      console.warn(`Skipping '${config.id}': no generated type data. Run 'npm run refresh' first.`);
      continue;
    }

    const data: ExtensionData = {
      config,
      generated,
      resolver: new TypeResolver(
        Object.fromEntries(
          Object.entries(generated.typeFiles).map(([name, types]) => [name, parseTypeFile(types)]),
        ),
      ),
      prose: await readProse(config.id),
    };

    await mkdir(path.join(outputDir, config.id), { recursive: true });

    // Gives the sidebar a friendly label instead of the folder name.
    await writeFile(
      path.join(outputDir, config.id, '_category_.json'),
      `${JSON.stringify(
        {
          label: config.displayName,
          position: sidebarPosition.get(config.id),
          collapsed: true,
        },
        null,
        2,
      )}\n`,
    );

    const resources: ResourcePage[] = [];
    if (Object.keys(generated.resources ?? {}).length > 0) {
      await mkdir(path.join(outputDir, config.id, REFERENCE_DIR), { recursive: true });
      for (const [resourceName, reference] of Object.entries(generated.resources ?? {})) {
        resources.push(await generateResourcePage(data, resourceName, reference));
      }
      await generateReferenceIndex(data, resources);
    }

    const samples = generated.samples ?? [];
    if (samples.length > 0) {
      await generateSamplePages(data, samples);
    }

    await generateOverviewPage(data, resources);
    summaries.push({ config, generated, count: resources.length });
    console.log(
      `${config.displayName}: ${resources.length} resource page(s), ${samples.length} sample page(s)`,
    );
  }

  await generateExtensionsIndex(summaries);

  // The catalogue homepage reads this to render its cards.
  const catalogueData = summaries.map(({ config, generated, count }) => ({
    ...config,
    version: generated.version,
    resourceCount: count,
    extractedAt: generated.extractedAt,
  }));

  await mkdir(path.join(websiteDir, 'src', 'data'), { recursive: true });
  await writeFile(
    path.join(websiteDir, 'src', 'data', 'catalogue.json'),
    `${JSON.stringify(catalogueData, null, 2)}\n`,
  );

  console.log(`\nGenerated documentation for ${summaries.length} extension(s).`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
