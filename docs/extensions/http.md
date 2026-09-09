## Authentication

Depending on the setup, the extension does not require any authentication.

## Example

Perform specific HTTP calls:
Actions:

```bicep
targetScope = 'local'
extension http

var callBody = loadTextContent('sample/body.json')

resource getHttp 'httpcall' = {
  name: 'getcall'
  url: 'https://bicep-local.free.beeceptor.com'
  method: 'Get'
}

resource postHttp 'httpcall' = {
  name: 'postcall'
  url: 'https://bicep-local.free.beeceptor.com'
  method: 'Post'
  headers: [
    {name: 'Content-Type', value: 'application/json' }
  ]
  body: callBody
}

resource deleteHttp 'httpcall' = {
  name: 'deletecall'
  url: 'https://bicep-local.free.beeceptor.com/1'
  method: 'Delete'
}

output getResponse object = json(getHttp.result)
output getStatusCode int = getHttp.statusCode
output postResponse object = json(postHttp.result)
output postStatusCode int = postHttp.statusCode
output deleteStatusCode int = deleteHttp.statusCode
```
