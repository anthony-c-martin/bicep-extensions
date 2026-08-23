---
title: Adding to the catalogue
sidebar_position: 3
description: How to add a Bicep extension to this catalogue.
pagination_prev: null
pagination_next: null
---

# Adding to the catalogue

The catalogue is driven by a single configuration file,
[`extensions.json`](https://github.com/anthony-c-martin/bicep-extensions/blob/main/extensions.json),
at the root of the repository.

## Requirements

An extension can be catalogued if it:

1. is published as a public OCI artifact;
2. ships a binary layer for the architecture the refresh runs on (`linux-x64`
   in CI); and
3. returns its resource types from the `GetTypeFiles` gRPC method.

Types-only extensions, which have no binary, cannot be catalogued because there
is nothing to run.

## 1. Add an entry

Add an object to the `extensions` array:

```json
{
  "id": "github",
  "displayName": "GitHub",
  "description": "Declaratively manage GitHub repositories, teams and secrets from Bicep.",
  "repository": "https://github.com/anthony-c-martin/bicep-ext-github",
  "artifact": "ghcr.io/anthony-c-martin/bicep-ext-github",
  "publisher": "anthony-c-martin",
  "category": "DevOps",
  "tags": ["github", "git"],
  "license": "MIT"
}
```

| Field | Required | Notes |
| --- | --- | --- |
| `id` | yes | Lowercase identifier used in file names and URLs. |
| `displayName` | yes | Name shown in the catalogue. |
| `description` | yes | One-line summary used on the card and overview page. |
| `repository` | yes | Source repository URL. |
| `artifact` | yes | OCI path **without** a tag; the latest version is resolved automatically. |
| `publisher` | no | Person or organisation publishing the extension. |
| `category` | no | Used to group and filter the catalogue. |
| `tags` | no | Keywords used by the search box. |
| `license` | no | SPDX licence identifier. |
| `docsUrl` | no | Link to documentation hosted elsewhere. |

The file is validated against
[`schemas/extensions.schema.json`](https://github.com/anthony-c-martin/bicep-extensions/blob/main/schemas/extensions.schema.json).

Note that no version is recorded. The refresh always resolves the highest
released version from the registry, preferring stable releases over
prereleases.

## 2. Write the prose

Create `docs/extensions/<id>.md` with any hand-written guidance — authentication,
prerequisites, worked examples, caveats. It is inserted into the extension's
overview page above the list of resource types.

Start at heading level 2, since the page already has a title:

```markdown
## Authentication

Set the `GITHUB_TOKEN` environment variable to a personal access token with the
`repo` scope.
```

## 3. Refresh the types

```bash
cd tools
npm install
npm run refresh -- <id>
```

This resolves the latest version, downloads the binary layer, runs it, calls
`GetTypeFiles`, and writes `generated/<id>.json`, which is committed to the
repository.

:::warning

Refreshing runs the extension's binary on your machine. Only add extensions you
trust.

:::

## 4. Preview the site

```bash
cd tools && npm run generate-docs
cd ../website && npm start
```

## Keeping types up to date

Type data is refreshed by the **Refresh extension types** workflow, which is run
manually from the Actions tab. It re-extracts types for every extension and opens
a pull request when anything has changed.
