import assert from 'node:assert/strict'
import {createHash, generateKeyPairSync, randomUUID, sign} from 'node:crypto'
import type {Server} from 'node:http'
import express from 'express'
import {createOidc, type ExternalIdentity} from './oidc'

type tMode = 'valid' | 'nonce' | 'issuer' | 'audience' | 'expired' | 'signature' | 'denied'
type Authorization = {nonce: string, challenge: string, redirect: string, mode: tMode}

async function listen(app: ReturnType<typeof express>) {
    const server = await new Promise<Server>(resolve => {
        const value = app.listen(0, '127.0.0.1', () => resolve(value))
    })
    const address = server.address()
    if (!address || typeof address == 'string') throw new Error('Не удалось запустить локальную проверку')
    return {server, origin: 'http://127.0.0.1:' + address.port}
}

async function close(server: Server) {
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
}

function cookie(response: Response) {
    return response.headers.getSetCookie()[0]?.split(';')[0] ?? ''
}

async function check() {
    const signing = generateKeyPairSync('rsa', {modulusLength: 2048})
    const wrongSigning = generateKeyPairSync('rsa', {modulusLength: 2048})
    const jwk = {...signing.publicKey.export({format: 'jwk'}), kid: 'local-check-key', use: 'sig', alg: 'RS256'}
    const codes = new Map<string, Authorization>()
    const provider = express()
    let mode: tMode = 'valid'
    let badDiscovery = false
    let foreignEndpoint = false
    let currentTime = Date.now()
    let tokenCalls = 0
    let jwksCalls = 0
    let rejectedVerifier = false
    provider.use(express.urlencoded({extended: false}))
    const remote = await listen(provider)
    provider.get('/.well-known/openid-configuration', function metadata(_req, res) {
        res.json({
            issuer: badDiscovery ? 'https://untrusted.invalid' : remote.origin,
            authorization_endpoint: remote.origin + '/authorize',
            token_endpoint: foreignEndpoint ? 'https://untrusted.invalid/token' : remote.origin + '/token',
            jwks_uri: remote.origin + '/jwks',
            response_types_supported: ['code'], subject_types_supported: ['public'],
            id_token_signing_alg_values_supported: ['RS256'], token_endpoint_auth_methods_supported: ['client_secret_post'],
            code_challenge_methods_supported: ['S256'], authorization_response_iss_parameter_supported: true
        })
    })
    provider.get('/jwks', function keys(_req, res) {jwksCalls++; res.json({keys: [jwk]})})
    provider.get('/authorize', function authorize(req, res) {
        assert.equal(req.query.client_id, 'support-local-check')
        assert.equal(req.query.response_type, 'code')
        assert.equal(req.query.code_challenge_method, 'S256')
        assert.equal(req.query.scope, 'openid profile')
        assert.ok(typeof req.query.nonce == 'string' && req.query.nonce.length >= 32)
        const url = new URL(String(req.query.redirect_uri))
        const code = randomUUID()
        codes.set(code, {nonce: String(req.query.nonce), challenge: String(req.query.code_challenge), redirect: url.href, mode})
        if (mode == 'denied') url.searchParams.set('error', 'access_denied')
        else url.searchParams.set('code', code)
        url.searchParams.set('state', String(req.query.state))
        url.searchParams.set('iss', remote.origin)
        res.redirect(url.href)
    })
    provider.post('/token', function token(req, res) {
        tokenCalls++
        assert.equal(req.body.client_id, 'support-local-check')
        assert.equal(req.body.client_secret, 'local-client-secret')
        assert.equal(req.body.grant_type, 'authorization_code')
        const code = String(req.body.code)
        const authorization = codes.get(code)
        codes.delete(code)
        if (!authorization) return res.status(400).json({error: 'invalid_grant'})
        const actual = createHash('sha256').update(String(req.body.code_verifier)).digest('base64url')
        if (rejectedVerifier || actual != authorization.challenge || req.body.redirect_uri != authorization.redirect) return res.status(400).json({error: 'invalid_grant'})
        const timestamp = Math.floor(Date.now() / 1000)
        const claims = {
            iss: authorization.mode == 'issuer' ? 'https://untrusted.invalid' : remote.origin,
            sub: 'verified-local-person', name: 'Новый участник',
            aud: authorization.mode == 'audience' ? 'another-client' : 'support-local-check',
            iat: timestamp, exp: authorization.mode == 'expired' ? timestamp - 3600 : timestamp + 300,
            nonce: authorization.mode == 'nonce' ? 'another-nonce' : authorization.nonce
        }
        const header = Buffer.from(JSON.stringify({alg: 'RS256', kid: 'local-check-key', typ: 'JWT'})).toString('base64url')
        const payload = Buffer.from(JSON.stringify(claims)).toString('base64url')
        const body = header + '.' + payload
        const signature = sign('RSA-SHA256', Buffer.from(body), authorization.mode == 'signature' ? wrongSigning.privateKey : signing.privateKey).toString('base64url')
        res.json({access_token: 'local-access-token', token_type: 'Bearer', expires_in: 300, id_token: body + '.' + signature})
    })

    const app = express()
    const local = await listen(app)
    const provisions: ExternalIdentity[] = []
    const logins: string[] = []
    const config = {issuer: remote.origin, origin: local.origin, clientId: 'support-local-check', clientSecret: 'local-client-secret', allowLoopbackHttp: true}
    const adapter = createOidc({config, now: () => currentTime,
        provision: async identity => {provisions.push(identity); return 'external-local-person'},
        login: account => {logins.push(account); return {token: 'library-session-' + logins.length}}
    })
    adapter.mount(app)

    async function start() {
        const response = await fetch(local.origin + '/auth/oidc/start', {redirect: 'manual'})
        assert.equal(response.status, 303)
        assert.equal(response.headers.get('cache-control'), 'no-store')
        assert.match(response.headers.get('set-cookie') ?? '', /HttpOnly/)
        assert.match(response.headers.get('set-cookie') ?? '', /SameSite=Lax/)
        return {url: response.headers.get('location')!, cookie: cookie(response)}
    }

    async function authorize(flow: Awaited<ReturnType<typeof start>>) {
        const response = await fetch(flow.url, {redirect: 'manual'})
        assert.equal(response.status, 302)
        return response.headers.get('location')!
    }

    async function callback(url: string, flowCookie = '') {
        return fetch(url, {redirect: 'manual', headers: {cookie: flowCookie}})
    }

    async function exchange(handoffCookie: string, origin = local.origin, customHeader = '1') {
        return fetch(local.origin + '/auth/oidc/exchange', {method: 'POST', headers: {cookie: handoffCookie, origin, 'X-OIDC-Exchange': customHeader}})
    }

    try {
        const status = await fetch(local.origin + '/auth/oidc/status')
        assert.deepEqual(await status.json(), {enabled: true})
        badDiscovery = true
        assert.equal((await fetch(local.origin + '/auth/oidc/start', {redirect: 'manual'})).status, 503)
        badDiscovery = false
        foreignEndpoint = true
        assert.equal((await fetch(local.origin + '/auth/oidc/start', {redirect: 'manual'})).status, 503)
        foreignEndpoint = false

        const first = await start()
        const next = await start()
        assert.notEqual(new URL(first.url).searchParams.get('state'), new URL(next.url).searchParams.get('state'))
        assert.notEqual(new URL(first.url).searchParams.get('nonce'), new URL(next.url).searchParams.get('nonce'))
        assert.notEqual(new URL(first.url).searchParams.get('code_challenge'), new URL(next.url).searchParams.get('code_challenge'))
        const url = await authorize(first)
        assert.equal((await callback(url)).status, 400, 'callback requires browser-bound cookie')
        const changedState = new URL(url)
        changedState.searchParams.set('state', 'untrusted-state')
        const beforeMismatch = tokenCalls
        assert.equal((await callback(changedState.href, next.cookie)).status, 400)
        assert.equal(tokenCalls, beforeMismatch, 'state rejected before token request')
        const done = await callback(url, first.cookie)
        assert.equal(done.status, 303)
        assert.equal(done.headers.get('location'), local.origin + '/')
        assert.ok(!done.headers.get('location')!.includes('token'))
        assert.equal(provisions.length, 0, 'callback does not provision until bound exchange')
        const handoff = cookie(done)
        assert.notEqual(handoff, first.cookie, 'cookie rotates after verified login')
        assert.equal((await callback(url, first.cookie)).status, 400, 'callback is one-use')
        assert.equal((await exchange(handoff, 'https://foreign.invalid')).status, 403)
        assert.equal((await exchange(handoff, local.origin, '')).status, 403)
        const exchanged = await exchange(handoff)
        assert.equal(exchanged.status, 200)
        assert.deepEqual(await exchanged.json(), {token: 'library-session-1'})
        assert.deepEqual(provisions, [{issuer: remote.origin, subject: 'verified-local-person', name: 'Новый участник'}])
        assert.deepEqual(logins, ['external-local-person'])
        assert.equal((await exchange(handoff)).status, 204, 'handoff cannot replay')
        assert.ok(jwksCalls > 0, 'real JWS signature verification fetched issuer keys')

        for (const invalid of ['nonce', 'issuer', 'audience', 'expired', 'signature', 'denied'] as const) {
            mode = invalid
            const flow = await start()
            const rejected = await callback(await authorize(flow), flow.cookie)
            assert.equal(rejected.status, 400, invalid + ' rejected')
            assert.ok(!(await rejected.text()).includes('local-client-secret'))
            assert.equal(provisions.length, 1, invalid + ' cannot provision')
        }
        mode = 'valid'
        rejectedVerifier = true
        const verifierFlow = await start()
        assert.equal((await callback(await authorize(verifierFlow), verifierFlow.cookie)).status, 400, 'token endpoint PKCE rejection respected')
        rejectedVerifier = false

        const expiredFlow = await start()
        const expiredUrl = await authorize(expiredFlow)
        currentTime += 301000
        const beforeExpiry = tokenCalls
        assert.equal((await callback(expiredUrl, expiredFlow.cookie)).status, 400, 'expired browser flow rejected')
        assert.equal(tokenCalls, beforeExpiry)
        const handoffFlow = await start()
        const handoffResponse = await callback(await authorize(handoffFlow), handoffFlow.cookie)
        assert.equal(handoffResponse.status, 303)
        currentTime += 61000
        assert.equal((await exchange(cookie(handoffResponse))).status, 204, 'expired handoff rejected')

        const concurrent = await start()
        const concurrentUrl = await authorize(concurrent)
        const both = await Promise.all([callback(concurrentUrl, concurrent.cookie), callback(concurrentUrl, concurrent.cookie)])
        assert.deepEqual(both.map(response => response.status).sort(), [303, 400])
        const success = both.find(response => response.status == 303)!
        const bothExchanges = await Promise.all([exchange(cookie(success)), exchange(cookie(success))])
        assert.deepEqual(bothExchanges.map(response => response.status).sort(), [200, 204])
        assert.equal(provisions.length, 2)
        assert.equal(logins.length, 2)

        assert.throws(() => createOidc({config: {...config, allowLoopbackHttp: false}, provision: async () => '', login: () => ({token: ''})}), /HTTPS/)
        assert.throws(() => createOidc({config: {...config, issuer: 'http://remote.example'}, provision: async () => '', login: () => ({token: ''})}), /HTTPS/)
        assert.throws(() => createOidc({config: {...config, origin: local.origin + '/subpath'}, provision: async () => '', login: () => ({token: ''})}), /origin/)
        assert.throws(() => createOidc({config: {...config, issuer: remote.origin + '/.well-known/openid-configuration'}, provision: async () => '', login: () => ({token: ''})}), /issuer/)
        adapter.close()
        assert.equal((await fetch(local.origin + '/auth/oidc/start', {redirect: 'manual'})).status, 404)
        assert.equal((await exchange('')).status, 204)
        console.log('OIDC checks passed: local issuer discovery, PKCE, browser state, nonce, issuer/audience/expiry/signature, single-use callback/exchange, same-origin, TTL, disabled and concurrent requests')
    } finally {
        adapter.close()
        await close(local.server)
        await close(remote.server)
    }
}

check().catch(function failed(error) {console.error(error); process.exitCode = 1})
