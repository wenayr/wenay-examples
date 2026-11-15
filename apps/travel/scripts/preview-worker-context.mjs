import {AsyncLocalStorage} from 'node:async_hooks'
import {registerHooks} from 'node:module'

const owners = new AsyncLocalStorage()

export function runPreviewRequest(context, action) {
    return owners.run(context, action)
}

export function waitUntil(work) {
    const context = owners.getStore()
    if (!context) throw new Error('Фоновая задача preview запущена вне запроса.')
    context.waitUntil(work)
}

export async function loadPreviewWorker() {
    const hooks = registerHooks({
        resolve(specifier, context, nextResolve) {
            if (specifier == 'cloudflare:workers') return {url: import.meta.url, shortCircuit: true}
            return nextResolve(specifier, context)
        },
    })
    try { return (await import('../dist/server/index.js')).default }
    finally { hooks.deregister() }
}
