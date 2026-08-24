## Authentication

The extension supports Azure DevOps authentication through a personal access
token or Microsoft Entra workload identity. Prefer workload identity for
automated deployments and grant the identity the permissions required by the
resources in your template.

## Example

Create an Azure DevOps project and a Git repository:

```bicep
targetScope = 'local'

extension azuredevops

param organization string
param projectName string
param repositoryName string

resource project 'AzureDevOpsProject' = {
  name: projectName
  organization: organization
  visibility: 'Private'
  processName: 'Agile'
  sourceControlType: 'Git'
}

resource repository 'AzureDevOpsRepository' = {
  name: repositoryName
  organization: organization
  project: project.name
}

output repositoryUrl string = repository.webUrl
```

## Notes

- The `organization` property is the short Azure DevOps organisation name, not
  its full URL.
- This extension is experimental and its publisher advises against production
  use.
