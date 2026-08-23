## Overview

A collection of general purpose helpers for local deployments. The extension
needs no configuration:

```bicep
extension utilities
```

| Resource type | Purpose |
| --- | --- |
| `Wait` | Pause for a period, for example while another resource settles. |
| `Script` | Run a script as part of the deployment. |
| `Command` | Run a single command and capture its output. |
| `Assert` | Fail the deployment when a condition is not met. |

## Example

```bicep
targetScope = 'local'

extension utilities

resource settle 'Wait' = {
  duration: 'PT30S'
}

resource version 'Command' = {
  command: 'git'
  arguments: ['rev-parse', '--short', 'HEAD']
}

output commit string = version.stdout
```

## Notes

- These resources run commands on the machine performing the deployment, with
  that machine's privileges. Treat their inputs as you would any other script
  input.
- `Command` and `Script` are not idempotent by nature — they execute on every
  deployment.
