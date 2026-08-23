## Authentication

The extension calls the Microsoft Fabric REST API using a Microsoft Entra access
token:

```bicep
@secure()
param accessToken string

extension fabric with {
  accessToken: accessToken
}
```

A token can be acquired with the Azure CLI:

```bash
az account get-access-token \
  --resource https://api.fabric.microsoft.com \
  --query accessToken -o tsv
```

```bicep title="main.bicepparam"
using 'main.bicep'

param accessToken = readEnvironmentVariable('FABRIC_TOKEN')
```

## Example

Create a workspace and a lakehouse inside it:

```bicep
targetScope = 'local'

@secure()
param accessToken string

extension fabric with {
  accessToken: accessToken
}

resource workspace 'Workspace' = {
  displayName: 'Analytics'
  description: 'Managed with Bicep'
}

resource lakehouse 'Lakehouse' = {
  workspaceId: workspace.id
  displayName: 'Raw'
}
```

## Notes

- Most item types share a common shape: a `workspaceId` identifying the
  containing workspace, a required `displayName`, and an optional `definition`
  holding the item's serialised content.
- Item definitions are supplied as base64-encoded parts. `loadFileAsBase64` is
  useful for populating them from files on disk.
- Access tokens are short-lived. Acquire a fresh one for each deployment rather
  than storing it.
