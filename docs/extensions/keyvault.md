## Authentication

The extension reaches Key Vault over its data plane and authenticates with
`DefaultAzureCredential`, which picks up environment variables, workload
identity, managed identity or an Azure CLI login — whichever is available. There
is no credential to set in the extension configuration.

The identity you sign in with needs data plane permissions, granted through
either Azure RBAC roles such as **Key Vault Secrets Officer** or a vault access
policy, depending on how the vault is configured.

## Targeting a vault

Set `vaultUri` once on the extension and every resource inherits it:

```bicep
extension keyvault with {
  vaultUri: 'https://contoso.vault.azure.net/'
}
```

Individual resources can override it with their own `vaultUri`, which is how the
[Replicating across vaults](./samples/multi-vault.md) sample writes the same
secret into more than one vault.

Managed HSM resources use `managedHsmUri` instead:

```bicep
extension keyvault with {
  managedHsmUri: 'https://contoso.managedhsm.azure.net/'
}
```

## Soft delete

Key Vault keeps deleted objects in a soft-deleted state, which can cause a later
deployment to fail because the name is still taken. Two settings control how the
extension handles this:

| Setting | Effect |
| --- | --- |
| `recoverSoftDeleted` | Recovers a soft-deleted object instead of failing to create it. |
| `purgeOnDelete` | Permanently purges an object when it is deleted, rather than soft-deleting it. |

Both default to `false`. `purgeOnDelete` is convenient for short-lived test
vaults, but it removes the safety net that soft delete exists to provide — leave
it off for anything you would mind losing.

## Notes

- This extension manages **data plane** objects. The vault itself is still
  created with the standard `Microsoft.KeyVault/vaults` Azure resource type.
- Because the data plane is reached directly, the machine running the deployment
  needs network access to the vault. Vaults restricted to a private endpoint or a
  firewall will reject requests from elsewhere.
- Secret values are marked sensitive, so pass them as `@secure()` parameters
  rather than writing them into the template.
