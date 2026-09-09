## Authentication

Set `CLOUDFLARE_API_TOKEN` to a Cloudflare API token before running the
deployment. Give the token only the permissions needed by the resources in the
template, such as Zone DNS Edit for DNS records or Zone Rulesets Edit for WAF
custom rules.

## Example

Create a DNS record in a Cloudflare zone:

```bicep
targetScope = 'local'

extension Cloudflare

param zoneId string
param domainName string

resource record 'DnsRecord' = {
  name: 'www'
  zoneName: domainName
  zoneId: zoneId
  type: 'A'
  content: '192.0.2.1'
  ttl: 300
  proxied: true
}
```

## Notes

- Security rules use Cloudflare WAF custom rules through the Rulesets API.
- Redirect rules use Page Rules and are subject to the limits of the
  Cloudflare plan associated with the zone.
- This extension is experimental and its publisher advises against production
  use.
