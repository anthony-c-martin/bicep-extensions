/**
 * Model for Bicep's serialized type format, as produced by the `GetTypeFiles`
 * RPC. Types are stored as a flat array and refer to one another by index using
 * `{ "$ref": "#/12" }` pointers.
 */

export interface TypeReference {
  $ref: string;
}

export interface ObjectProperty {
  type: TypeReference;
  flags?: number;
  description?: string;
}

export interface BicepType {
  $type: string;
  name?: string;
  body?: TypeReference;
  properties?: Record<string, ObjectProperty>;
  additionalProperties?: TypeReference;
  sensitive?: boolean;
  itemType?: TypeReference;
  elements?: TypeReference[];
  value?: string | number | boolean;
  flags?: number;
  scopeType?: number;
  readableScopes?: number;
  writableScopes?: number;
  minLength?: number;
  maxLength?: number;
  minValue?: number;
  maxValue?: number;
  pattern?: string;
  discriminator?: string;
  baseProperties?: Record<string, ObjectProperty>;
  elementTypes?: Record<string, TypeReference>;
  input?: TypeReference;
  output?: TypeReference;
}

export interface TypeIndex {
  resources: Record<string, TypeReference>;
  resourceFunctions?: Record<string, Record<string, TypeReference[]>>;
  namespaceFunctions?: unknown[];
  settings?: {
    name?: string;
    version?: string;
    isSingleton?: boolean;
    isPreview?: boolean;
    isDeprecated?: boolean;
    configurationType?: TypeReference;
  };
}

export enum PropertyFlags {
  None = 0,
  Required = 1 << 0,
  ReadOnly = 1 << 1,
  WriteOnly = 1 << 2,
  DeployTimeConstant = 1 << 3,
  Identifier = 1 << 4,
}

export enum ScopeType {
  None = 0,
  Tenant = 1 << 0,
  ManagementGroup = 1 << 1,
  Subscription = 1 << 2,
  ResourceGroup = 1 << 3,
  Extension = 1 << 4,
}

export function describePropertyFlags(flags: number | undefined): string[] {
  if (!flags) {
    return [];
  }
  const labels: Array<[PropertyFlags, string]> = [
    [PropertyFlags.Required, 'Required'],
    [PropertyFlags.ReadOnly, 'ReadOnly'],
    [PropertyFlags.WriteOnly, 'WriteOnly'],
    [PropertyFlags.DeployTimeConstant, 'DeployTimeConstant'],
    [PropertyFlags.Identifier, 'Identifier'],
  ];
  return labels.filter(([flag]) => (flags & flag) === flag).map(([, label]) => label);
}

export function describeScopes(scopes: number | undefined): string[] {
  if (scopes === undefined || scopes === ScopeType.None) {
    return [];
  }
  const labels: Array<[ScopeType, string]> = [
    [ScopeType.Tenant, 'Tenant'],
    [ScopeType.ManagementGroup, 'Management group'],
    [ScopeType.Subscription, 'Subscription'],
    [ScopeType.ResourceGroup, 'Resource group'],
    [ScopeType.Extension, 'Extension'],
  ];
  return labels.filter(([scope]) => (scopes & scope) === scope).map(([, label]) => label);
}

/**
 * Type pointers take the form `#/123` (same file) or `types.json#/123`
 * (cross-file). Returns the target file, if specified, and the array index.
 */
export function resolvePointer(
  reference: TypeReference | undefined,
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
