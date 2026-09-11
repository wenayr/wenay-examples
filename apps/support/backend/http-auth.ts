// Канон: shared/backend/http-auth.ts. Копии в приложениях синхронизируются scripts/sync.mjs;
// правьте здесь или поднимите правку из приложения: sync.mjs --from=<приложение>.
import type {RequestHandler} from 'express'

// Аутентификацию разрешает собственный identity authority сервиса.
// Middleware подставляет полученный account первым аргументом: вызывающий
// не может выбрать аккаунт сам, передав его в теле запроса.
export function authenticatedArgs(deps: {account: (token: string) => string}): RequestHandler {
    return function authenticate(request, response, next) {
        response.setHeader('Cache-Control', 'no-store')
        const header = request.get('authorization') ?? ''
        let account: string
        try {
            if (!header.startsWith('Bearer ') || header.length > 16000) throw new Error('token')
            account = deps.account(header.slice(7))
            if (!account) throw new Error('account')
        } catch {
            response.status(401).json({ok: false, error: {message: 'Требуется действующая сессия'}})
            return
        }
        const args = Array.isArray(request.body) ? request.body : request.body?.args
        if (!Array.isArray(args) || args.length != 1) {
            response.status(400).json({ok: false, error: {message: 'Ожидается один объект в args'}})
            return
        }
        request.body = {args: [account, args[0]]}
        next()
    }
}
