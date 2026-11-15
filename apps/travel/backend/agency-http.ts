import {AgencyError, agencyIdentity, type Agencies} from './agency.ts'
import {packageJson} from './package-http.ts'

async function readBody(request: Request) {
    if (!request.headers.get('content-type')?.startsWith('application/json')) throw new AgencyError(415, 'content_type', 'Используйте JSON.')
    const reader = request.body?.getReader()
    if (!reader) throw new AgencyError(400, 'invalid', 'Запрос пуст.')
    const chunks: Uint8Array[] = []
    let size = 0
    try {
        while (true) {
            const chunk = await reader.read()
            if (chunk.done) break
            size += chunk.value.byteLength
            if (size > 16_384) {
                await reader.cancel()
                throw new AgencyError(413, 'too_large', 'Слишком большой запрос.')
            }
            chunks.push(chunk.value)
        }
        const bytes = new Uint8Array(size)
        let offset = 0
        for (const chunk of chunks) {
            bytes.set(chunk, offset)
            offset += chunk.byteLength
        }
        return JSON.parse(new TextDecoder().decode(bytes)) as unknown
    } catch (error) {
        if (error instanceof AgencyError) throw error
        throw new AgencyError(400, 'invalid', 'Некорректный JSON.')
    } finally { reader.releaseLock() }
}

export function createAgencyHttp(deps: {agencies: Agencies}) {
    async function handle(request: Request) {
        const url = new URL(request.url)
        const path = url.pathname
        const publicMatch = /^\/api\/travel\/storefront\/([a-z0-9-]{3,40})(\/leads)?$/.exec(path)
        const privatePath = path == '/api/travel/agency' || path.startsWith('/api/travel/agency/')
        if (!privatePath && !publicMatch) return null
        const owner = agencyIdentity(request)
        if (!owner && !publicMatch) {
            if (path == '/api/travel/agency' && request.method == 'GET') {
                return packageJson(200, {authenticated: false, storageAvailable: false, agency: null, leads: []})
            }
            return packageJson(401, {error: 'Войдите через ChatGPT, чтобы открыть кабинет.', code: 'unauthorized'})
        }
        try {
            if (request.method != 'GET') {
                const origin = request.headers.get('origin')
                const crossSite = request.headers.get('sec-fetch-site') == 'cross-site'
                if (crossSite || origin && origin != url.origin) throw new AgencyError(403, 'origin', 'Откройте кабинет на этом сайте.')
            }
            if (publicMatch) {
                if (!publicMatch[2] && request.method == 'GET') return packageJson(200, {agency: await deps.agencies.view.storefront(publicMatch[1])})
                if (publicMatch[2] && request.method == 'POST') {
                    return packageJson(201, await deps.agencies.control.submitLead(publicMatch[1], await readBody(request)))
                }
                const method = publicMatch[2] ? 'POST' : 'GET'
                return packageJson(405, {error: 'Используйте ' + method + '.'}, {Allow: method})
            }
            if (!owner) throw new AgencyError(401, 'unauthorized', 'Войдите через ChatGPT.')
            if (path == '/api/travel/agency') {
                if (request.method == 'GET') return packageJson(200, await deps.agencies.view.get(owner))
                if (request.method == 'POST') return packageJson(201, await deps.agencies.control.create(owner, await readBody(request)))
                if (request.method == 'PUT') return packageJson(200, await deps.agencies.control.update(owner, await readBody(request)))
                return packageJson(405, {error: 'Используйте GET, POST или PUT.'}, {Allow: 'GET, POST, PUT'})
            }
            if (path == '/api/travel/agency/leads') {
                if (request.method == 'GET') return packageJson(200, {leads: (await deps.agencies.view.get(owner)).leads})
                if (request.method == 'POST') return packageJson(201, {lead: await deps.agencies.control.addLead(owner, await readBody(request))})
                return packageJson(405, {error: 'Используйте GET или POST.'}, {Allow: 'GET, POST'})
            }
            const match = /^\/api\/travel\/agency\/leads\/([a-zA-Z0-9-]{1,80})$/.exec(path)
            if (match) {
                if (request.method != 'PATCH') return packageJson(405, {error: 'Используйте PATCH.'}, {Allow: 'PATCH'})
                return packageJson(200, {lead: await deps.agencies.control.updateLead(owner, match[1], await readBody(request))})
            }
            return packageJson(404, {error: 'Раздел кабинета не найден.'})
        } catch (error) {
            if (error instanceof AgencyError) return packageJson(error.status, {error: error.message, code: error.code})
            return packageJson(503, {error: 'Не удалось сохранить или прочитать кабинет. Данные не изменены.', code: 'storage_unavailable'})
        }
    }
    return {handle}
}
