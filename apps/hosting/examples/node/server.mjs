import http from 'node:http'

http.createServer(function serve(request, response) {
    response.statusCode = request.url == '/' || request.url == '/healthz' ? 200 : 404
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify({ok: true, runtime: 'node', version: '1'}))
}).listen(8080, '0.0.0.0')
