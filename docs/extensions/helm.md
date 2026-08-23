## Connecting to a cluster

The extension needs the contents of a kubeconfig file identifying the cluster to
deploy into:

```bicep
extension helm with {
  kubeConfig: loadTextContent('~/.kube/config')
}
```

Reading the file at deployment time keeps the cluster credentials out of your
template:

```bicep title="main.bicep"
@secure()
param kubeConfig string

extension helm with {
  kubeConfig: kubeConfig
}
```

```bicep title="main.bicepparam"
using 'main.bicep'

param kubeConfig = readEnvironmentVariable('KUBECONFIG_CONTENT')
```

## Example

```bicep
targetScope = 'local'

@secure()
param kubeConfig string

extension helm with {
  kubeConfig: kubeConfig
}

resource ingress 'Release' = {
  name: 'ingress-nginx'
  namespace: 'ingress'
  chart: 'ingress-nginx'
  repository: 'https://kubernetes.github.io/ingress-nginx'
  values: {
    controller: {
      replicaCount: 2
    }
  }
}
```

## Notes

- A `Release` maps to a Helm release. Updating the resource performs an upgrade,
  and removing it uninstalls the release.
- Chart values are supplied as a Bicep object, so they can be composed from
  parameters and expressions like any other Bicep value.
