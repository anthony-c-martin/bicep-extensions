import { BicepType, ObjectProperty, TypeReference, resolvePointer } from './bicep-types.js';

export interface ResolvedType {
  type: BicepType;
  file: string;
  index: number;
}

/** Resolves `$ref` pointers across the type files returned by an extension. */
export class TypeResolver {
  constructor(private readonly files: Record<string, BicepType[]>) {}

  get defaultFile(): string {
    return Object.keys(this.files)[0];
  }

  resolve(reference: TypeReference | undefined, currentFile: string): ResolvedType | undefined {
    const pointer = resolvePointer(reference);
    if (!pointer) {
      return undefined;
    }
    const file = pointer.file ?? currentFile;
    const types = this.files[file];
    const type = types?.[pointer.index];
    return type ? { type, file, index: pointer.index } : undefined;
  }
}

/** An object type that needs its own section on a page. */
export interface NestedSection {
  key: string;
  anchor: string;
  title: string;
  resolved: ResolvedType;
}

/**
 * Tracks the object types referenced while rendering a page so that each one
 * can be emitted as its own section, and links can point at stable anchors.
 */
export class PageContext {
  private readonly sections = new Map<string, NestedSection>();
  private readonly anchors = new Set<string>();
  private readonly queue: NestedSection[] = [];

  constructor(private readonly resolver: TypeResolver) {}

  private uniqueAnchor(base: string): string {
    const slug = slugify(base) || 'type';
    if (!this.anchors.has(slug)) {
      this.anchors.add(slug);
      return slug;
    }
    let suffix = 2;
    while (this.anchors.has(`${slug}-${suffix}`)) {
      suffix++;
    }
    const anchor = `${slug}-${suffix}`;
    this.anchors.add(anchor);
    return anchor;
  }

  /** Registers an object type for rendering, returning its anchor. */
  register(resolved: ResolvedType, title: string): NestedSection {
    const key = `${resolved.file}#${resolved.index}`;
    const existing = this.sections.get(key);
    if (existing) {
      return existing;
    }

    const section: NestedSection = {
      key,
      anchor: this.uniqueAnchor(title),
      title,
      resolved,
    };
    this.sections.set(key, section);
    this.queue.push(section);
    return section;
  }

  /** Reserves an anchor that is rendered by hand, such as the root section. */
  reserveAnchor(base: string): string {
    return this.uniqueAnchor(base);
  }

  /** Marks a type as already rendered so it is not emitted twice. */
  markRendered(resolved: ResolvedType, anchor: string, title: string): void {
    const key = `${resolved.file}#${resolved.index}`;
    if (!this.sections.has(key)) {
      this.sections.set(key, { key, anchor, title, resolved });
    }
  }

  /** Drains the queue of object types discovered while rendering. */
  drain(): NestedSection[] {
    const drained: NestedSection[] = [];
    while (this.queue.length > 0) {
      drained.push(this.queue.shift()!);
    }
    return drained;
  }

  get typeResolver(): TypeResolver {
    return this.resolver;
  }
}

export function slugify(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Escapes characters that would break a Markdown table cell. */
export function escapeCell(value: string): string {
  return value
    .replace(/\|/g, '\\|')
    .replace(/</g, '&lt;')
    .replace(/\r?\n/g, ' ')
    .trim();
}

/**
 * Escapes text that originates from an extension's own type definitions.
 *
 * Descriptions are arbitrary prose and regularly contain Markdown-significant
 * characters — the Kubernetes types, for example, include literal `[text](/path)`
 * link syntax. Rendering those unescaped would emit real links to paths that do
 * not exist on this site, which fails the build's broken-link check.
 */
export function escapeDescription(value: string): string {
  return escapeCell(value)
    // Neutralise link and image syntax by escaping the brackets.
    .replace(/([[\]])/g, '\\$1')
    // Backticks would otherwise open an unbalanced code span.
    .replace(/`/g, '\\`');
}

function inlineCode(value: string): string {
  // Use extra backticks when the content itself contains one.
  const fence = value.includes('`') ? '``' : '`';
  const padding = value.startsWith('`') || value.endsWith('`') ? ' ' : '';
  return `${fence}${padding}${value}${padding}${fence}`;
}

function isObjectLike(type: BicepType): boolean {
  return type.$type === 'ObjectType' || type.$type === 'DiscriminatedObjectType';
}

/**
 * Intermediate rendering result. Primitive types are plain text that gets
 * wrapped in inline code, while object types are already-formatted Markdown
 * links that must not be wrapped.
 */
interface RenderedType {
  text: string;
  isLink: boolean;
  /** True for a union of two or more members, which needs parentheses when suffixed. */
  isUnion?: boolean;
}

/** Guards against cycles in array and union types, which are representable in the type graph. */
const MAX_TYPE_DEPTH = 6;

/**
 * Collects the members of a union, flattening nested unions and discarding
 * `null`. A nullable property is already conveyed by the absence of the
 * `Required` attribute, so listing `null` alongside the real values is noise.
 */
function collectUnionMembers(
  elements: TypeReference[],
  currentFile: string,
  context: PageContext,
  depth: number,
  seen: Set<string>,
): RenderedType[] {
  const members: RenderedType[] = [];

  for (const element of elements) {
    const resolved = context.typeResolver.resolve(element, currentFile);
    if (!resolved) {
      continue;
    }

    if (resolved.type.$type === 'NullType') {
      continue;
    }

    if (resolved.type.$type === 'UnionType' && depth <= MAX_TYPE_DEPTH) {
      const key = `${resolved.file}#${resolved.index}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      members.push(
        ...collectUnionMembers(resolved.type.elements ?? [], resolved.file, context, depth + 1, seen),
      );
      continue;
    }

    members.push(renderInternal(element, currentFile, context, depth + 1));
  }

  return members;
}

function renderInternal(
  reference: TypeReference | undefined,
  currentFile: string,
  context: PageContext,
  depth: number,
): RenderedType {
  const resolved = context.typeResolver.resolve(reference, currentFile);
  if (!resolved) {
    return { text: 'unknown', isLink: false };
  }

  if (depth > MAX_TYPE_DEPTH) {
    return { text: '...', isLink: false };
  }

  const { type } = resolved;

  switch (type.$type) {
    case 'StringType':
      // Sensitivity is surfaced as a property attribute rather than baked into
      // the type name, so the type column stays comparable across properties.
      return { text: 'string', isLink: false };
    case 'IntegerType':
      return { text: 'int', isLink: false };
    case 'BooleanType':
      return { text: 'bool', isLink: false };
    case 'NullType':
      return { text: 'null', isLink: false };
    case 'AnyType':
      return { text: 'any', isLink: false };
    case 'StringLiteralType':
      return { text: `'${type.value}'`, isLink: false };
    case 'ArrayType': {
      const item = renderInternal(type.itemType, resolved.file, context, depth + 1);
      // A union item must be bracketed so the suffix applies to the whole union.
      if (item.isUnion) {
        return { text: `(${item.text})[]`, isLink: true };
      }
      return { text: `${item.text}[]`, isLink: item.isLink };
    }
    case 'UnionType': {
      const members = collectUnionMembers(
        type.elements ?? [],
        resolved.file,
        context,
        depth,
        new Set([`${resolved.file}#${resolved.index}`]),
      );

      if (members.length === 0) {
        // Everything was discarded, so `null` was the only permitted value.
        return { text: 'null', isLink: false };
      }
      if (members.length === 1) {
        return members[0];
      }

      // Each member gets its own code span so the cell can wrap between values
      // rather than overflowing as one unbreakable run. Pipes are escaped to
      // survive the surrounding Markdown table.
      const parts = members.map(member => (member.isLink ? member.text : inlineCode(member.text)));
      return { text: parts.join(' \\| '), isLink: true, isUnion: true };
    }
    case 'ResourceFunctionType':
      return { text: type.name ?? 'function', isLink: false };
    default:
      if (isObjectLike(type)) {
        if (!type.name) {
          return { text: 'object', isLink: false };
        }
        const section = context.register(resolved, type.name);
        return { text: `[${escapeCell(type.name)}](#${section.anchor})`, isLink: true };
      }
      return { text: type.$type.replace(/Type$/, '').toLowerCase(), isLink: false };
  }
}

/**
 * Reports whether a property's type is marked sensitive, so the table can show
 * it as an attribute. Arrays and unions are unwrapped so a sensitive value is
 * still flagged when it is nested inside one.
 */
export function isSensitive(
  reference: TypeReference | undefined,
  currentFile: string,
  context: PageContext,
  depth = 0,
): boolean {
  const resolved = context.typeResolver.resolve(reference, currentFile);
  if (!resolved || depth > MAX_TYPE_DEPTH) {
    return false;
  }

  const { type } = resolved;
  if (type.sensitive) {
    return true;
  }

  if (type.$type === 'ArrayType') {
    return isSensitive(type.itemType, resolved.file, context, depth + 1);
  }
  if (type.$type === 'UnionType') {
    return (type.elements ?? []).some(element =>
      isSensitive(element, resolved.file, context, depth + 1),
    );
  }
  return false;
}

/**
 * Renders a type as a short Markdown expression. Named object types become
 * links to their section on the same page; everything else is inline code.
 */
export function renderTypeExpression(
  reference: TypeReference | undefined,
  currentFile: string,
  context: PageContext,
): string {
  const rendered = renderInternal(reference, currentFile, context, 0);
  return rendered.isLink ? rendered.text : inlineCode(rendered.text);
}

const FLAG_DESCRIPTIONS: Record<string, string> = {
  Required: 'Required',
  ReadOnly: 'Read-only',
  WriteOnly: 'Write-only',
  DeployTimeConstant: 'Deploy-time constant',
  Identifier: 'Identifier',
  Sensitive: 'Sensitive',
};

export function renderFlags(flags: string[]): string {
  return flags.map(flag => FLAG_DESCRIPTIONS[flag] ?? flag).join(', ');
}

export interface PropertyRow {
  name: string;
  property: ObjectProperty;
}

/** Sorts required properties first, then alphabetically. */
export function sortProperties(properties: Record<string, ObjectProperty>): PropertyRow[] {
  return Object.entries(properties)
    .map(([name, property]) => ({ name, property }))
    .sort((a, b) => {
      const aRequired = (a.property.flags ?? 0) & 1;
      const bRequired = (b.property.flags ?? 0) & 1;
      if (aRequired !== bRequired) {
        return bRequired - aRequired;
      }
      return a.name.localeCompare(b.name);
    });
}
