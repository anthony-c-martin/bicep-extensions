---
name: adding-extensions
description: "Use when adding or updating a Bicep extension in this catalogue. Covers verifying public OCI artifacts, adding extensions.json entries and sample links, writing extension prose, refreshing GetTypeFiles data, generating documentation, validating, building, and previewing the Docusaurus site."
---

# Adding Bicep Extensions

Follow the repository workflow in this order. Keep the change limited to the
catalogue entry, generated type data, extension prose, samples, and generated
site output.

## Verify the extension first

Before editing the catalogue, inspect the upstream repository and confirm:

- The repository is public and describes a Bicep extension.
- The published OCI artifact path is known and does not include a version tag.
- The artifact has a binary for the refresh architecture (`osx-arm64` locally
  and `linux-x64` in CI).
- The extension returns type files through `GetTypeFiles`.
- The repository contains real `.bicep` sample files if samples will be linked.

Do not invent an artifact path, sample URL, resource description, or license.
Use the upstream README, release workflow, registry metadata, and source as the
source of truth.

## Add the catalogue entry

Add an object to the `extensions` array in `extensions.json`:

- Use a lowercase kebab-case `id`; it becomes the generated file and URL name.
- Use the published repository URL and OCI artifact path without a tag.
- Set `communityContributed`, `publisher`, `category`, tags, and license when
  they are supported by upstream information.
- Add `samples` only for existing `.bicep` files. Link GitHub `blob` URLs, not
  directory pages or parameter files.

The entry must conform to `schemas/extensions.schema.json`.

## Add extension prose

Create `docs/extensions/<id>.md` when the extension needs usage guidance. Start
at heading level 2 because the generated page supplies the title. Cover the
parts users need to deploy safely:

- Authentication and how to keep credentials secure.
- Target endpoint, prerequisites, and required permissions.
- Resource behavior, identity keys, and important update or delete semantics.
- A small, valid Bicep example based on an upstream sample.
- Azure-specific control-plane/data-plane boundaries when relevant.

## Refresh types

Only run this for extensions you trust: the command downloads and executes a
third-party binary.

```bash
npm run refresh --prefix tools -- <id>
```

Confirm that the command resolves a released version, finds the expected
resource types, and writes `generated/<id>.json`. Do not hand-author generated
type data when the refresh can be run successfully.

## Generate and validate

After the type refresh and prose changes, run:

```bash
npm run generate-docs --prefix tools
npm run validate --prefix tools
git diff --check
npm run build --prefix website
```

The validator may report missing generated data or prose for unrelated existing
entries, but the new extension should produce neither warning. Review the diff
and confirm that generated changes are limited to the intended extension.

## Preview locally

Run the site from the repository root:

```bash
ulimit -n 8192 && npm start --prefix website
```

Open `http://localhost:3000/bicep-extensions/` and verify both the catalogue card
and `/docs/extensions/<id>` page. On macOS, the higher open-file limit avoids
`EMFILE` errors while Docusaurus watches the generated documentation tree.
