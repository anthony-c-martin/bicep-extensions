## Authentication

The extension first uses `DATABRICKS_ACCESS_TOKEN` when that environment
variable is set. Otherwise, it uses `DefaultAzureCredential` to request an
Azure Databricks token, allowing credentials such as Azure CLI or managed
identity to be used.

## Extension declaration

Pass the URL of the target Azure Databricks workspace when declaring the
extension:

```bicep
targetScope = 'local'

param workspaceUrl string

extension databricksExtension with {
  workspaceUrl: workspaceUrl
}
```

The extension supports compute resources, workspace objects such as
directories, Git credentials, repositories and secrets, and Unity Catalog
resources.

## Notes

- The workspace URL must identify an existing Azure Databricks workspace.
- The identity or access token used by the extension needs permissions for each
  Databricks resource managed by the template.
