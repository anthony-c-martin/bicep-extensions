---
title: Authoring an extension
sidebar_position: 2
description: What a Bicep extension is, the contract it implements, and how to build one.
pagination_prev: null
pagination_next: null
---

# Authoring an extension

A Bicep extension teaches Bicep how to manage a new kind of resource. Once
published, anyone can declare those resources in a `.bicep` file using the same
syntax they already use for Azure.

An extension is just a program. Bicep starts it during a deployment and talks to
it over gRPC, so it can be written in any language with gRPC support — though
there is a C# library that does most of the work for you.

## The contract

Extensions implement the `BicepExtension` service, defined in
[`extension.proto`](https://github.com/Azure/bicep/blob/main/src/Bicep.Local.Rpc/extension.proto):

| Method | Called when |
| --- | --- |
| `CreateOrUpdate` | A resource needs to be created or brought up to date. |
| `Get` | Bicep needs the current state of a resource. |
| `Delete` | A resource should be removed. |
| `Preview` | A what-if style run needs the outcome without applying it. |
| `GetTypeFiles` | Bicep asks the extension to describe the resource types it supports. |
| `Ping` | Bicep checks the extension is ready to receive requests. |

Two ideas carry most of the weight:

**Resources are described by types.** `GetTypeFiles` returns the extension's
type definitions — the resource types it exposes, their properties, and which of
those are required, read-only or identifiers. This is what gives users
completions and validation while they type, and it is what this catalogue reads
to build its [reference pages](/docs/extensions).

**Operations are declarative.** Bicep tells the extension the desired state of a
resource and the extension makes it so, whether that means creating something new
or reconciling something that already exists. Resource payloads cross the wire as
JSON, so an extension is free to model its resources however suits the underlying
API.

## How Bicep runs an extension

During a deployment, Bicep:

1. downloads the extension from its registry and starts it as a child process,
   passing `--socket`, `--pipe` or `--http` to say how to communicate;
2. calls `Ping` until the extension answers, since the server takes a moment to
   start listening; then
3. calls `Get`, `CreateOrUpdate` or `Delete` for each resource in the file.

## Building one in C\#

The [`Azure.Bicep.Local.Extension`](https://www.nuget.org/packages/Azure.Bicep.Local.Extension)
NuGet package handles the gRPC plumbing, the transport arguments and the process
lifecycle. You describe resources as annotated C# classes and implement a handler
per resource type; the library generates the type definitions that `GetTypeFiles`
returns, so you never write them by hand.

The [.NET quickstart](https://github.com/Azure/bicep/blob/main/docs/experimental/local-deploy-dotnet-quickstart.md)
in the Bicep repository walks through a working extension from an empty folder.

:::note

The package is published by Microsoft but is explicitly unsupported, and its API
may change between releases. Pin a version you have tested against.

:::

## Building one in another language

Nothing about the contract is .NET-specific. Any language with a gRPC server
implementation can host the service; generate the server stubs from
`extension.proto` and produce the type definitions yourself. Expect to do more
work than the C# route, particularly around the serialised type format.

## Reference implementations

Every extension in this catalogue is open source and built with the C# library,
so they are a good place to see the shape of a real implementation:

| Extension | Interesting because |
| --- | --- |
| [Utilities](https://github.com/anthony-c-martin/bicep-ext-utilities) | The smallest useful example — a handful of self-contained resources. |
| [Helm](https://github.com/anthony-c-martin/bicep-ext-helm) | A single resource type that wraps an existing command-line tool. |
| [GitHub](https://github.com/anthony-c-martin/bicep-ext-github) | Many resource types over a REST API, with token authentication. |
| [Azure Storage](https://github.com/anthony-c-martin/bicep-ext-storage) | Several authentication modes selected through extension configuration. |
| [Kubernetes](https://github.com/anthony-c-martin/bicep-ext-kubernetes) | Types generated from an external schema, split across many type files. |

There is also a community
[`dotnet new` template](https://github.com/maikvandergaag/bicep-extension-template)
that scaffolds a project.

## Publishing

Extensions are published as OCI artifacts, which can live in any container
registry:

```bash
bicep publish-extension \
  --bin-linux-x64 ./bin/linux-x64/extension \
  --bin-osx-arm64 ./bin/osx-arm64/extension \
  --target br:ghcr.io/owner/repo:1.0.0
```

Bicep starts the binary, calls `GetTypeFiles`, and packages the returned types
alongside one binary per platform you supply. Publishing `linux-x64` at minimum
is worthwhile, since that is what most CI environments run.

Once published, [add it to this catalogue](./contributing.md) so others can find
it.
