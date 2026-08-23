## Connecting to a cluster

The extension needs a kubeconfig file, **base-64 encoded**, and the namespace to
deploy into:

```bicep
@secure()
param kubeConfig string

extension kubernetes with {
  kubeConfig: kubeConfig
  namespace: 'default'
}
```

Encode an existing kubeconfig with:

```bash
base64 -i ~/.kube/config
```

```bicep title="main.bicepparam"
using 'main.bicep'

param kubeConfig = readEnvironmentVariable('KUBECONFIG_BASE64')
```

A kubeconfig can define several clusters. Set `context` to choose one; when it is
omitted the file's current context is used:

```bicep
extension kubernetes with {
  kubeConfig: kubeConfig
  namespace: 'default'
  context: 'staging-cluster'
}
```

## Example

```bicep
targetScope = 'local'

@secure()
param kubeConfig string

extension kubernetes with {
  kubeConfig: kubeConfig
  namespace: 'default'
}

resource deployment 'apps/Deployment@v1' = {
  metadata: {
    name: 'web'
  }
  spec: {
    replicas: 2
    selector: {
      matchLabels: {
        app: 'web'
      }
    }
    template: {
      metadata: {
        labels: {
          app: 'web'
        }
      }
      spec: {
        containers: [
          {
            name: 'web'
            image: 'nginx:1.27'
          }
        ]
      }
    }
  }
}
```

## Notes

- Resource types follow the Kubernetes group, kind and version convention, such
  as `apps/Deployment@v1` or `core/Pod@v1`. Alpha and beta API versions are
  exposed alongside stable ones, for example
  `admissionregistration.k8s.io/ValidatingAdmissionPolicy@v1beta1`.
- Every object requires `metadata.name`. Set `metadata.namespace` to override the
  extension's default namespace for an individual resource.
- Properties marked read-only, such as `apiVersion`, `kind` and `status`, are
  populated by the cluster and cannot be set.
- The machine running the deployment needs network access to the cluster's API
  server.
