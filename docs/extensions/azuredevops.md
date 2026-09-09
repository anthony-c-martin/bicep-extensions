## Overview

The extension calls the Azure DevOps REST API from a local deployment, so an
organisation can be described in Bicep alongside the Azure resources it deploys.
It needs no extension-level configuration:

```bicep
extension azuredevops
```

| Resource type                  | Purpose                                                       |
| ------------------------------ | ------------------------------------------------------------- |
| `AzureDevOpsProject`           | Create a team project with a process and source control type. |
| `AzureDevOpsRepository`        | Create a Git repository inside a project.                     |
| `AzureDevOpsArtifactFeed`      | Create a project-scoped artifact feed.                        |
| `AzureDevOpsServiceConnection` | Create a federated (workload identity) service connection.    |
| `AzureDevOpsPermission`        | Assign an Entra ID group to a project role.                   |
| `AzureDevOpsExtension`         | Install a Marketplace extension into the organisation.        |
| `AzureDevOpsWorkItem`          | Create or update a work item.                                 |

## Authentication

Two authentication methods are supported:

| Method                       | When to use                                                                                                              |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Workload identity federation | Preferred. Microsoft Entra access tokens are acquired for the signed-in identity, so no token is stored in the template. |
| Personal access token (PAT)  | Fallback. Pass the token through a `@secure()` parameter and set `pat` on each resource.                                 |

When running inside an Azure Pipeline, make sure the service principal behind the
service connection has the required permissions in the target organisation.

## Example

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

output projectId string = project.projectId
output repositoryRemoteUrl string = repository.remoteUrl
```

## Notes

- `organization` is the short organisation slug, not the full
  `https://dev.azure.com/...` URL.
- The extension is experimental and tracks the preview `local-deploy` feature of
  the Bicep CLI. Treat it as a sample rather than a supported product.
- Deleting a project through this extension deletes everything inside it. Review
  the plan output before confirming a deployment that removes resources.
