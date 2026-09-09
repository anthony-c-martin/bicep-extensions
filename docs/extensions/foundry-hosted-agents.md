## Overview

The extension deploys container-based Microsoft Foundry Hosted Agents through the
Foundry data plane REST API. A single resource type is exposed:

| Resource type | Purpose                                            |
| ------------- | -------------------------------------------------- |
| `HostedAgent` | A logical hosted agent and its immutable versions. |

## Authentication

Requests are authenticated with `DefaultAzureCredential`, so environment
variables, workload identity, managed identity or an Azure CLI login are all
picked up automatically. No token is stored in the template.

The deploying identity needs **Foundry Project Manager** on the Foundry project.
The project's managed identity needs **Container Registry Repository Reader** (or
**AcrPull** when the registry uses RBAC role assignments) so the platform can pull
the agent image.

## Targeting a project

Set the project endpoint once on the extension:

```bicep
extension foundry with {
  projectEndpoint: 'https://<account>.services.ai.azure.com/api/projects/<project>'
}
```

## Example

```bicep
targetScope = 'local'

extension foundry with {
  projectEndpoint: projectEndpoint
}

param projectEndpoint string

resource agent 'HostedAgent' = {
  name: 'hello-world-agent'
  image: '<registry>.azurecr.io/foundry-hosted-agents/python-responses-base@sha256:<digest>'
  cpu: '1'
  memory: '2Gi'
  protocols: [
    {
      protocol: 'responses'
      version: '2.0.0'
    }
  ]
  environmentVariables: {
    MODEL_DEPLOYMENT_NAME: 'gpt-4o'
  }
}

output responseEndpoint string = agent.endpoints.responses
```

## Versioning

Agent versions are immutable. A new version is created only when the desired
definition changes — including adding, removing or changing the optional
`raiPolicy` guardrail. The extension polls until the new version reports `active`
and surfaces provisioning errors. Deleting the resource removes the logical agent
and all of its versions.

## Notes

- Use immutable tags or digests for `image`. A replaced image behind an unchanged
  mutable tag such as `latest` cannot be detected, so no new version is created.
- The agent image must be Linux `amd64`.
- `memory` requires a `Mi` or `Gi` suffix, for example `2Gi`.
- Omit `raiPolicy` to deploy without a guardrail; an empty object (`raiPolicy: {}`)
  selects Foundry's `Microsoft.DefaultV2` policy. The extension references
  policies but does not create them.