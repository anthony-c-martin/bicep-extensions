## Authentication

The extension talks to Azure Storage over the data plane. Several credential
types are supported, and the right one depends on the operation:

| Credential | Configuration property |
| --- | --- |
| Microsoft Entra (default) | `useDefaultAzureCredential` |
| Microsoft Entra access token | `accessToken` |
| Shared key | `accountKey` |
| Shared access signature | `sasToken` |

When no credential is supplied, `useDefaultAzureCredential` defaults to `true`,
which picks up environment variables, workload identity, managed identity or an
Azure CLI login — whichever is available.

```bicep
extension storage with {
  accountName: 'contosostorage'
}
```

Some operations, such as table stored access policies, are not supported by
Microsoft Entra authentication and require `accountKey`.

## Targeting an emulator

Override the service endpoints to point at Azurite or a custom domain:

```bicep
extension storage with {
  accountName: 'devstoreaccount1'
  blobEndpoint: 'http://127.0.0.1:10000/devstoreaccount1'
  queueEndpoint: 'http://127.0.0.1:10001/devstoreaccount1'
  tableEndpoint: 'http://127.0.0.1:10002/devstoreaccount1'
  accountKey: azuriteKey
}
```

## Example

```bicep
targetScope = 'local'

extension storage with {
  accountName: 'contosostorage'
}

resource container 'BlobContainer' = {
  name: 'documents'
}

resource readme 'Blob' = {
  containerName: container.name
  name: 'readme.txt'
  content: 'Uploaded with Bicep'
}
```

## Notes

- This extension manages **data plane** resources. The storage account itself is
  still created with the standard `Microsoft.Storage/storageAccounts` Azure
  resource type.
- Because the data plane is reached directly, the machine running the deployment
  needs network access to the account.
