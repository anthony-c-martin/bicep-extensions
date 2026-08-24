/**
 * Adapter over the `bicep-types` package, which owns the canonical definition
 * of Bicep's serialized type format.
 *
 * The package models the contents of a single type file: `readTypesJson` turns
 * the serialized `$type`/`$ref` form into its in-memory model, where references
 * carry only an index. Everything in this module covers what sits outside that
 * scope — the type index, whose references may point across files.
 */
import type { BicepType, ObjectTypeProperty, TypeReference } from 'bicep-types';
import {
  ObjectTypePropertyFlags,
  ScopeType,
  TypeBaseKind,
  getObjectTypePropertyFlagsLabels,
  getScopeTypeLabels,
  readTypesJson,
} from 'bicep-types';

export type { BicepType, ObjectTypeProperty, TypeReference };
export { ObjectTypePropertyFlags, ScopeType, TypeBaseKind, readTypesJson };

/**
 * A type file in its serialized form, as returned by `GetTypeFiles` and stored
 * under `generated/`. Use `parseTypeFile` to turn it into the canonical model.
 */
export type SerializedTypeFile = unknown[];

/** Parses a stored type file into the canonical `bicep-types` model. */
export function parseTypeFile(types: SerializedTypeFile): BicepType[] {
  // Some extension SDK versions emit null for omitted optional properties, but
  // the bicep-types reviver assumes every JSON object is non-null.
  return readTypesJson(JSON.stringify(types, function (_key, value) {
    return value === null && !Array.isArray(this) ? undefined : value;
  }));
}

/**
 * A reference as it appears in the type index, which may name another file.
 * Within a type file every reference is local, so the package's `TypeReference`
 * is sufficient there.
 */
export interface IndexTypeReference {
  $ref: string;
}

/** The index file an extension returns alongside its type files. */
export interface TypeIndex {
  resources: Record<string, IndexTypeReference>;
  resourceFunctions?: Record<string, Record<string, IndexTypeReference[]>>;
  namespaceFunctions?: unknown[];
  settings?: {
    name?: string;
    version?: string;
    isSingleton?: boolean;
    isPreview?: boolean;
    isDeprecated?: boolean;
    configurationType?: IndexTypeReference;
  };
}

/**
 * Resolves an index pointer of the form `types.json#/12` or `#/12`, returning
 * the file it names when it has one.
 */
export function resolveIndexPointer(
  reference: IndexTypeReference | undefined,
): { file?: string; index: number } | undefined {
  if (!reference?.$ref) {
    return undefined;
  }
  const [file, pointer] = reference.$ref.split('#');
  const index = Number(pointer?.replace(/^\//, ''));
  if (!Number.isInteger(index)) {
    return undefined;
  }
  return { file: file || undefined, index };
}

export function describePropertyFlags(flags: ObjectTypePropertyFlags | undefined): string[] {
  return flags ? getObjectTypePropertyFlagsLabels(flags) : [];
}

export function describeScopes(scopes: ScopeType | undefined): string[] {
  return scopes ? getScopeTypeLabels(scopes) : [];
}

/**
 * A discriminated object reuses the `elements` field as a map of discriminator
 * value to shape, where a union uses it as an array. These narrow to whichever
 * form the type in hand actually uses.
 */
export function unionElements(type: BicepType): TypeReference[] {
  return type.type === TypeBaseKind.UnionType ? type.elements : [];
}

export function discriminatedElements(type: BicepType): Record<string, TypeReference> {
  return type.type === TypeBaseKind.DiscriminatedObjectType ? type.elements : {};
}
