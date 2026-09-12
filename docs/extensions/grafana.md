## Authentication

The extension calls the Grafana HTTP API directly. Configure the Grafana endpoint
and a token with permission to manage the resources in your template:

```bicep
@secure()
param grafanaToken string

param grafanaUrl string

extension grafana with {
  baseUrl: grafanaUrl
  token: grafanaToken
}
```

Keep the token out of source control by supplying it through a secure parameter or
a deployment environment variable. The token can be a Grafana service account
token or an Azure Managed Grafana Microsoft Entra access token.

## Resources

The extension manages these Grafana data-plane resources:

- `Folder`, identified by its stable `uid`.
- `DataSource`, identified by its stable `uid`.
- `Dashboard`, identified by its stable `uid`.

JSON properties such as `definitionJson`, `jsonDataJson`, and
`secureJsonDataJson` accept serialized JSON strings. The secure data source
property is write-only and is omitted from deployment outputs.

## Example

Create a folder, a Prometheus data source, and a dashboard:

```bicep title="main.bicep"
targetScope = 'local'

@description('The absolute URL of the Grafana instance.')
param grafanaUrl string

@secure()
@description('A Grafana token with folder, data source, and dashboard permissions.')
param grafanaToken string

@description('The URL of the Prometheus server.')
param prometheusUrl string

extension grafana with {
  baseUrl: grafanaUrl
  token: grafanaToken
}

resource operations 'Folder' = {
  uid: 'operations'
  title: 'Operations'
  description: 'Operational dashboards managed by Bicep'
}

resource prometheus 'DataSource' = {
  uid: 'prometheus'
  name: 'Prometheus'
  type: 'prometheus'
  url: prometheusUrl
  access: 'proxy'
  isDefault: true
  jsonDataJson: string({
    httpMethod: 'POST'
    timeInterval: '30s'
  })
}

resource overview 'Dashboard' = {
  uid: 'operations-overview'
  title: 'Operations overview'
  folderUid: operations.uid
  message: 'Managed by Bicep'
  definitionJson: string({
    tags: [
      'bicep'
      'operations'
    ]
    timezone: 'browser'
    schemaVersion: 41
    refresh: '30s'
    time: {
      from: 'now-6h'
      to: 'now'
    }
    panels: [
      {
        id: 1
        type: 'timeseries'
        title: 'Prometheus up'
        datasource: {
          type: 'prometheus'
          uid: prometheus.uid
        }
        targets: [
          {
            refId: 'A'
            expr: 'up'
          }
        ]
        gridPos: {
          h: 8
          w: 24
          x: 0
          y: 0
        }
      }
    ]
  })
}

output dashboardUid string = overview.uid
```

## Azure Managed Grafana

The extension does not create or configure the Azure Managed Grafana control-plane
resource. Create the workspace with the standard `Microsoft.Dashboard/grafana`
resource, then use this extension against its endpoint.

For Microsoft Entra authentication, request a token for the
`https://dashboard.azure.com` audience and grant the deploying identity an
appropriate Grafana role. The endpoint must be available when the local deploy
starts, so a workspace created in an earlier deployment stage may be required.

## Notes

- The Grafana URL may be supplied with or without the `/api` suffix.
- Resource updates are applied as upserts through the Grafana API.
- Use a narrowly scoped service account token or Entra identity rather than an
  administrator token where possible.
