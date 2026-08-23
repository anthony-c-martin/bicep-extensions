# Bicep Extensions Catalogue

A catalogue of [Bicep](https://github.com/Azure/bicep) extensions, published as a
GitHub Pages site at
**https://anthony-c-martin.github.io/bicep-extensions**.

The site combines hand-written usage documentation with reference pages for every
resource type an extension exposes. Type information is not written by hand: it is
extracted from each published extension by running its binary and calling the
`GetTypeFiles` method of the
[Bicep extension gRPC interface](https://github.com/Azure/bicep/blob/main/src/Bicep.Local.Rpc/extension.proto).

## How it works

```
extensions.json ──▶ tools (refresh) ──▶ generated/*.json ──▶ tools (generate-docs) ──▶ website/
                    │                   (committed)                                    │
                    │                                                                  ▼
                    └─ pulls the OCI artifact, runs the extension               GitHub Pages
                       binary, calls GetTypeFiles over a Unix socket
```

1. **`extensions.json`** lists the extensions in the catalogue, with their source
   repository and OCI artifact path. No version is recorded — the latest released
   version is resolved from the registry.
2. **`npm run refresh`** resolves that version, downloads the architecture-specific
   binary layer from the artifact, runs it with `--socket`, waits for `Ping` to
   succeed, and calls `GetTypeFiles`. The result is written to `generated/<id>.json`
   and committed.
3. **`npm run generate-docs`** turns the committed type data, plus the prose in
   `docs/extensions/`, into Markdown pages under `website/docs/extensions/`.
4. **Docusaurus** builds the site and GitHub Actions publishes it to GitHub Pages.

Separating steps 2 and 3 means the site builds from committed data, so routine
builds never execute third-party binaries, and changes to an extension's types
show up as a reviewable diff.

## Repository layout

| Path | Contents |
| --- | --- |
| `extensions.json` | The catalogue configuration. |
| `schemas/` | JSON schema for the configuration. |
| `tools/` | TypeScript CLI for type extraction and documentation generation. |
| `generated/` | Extracted type definitions (committed, machine-generated). |
| `docs/extensions/` | Hand-written prose merged into each extension's page. |
| `website/` | The Docusaurus site. |

## Local development

```bash
# Extract type definitions (runs the extension binaries)
cd tools
npm install
npm run refresh            # or: npm run refresh -- github storage

# Generate pages and preview the site
npm run generate-docs
cd ../website
npm install
npm start
```

To build the site exactly as CI does:

```bash
npm run generate-docs --prefix tools
npm run build --prefix website
```

## Adding an extension

An extension can be catalogued if it is published as a public OCI artifact, ships a
binary for the architecture the refresh runs on, and returns its resource types from
`GetTypeFiles`.

1. Add an entry to `extensions.json`.
2. Write `docs/extensions/<id>.md` with usage guidance.
3. Run `npm run refresh -- <id>` and commit `generated/<id>.json`.

See the [contributing guide](website/docs/guides/contributing.md) for the full
details.

> [!WARNING]
> Refreshing type definitions downloads and executes extension binaries. Only add
> extensions you trust.

## Refreshing types

The **Refresh extension types** workflow is run manually from the Actions tab. It
re-extracts types for every extension, verifies the site still builds, and opens a
pull request if anything changed.
