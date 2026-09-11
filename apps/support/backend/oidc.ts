import * as oidc from 'openid-client'
import type {Express, Request, Response} from 'express'

export type OidcConfig = {
    issuer: string
    clientId: string
    clientSecret?: string
    origin: string
    endpointOrigins?: string[]
    allowLoopbackHttp?: boolean
}

export type ExternalIdentity = {issuer: string, subject: string, name: string}
type Pending = {state: string, nonce: string, verifier: string, expiresAt: number}
type Handoff = {identity: ExternalIdentity, expiresAt: number}

const startPath = '/auth/oidc/start'
const callbackPath = '/auth/oidc/callback'
const exchangePath = '/auth/oidc/exchange'
const flowTtl = 5 * 60 * 1000
const handoffTtl = 60 * 1000
const capacity = 1000

export function createOidc<T extends {token: string}>(deps: {
    config?: OidcConfig
    provision: (identity: ExternalIdentity) => Promise<string>
    login: (account: string) => T | Promise<T>
    now?: () => number
}) {
    const config = deps.config
    const now = deps.now ?? Date.now
    const pending = new Map<string, Pending>()
    const handoffs = new Map<string, Handoff>()
    const origin = config ? validUrl(config.origin, 'Адрес приложения') : undefined
    const issuer = config ? validUrl(config.issuer, 'OIDC issuer') : undefined
    if (origin && (origin.pathname != '/' || origin.search || origin.hash)) throw new Error('OIDC origin должен содержать только origin приложения')
    if (issuer && (issuer.search || issuer.hash || issuer.pathname.includes('/.well-known/'))) throw new Error('Укажите issuer, а не адрес discovery-документа')
    if (config && (!config.clientId.trim() || config.clientId.length > 1000)) throw new Error('Не задан OIDC clientId')
    const endpointOrigins = new Set([issuer?.origin, ...(config?.endpointOrigins ?? []).map(value => {
        const url = validUrl(value, 'Origin OIDC endpoint')
        if (url.pathname != '/' || url.search || url.hash) throw new Error('endpointOrigins принимает только origin')
        return url.origin
    })])
    const secure = origin?.protocol == 'https:'
    const cookieName = secure ? '__Host-support-oidc' : 'support-oidc-loopback'
    const cookieOptions = {httpOnly: true, secure, sameSite: 'lax', path: '/'} as const
    const redirectUri = origin ? new URL(callbackPath, origin).href : ''
    let discovery: Promise<oidc.Configuration> | undefined
    let closed = false

    function validUrl(value: string, label: string) {
        let url: URL
        try {url = new URL(value)}
        catch {throw new Error(label + ': некорректный адрес')}
        const loopback = ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname)
        if (url.username || url.password || (url.protocol != 'https:' && !(config?.allowLoopbackHttp && loopback && url.protocol == 'http:'))) {
            throw new Error(label + ': необходим HTTPS; HTTP разрешён только явно включённому loopback')
        }
        return url
    }

    function checkEndpoint(value: string) {
        const url = validUrl(value, 'OIDC endpoint')
        if (!endpointOrigins.has(url.origin)) throw new Error('Origin OIDC endpoint отсутствует в конфигурации')
        return url
    }

    async function providerFetch(...args: Parameters<oidc.CustomFetch>) {
        checkEndpoint(String(args[0]))
        // An issuer's redirect must not forward a client secret to another host.
        const body = args[1].body instanceof Uint8Array ? new Uint8Array(args[1].body) : args[1].body
        return fetch(args[0], {...args[1], body, redirect: 'error'})
    }

    async function getClient() {
        if (!config || !issuer || closed) throw new Error('OIDC отключён')
        if (!discovery) {
            discovery = oidc.discovery(issuer, config.clientId, config.clientSecret, config.clientSecret ? oidc.ClientSecretPost(config.clientSecret) : oidc.None(), {
                timeout: 10,
                [oidc.customFetch]: providerFetch,
                execute: [oidc.enableNonRepudiationChecks, ...(config.allowLoopbackHttp ? [oidc.allowInsecureRequests] : [])]
            }).then(function validateMetadata(client) {
                const metadata = client.serverMetadata()
                if (metadata.issuer != config.issuer) throw new Error('OIDC issuer не совпадает')
                for (const field of ['authorization_endpoint', 'token_endpoint', 'jwks_uri'] as const) {
                    const endpoint = metadata[field]
                    if (!endpoint) throw new Error('Не задан обязательный OIDC endpoint')
                    checkEndpoint(endpoint)
                }
                return client
            }).catch(function forgetFailure(error) {
                discovery = undefined
                throw error
            })
        }
        return discovery
    }

    function sweep() {
        for (const [id, flow] of pending) if (flow.expiresAt <= now()) pending.delete(id)
        for (const [id, flow] of handoffs) if (flow.expiresAt <= now()) handoffs.delete(id)
    }

    function readCookie(req: Request) {
        const values = (req.headers.cookie ?? '').split(';').map(part => part.trim()).filter(part => part.startsWith(cookieName + '='))
        if (values.length != 1) return ''
        const value = values[0].slice(cookieName.length + 1)
        return /^[A-Za-z0-9_-]{32,128}$/.test(value) ? value : ''
    }

    function noStore(res: Response) {
        res.set({'Cache-Control': 'no-store', 'Pragma': 'no-cache', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff'})
    }

    function failure(res: Response, status = 400) {
        noStore(res)
        res.clearCookie(cookieName, cookieOptions)
        res.set('Content-Security-Policy', "default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'")
        res.status(status).type('html').send('<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="referrer" content="no-referrer"><title>Вход не завершён</title><h1>Вход не завершён</h1><p>Ссылка устарела или провайдер не подтвердил вход. Начните заново.</p><a href="/">Вернуться в поддержку</a></html>')
    }

    async function start(req: Request, res: Response) {
        noStore(res)
        if (!config || closed) return failure(res, 404)
        sweep()
        const previous = readCookie(req)
        pending.delete(previous)
        handoffs.delete(previous)
        if (pending.size + handoffs.size >= capacity) return failure(res, 503)
        try {
            const client = await getClient()
            const id = oidc.randomState()
            const state = oidc.randomState()
            const nonce = oidc.randomNonce()
            const verifier = oidc.randomPKCECodeVerifier()
            const challenge = await oidc.calculatePKCECodeChallenge(verifier)
            if (closed || pending.size + handoffs.size >= capacity) return failure(res, 503)
            const url = oidc.buildAuthorizationUrl(client, {
                redirect_uri: redirectUri, scope: 'openid profile', response_mode: 'query',
                code_challenge: challenge, code_challenge_method: 'S256', state, nonce
            })
            pending.set(id, {state, nonce, verifier, expiresAt: now() + flowTtl})
            res.cookie(cookieName, id, {...cookieOptions, maxAge: flowTtl})
            res.redirect(303, url.href)
        } catch {
            failure(res, 503)
        }
    }

    async function callback(req: Request, res: Response) {
        noStore(res)
        sweep()
        const id = readCookie(req)
        const flow = pending.get(id)
        // Consume before the network request so simultaneous callbacks cannot both succeed.
        pending.delete(id)
        if (!config || closed || !flow || req.originalUrl.length > 8192) return failure(res)
        try {
            const url = new URL(req.originalUrl, origin)
            if (url.origin != origin!.origin || url.pathname != callbackPath) return failure(res)
            const tokens = await oidc.authorizationCodeGrant(await getClient(), url, {
                pkceCodeVerifier: flow.verifier, expectedState: flow.state, expectedNonce: flow.nonce, idTokenExpected: true
            })
            const claims = tokens.claims()
            if (closed || !claims || claims.iss != config.issuer || typeof claims.sub != 'string' || !claims.sub || claims.sub.length > 255) return failure(res)
            const identity = {issuer: claims.iss, subject: claims.sub, name: typeof claims.name == 'string' && claims.name.trim() ? claims.name.trim().slice(0, 160) : 'Участник'}
            const handoffId = oidc.randomState()
            handoffs.set(handoffId, {identity, expiresAt: now() + handoffTtl})
            res.cookie(cookieName, handoffId, {...cookieOptions, maxAge: handoffTtl})
            // Only an opaque HttpOnly cookie crosses the redirect. No bearer token in URLs or HTML.
            res.redirect(303, origin!.origin + '/')
        } catch {
            failure(res)
        }
    }

    async function exchange(req: Request, res: Response) {
        noStore(res)
        if (!config || closed) return res.status(204).end()
        // A cross-site form cannot supply this header; exact Origin rejects foreign fetches.
        if (req.get('Origin') != origin!.origin || req.get('X-OIDC-Exchange') != '1') return res.status(403).json({error: 'Вход доступен только с адреса приложения'})
        sweep()
        const id = readCookie(req)
        const handoff = handoffs.get(id)
        if (!handoff) return res.status(204).end()
        handoffs.delete(id)
        res.clearCookie(cookieName, cookieOptions)
        try {
            const account = await deps.provision(handoff.identity)
            if (closed) return res.status(503).json({error: 'Вход временно недоступен'})
            const session = await deps.login(account)
            if (closed) return res.status(503).json({error: 'Вход временно недоступен'})
            return res.json(session)
        } catch {
            return res.status(403).json({error: 'Не удалось открыть аккаунт. Начните вход заново.'})
        }
    }

    function mount(app: Express) {
        app.get('/auth/oidc/status', function status(_req, res) {noStore(res); res.json({enabled: !!config && !closed})})
        app.get(startPath, start)
        app.get(callbackPath, callback)
        app.post(exchangePath, exchange)
    }

    function close() {
        closed = true
        pending.clear()
        handoffs.clear()
        discovery = undefined
    }

    return {mount, close, enabled: !!config}
}

export type Oidc = ReturnType<typeof createOidc>
