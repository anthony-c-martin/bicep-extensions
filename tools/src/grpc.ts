import { ChildProcess, spawn } from 'node:child_process';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';

const PROTO_PATH = fileURLToPath(new URL('../proto/extension.proto', import.meta.url));

/** Response shape of the `GetTypeFiles` RPC. */
export interface TypeFilesResponse {
  indexFile: string;
  typeFiles: Record<string, string>;
}

interface BicepExtensionClient extends grpc.Client {
  Ping(
    request: object,
    options: grpc.CallOptions,
    callback: (error: grpc.ServiceError | null, response: object) => void,
  ): void;
  GetTypeFiles(
    request: object,
    options: grpc.CallOptions,
    callback: (error: grpc.ServiceError | null, response: TypeFilesResponse) => void,
  ): void;
}

function loadClientConstructor(): grpc.ServiceClientConstructor {
  const definition = protoLoader.loadSync(PROTO_PATH, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
  });
  const proto = grpc.loadPackageDefinition(definition) as unknown as {
    extension: { BicepExtension: grpc.ServiceClientConstructor };
  };
  return proto.extension.BicepExtension;
}

/**
 * Wraps a unary call, applying a deadline. gRPC defaults to no deadline, so
 * without this a extension that accepts a connection but never replies would
 * block the caller indefinitely.
 */
function callWithDeadline<T>(
  fn: (
    request: object,
    options: grpc.CallOptions,
    callback: (error: grpc.ServiceError | null, response: T) => void,
  ) => void,
  thisArg: unknown,
  timeoutMs: number,
): () => Promise<T> {
  return () =>
    new Promise<T>((resolve, reject) => {
      fn.call(thisArg, {}, { deadline: Date.now() + timeoutMs }, (error, response) =>
        error ? reject(error) : resolve(response),
      );
    });
}

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Waits for the extension's gRPC server to accept connections. The extension
 * process creates its socket asynchronously after start-up, so `Ping` is
 * retried until it succeeds, mirroring how the Bicep CLI connects.
 */
async function waitForConnection(
  client: BicepExtensionClient,
  child: ChildProcess,
  timeoutMs: number,
): Promise<void> {
  // Each attempt is bounded so a stalled server cannot block the loop forever.
  const ping = callWithDeadline(client.Ping, client, 5_000);
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;

  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(
        `Extension process exited before it became ready (code ${child.exitCode ?? child.signalCode}).`,
      );
    }
    try {
      await ping();
      return;
    } catch (error) {
      lastError = error;
      await delay(100);
    }
  }

  throw new Error(`Timed out waiting for the extension to become ready: ${String(lastError)}`);
}

export interface ExtractOptions {
  /** Raw bytes of the platform-specific extension binary. */
  binary: Buffer;
  /** Milliseconds to wait for the extension to start listening. */
  startupTimeoutMs?: number;
  /** Milliseconds to wait for the `GetTypeFiles` response. */
  requestTimeoutMs?: number;
}

/**
 * Runs an extension binary and retrieves its type definitions over gRPC.
 *
 * The extension is started with `--socket`, which makes it host its gRPC server
 * on a Unix domain socket. This avoids binding a TCP port, so several
 * extensions can be inspected concurrently without port collisions.
 */
export async function extractTypeFiles({
  binary,
  startupTimeoutMs = 60_000,
  requestTimeoutMs = 120_000,
}: ExtractOptions): Promise<TypeFilesResponse> {
  if (process.platform === 'win32') {
    throw new Error('Type extraction requires Unix domain sockets and does not support Windows.');
  }

  const workingDirectory = await mkdtemp(path.join(tmpdir(), 'bicep-ext-'));
  const binaryPath = path.join(workingDirectory, 'extension.bin');
  // Socket paths are limited to ~104 characters, so keep the name short.
  const socketPath = path.join(workingDirectory, 'ext.sock');

  let child: ChildProcess | undefined;
  let client: BicepExtensionClient | undefined;

  try {
    await writeFile(binaryPath, binary);
    await chmod(binaryPath, 0o755);

    child = spawn(binaryPath, ['--socket', socketPath], {
      cwd: workingDirectory,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const output: string[] = [];
    child.stdout?.on('data', chunk => output.push(String(chunk)));
    child.stderr?.on('data', chunk => output.push(String(chunk)));

    const spawnFailure = new Promise<never>((_, reject) => {
      child!.once('error', error => reject(new Error(`Failed to start extension: ${error.message}`)));
    });

    const ClientConstructor = loadClientConstructor();
    client = new ClientConstructor(
      `unix://${socketPath}`,
      grpc.credentials.createInsecure(),
    ) as unknown as BicepExtensionClient;

    try {
      await Promise.race([waitForConnection(client, child, startupTimeoutMs), spawnFailure]);
    } catch (error) {
      const details = output.join('').trim();
      throw new Error(details ? `${(error as Error).message}\nExtension output:\n${details}` : String(error));
    }

    return await callWithDeadline<TypeFilesResponse>(
      client.GetTypeFiles,
      client,
      requestTimeoutMs,
    )();
  } finally {
    client?.close();
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      // Give the process a moment to shut down before forcing it.
      await Promise.race([new Promise(resolve => child!.once('exit', resolve)), delay(5_000)]);
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
      }
    }
    await rm(workingDirectory, { recursive: true, force: true });
  }
}
