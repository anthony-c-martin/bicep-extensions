import semver from 'semver';

const BICEP_ARTIFACT_TYPE = 'application/vnd.ms.bicep.provider.artifact';
const TYPES_LAYER = 'application/vnd.ms.bicep.provider.layer.v1.tar+gzip';

export interface OciDescriptor {
  mediaType: string;
  digest: string;
  size: number;
  annotations?: Record<string, string>;
}

export interface OciManifest {
  schemaVersion: number;
  mediaType?: string;
  artifactType?: string;
  config?: OciDescriptor;
  layers: OciDescriptor[];
  annotations?: Record<string, string>;
}

/** Config document stored in the `application/vnd.ms.bicep.provider.config.v1+json` layer. */
export interface ExtensionConfig {
  localDeployEnabled?: boolean;
  supportedArchitectures?: string[];
}

export interface ArtifactRef {
  registry: string;
  repository: string;
}

/**
 * Splits `ghcr.io/owner/repo` into its registry and repository parts.
 */
export function parseArtifact(artifact: string): ArtifactRef {
  const [registry, ...rest] = artifact.split('/');
  if (!registry || rest.length === 0) {
    throw new Error(`Invalid artifact path '${artifact}'. Expected '<registry>/<repository>'.`);
  }
  return { registry, repository: rest.join('/') };
}

/**
 * Bicep binary layers are named `...layer.v1.<architecture>.binary`, where the
 * architecture matches the names used by Bicep's SupportedArchitectures.
 */
export function binaryLayerMediaType(architecture: string): string {
  return `application/vnd.ms.bicep.provider.layer.v1.${architecture}.binary`;
}

/** Maps the current Node process to a Bicep architecture name. */
export function currentArchitecture(): string {
  const os = { darwin: 'osx', linux: 'linux', win32: 'win' }[process.platform as string];
  const arch = { x64: 'x64', arm64: 'arm64' }[process.arch as string];
  if (!os || !arch) {
    throw new Error(`Unsupported platform '${process.platform}/${process.arch}'.`);
  }
  return `${os}-${arch}`;
}

export class RegistryClient {
  private tokens = new Map<string, string>();

  constructor(private readonly ref: ArtifactRef) {}

  private get base(): string {
    return `https://${this.ref.registry}/v2/${this.ref.repository}`;
  }

  /**
   * Registries hand out short-lived pull tokens from the endpoint advertised in
   * the `WWW-Authenticate` challenge. Anonymous tokens are enough for public
   * artifacts, and an env var supplies credentials for private ones.
   */
  private async authorize(challenge: string): Promise<string> {
    const params = new Map<string, string>();
    for (const match of challenge.matchAll(/(\w+)="([^"]*)"/g)) {
      params.set(match[1], match[2]);
    }
    const realm = params.get('realm');
    if (!realm) {
      throw new Error(`Registry did not advertise a token realm: ${challenge}`);
    }

    const url = new URL(realm);
    if (params.get('service')) {
      url.searchParams.set('service', params.get('service')!);
    }
    url.searchParams.set('scope', params.get('scope') ?? `repository:${this.ref.repository}:pull`);

    const headers: Record<string, string> = {};
    const credentials = process.env.REGISTRY_TOKEN;
    if (credentials) {
      headers.Authorization = `Basic ${Buffer.from(credentials).toString('base64')}`;
    }

    const response = await fetch(url, { headers });
    if (!response.ok) {
      throw new Error(`Failed to obtain a registry token (${response.status} ${response.statusText}).`);
    }
    const body = (await response.json()) as { token?: string; access_token?: string };
    const token = body.token ?? body.access_token;
    if (!token) {
      throw new Error('Registry token response did not contain a token.');
    }
    return token;
  }

  /** Performs a registry request, transparently handling the token challenge. */
  private async request(path: string, accept?: string): Promise<Response> {
    const url = `${this.base}${path}`;
    const headers: Record<string, string> = {};
    if (accept) {
      headers.Accept = accept;
    }

    const cached = this.tokens.get(this.ref.repository);
    if (cached) {
      headers.Authorization = `Bearer ${cached}`;
    }

    let response = await fetch(url, { headers });
    if (response.status === 401) {
      const challenge = response.headers.get('www-authenticate');
      if (!challenge) {
        throw new Error(`Unauthorized request to ${url} with no authentication challenge.`);
      }
      const token = await this.authorize(challenge);
      this.tokens.set(this.ref.repository, token);
      response = await fetch(url, { headers: { ...headers, Authorization: `Bearer ${token}` } });
    }

    if (!response.ok) {
      throw new Error(`Request to ${url} failed (${response.status} ${response.statusText}).`);
    }
    return response;
  }

  async listTags(): Promise<string[]> {
    const response = await this.request('/tags/list');
    const body = (await response.json()) as { tags?: string[] | null };
    return body.tags ?? [];
  }

  /**
   * Extensions do not publish a `latest` tag, and tags sort incorrectly
   * lexically (0.1.9 would beat 0.1.13), so the highest semver wins.
   */
  async resolveLatestVersion(): Promise<string> {
    const tags = await this.listTags();
    const versions = tags
      .map(tag => ({ tag, version: semver.coerce(tag, { includePrerelease: true }) }))
      .filter((entry): entry is { tag: string; version: semver.SemVer } => entry.version !== null);

    if (versions.length === 0) {
      throw new Error(`No semver-like tags found. Available tags: ${tags.join(', ') || '(none)'}`);
    }

    versions.sort((a, b) => semver.compare(a.version, b.version));

    // Prefer stable releases, falling back to prereleases when that is all there is.
    const stable = versions.filter(entry => semver.prerelease(entry.version) === null);
    const chosen = stable.length > 0 ? stable : versions;
    return chosen[chosen.length - 1].tag;
  }

  async getManifest(reference: string): Promise<OciManifest> {
    const accept = [
      'application/vnd.oci.image.manifest.v1+json',
      'application/vnd.docker.distribution.manifest.v2+json',
    ].join(',');
    const response = await this.request(`/manifests/${reference}`, accept);
    return (await response.json()) as OciManifest;
  }

  async getBlob(digest: string): Promise<Buffer> {
    const response = await this.request(`/blobs/${digest}`);
    return Buffer.from(await response.arrayBuffer());
  }

  async getConfig(manifest: OciManifest): Promise<ExtensionConfig> {
    if (!manifest.config || manifest.config.size <= 2) {
      return {};
    }
    const blob = await this.getBlob(manifest.config.digest);
    try {
      return JSON.parse(blob.toString('utf8')) as ExtensionConfig;
    } catch {
      return {};
    }
  }
}

export function assertBicepExtension(manifest: OciManifest, artifact: string): void {
  if (manifest.artifactType && manifest.artifactType !== BICEP_ARTIFACT_TYPE) {
    throw new Error(
      `Artifact '${artifact}' has type '${manifest.artifactType}', expected '${BICEP_ARTIFACT_TYPE}'.`,
    );
  }
  if (!manifest.layers.some(layer => layer.mediaType === TYPES_LAYER)) {
    throw new Error(`Artifact '${artifact}' does not contain a Bicep types layer.`);
  }
}

export function findBinaryLayer(manifest: OciManifest, architecture: string): OciDescriptor | undefined {
  return manifest.layers.find(layer => layer.mediaType === binaryLayerMediaType(architecture));
}
