## Authentication

The extension authenticates with a GitHub personal access token, supplied
through the extension configuration:

```bicep
extension github with {
  token: gitHubToken
}
```

Keep the token out of source control by declaring it as a secure parameter and
supplying it at deployment time:

```bicep title="main.bicep"
@secure()
param gitHubToken string

extension github with {
  token: gitHubToken
}
```

```bicep title="main.bicepparam"
using 'main.bicep'

param gitHubToken = readEnvironmentVariable('GITHUB_TOKEN')
```

The token needs scopes appropriate to the resources you manage — `repo` for
repository resources, and `admin:org` for organisation-level resources such as
`OrganizationActionsSecret`.

## Example

Create a repository, protect its default branch, and add a secret used by
Actions:

```bicep
targetScope = 'local'

@secure()
param gitHubToken string

extension github with {
  token: gitHubToken
}

resource repo 'Repository' = {
  owner: 'contoso'
  name: 'hello-world'
  description: 'Managed with Bicep'
  visibility: 'Public'
  deleteBranchOnMerge: true
}

resource protection 'BranchProtectionRule' = {
  owner: repo.owner
  repository: repo.name
  pattern: 'main'
}

resource secret 'ActionsSecret' = {
  owner: repo.owner
  repository: repo.name
  name: 'API_KEY'
  value: 'super-secret'
}
```

## Notes

- Resources are identified by their natural GitHub keys — an `owner` and `name`
  pair for repositories, for example — rather than by a generated ID.
- Deleting a `Repository` resource deletes the repository itself. Remove the
  resource from your template with care.
