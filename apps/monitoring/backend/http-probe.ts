import {request as httpRequest} from 'node:http'
import {request as httpsRequest} from 'node:https'
import {isIP} from 'node:net'

export type ProbeTarget = {id: string, name: string, url: string, address: string}
export type ProbeResult = {outcome: 'up' | 'down' | 'unknown', latencyMs: number, code: number, detail: string}
export const DEMO_TARGETS: ProbeTarget[] = [
    {id: 'support', name: 'Northstar / поддержка', url: 'http://127.0.0.1:3810/health', address: '127.0.0.1'},
    {id: 'documents', name: 'Papertrail / документы', url: 'http://127.0.0.1:3811/health', address: '127.0.0.1'},
    {id: 'metering', name: 'Counter / потребление', url: 'http://127.0.0.1:3812/health', address: '127.0.0.1'}
]
export function probeTargets(value?: string): ProbeTarget[] {
    if (value == undefined) return DEMO_TARGETS.map(item => ({...item}))
    if (value.length > 16384) throw new Error('MONITOR_TARGETS_JSON exceeds 16 KiB')
    const targets: unknown = JSON.parse(value)
    if (!Array.isArray(targets) || targets.length > 100) throw new Error('MONITOR_TARGETS_JSON: array up to 100 operator targets')
    const seen = new Set<string>()
    // Цель описывает оператор: идентификатор, имя, адрес и IP проверяются по отдельности.
    function describedTarget(target: ProbeTarget) {
        if (!target || typeof target.id != 'string') return false
        if (!/^[a-z0-9-]{1,60}$/.test(target.id) || seen.has(target.id)) return false
        if (typeof target.name != 'string' || !target.name.trim() || target.name.length > 120) return false
        if (typeof target.url != 'string' || target.url.length > 2000) return false
        return typeof target.address == 'string' && isIP(target.address)
    }

    // Адрес — обычный http(s) без учётных данных; литеральный IP обязан совпасть с заявленным.
    function reachableUrl(url: URL, address: string) {
        if (!['http:', 'https:'].includes(url.protocol)) return false
        if (url.username || url.password || url.hash) return false
        const literal = url.hostname.replace(/^\[|\]$/g, '')
        return !isIP(literal) || literal == address
    }

    return targets.map((target: ProbeTarget) => {
        if (!describedTarget(target)) throw new Error('Invalid operator target')
        const url = new URL(target.url)
        if (!reachableUrl(url, target.address)) {
            throw new Error('Target needs HTTP(S), no credentials/fragment and a matching literal address')
        }
        seen.add(target.id)
        return {id: target.id, name: target.name.trim(), url: url.href, address: target.address}
    })
}
export function createHttpProbe(deps: {targets: readonly ProbeTarget[]}) {
    const targets = new Map(probeTargets(JSON.stringify(deps.targets)).map(target => [target.id, target]))
    async function check(input: {presetId: string, timeoutMs: number, signal: AbortSignal}): Promise<ProbeResult> {
        const target = targets.get(input.presetId)
        if (!target) return {outcome: 'unknown', latencyMs: 0, code: 0, detail: 'Цель отсутствует в настройках этого обработчика'}
        if (!Number.isInteger(input.timeoutMs) || input.timeoutMs < 100 || input.timeoutMs > 10000) throw new Error('Timeout 100–10000 ms')
        input.signal.throwIfAborted()
        const started = Date.now(), signal = AbortSignal.any([input.signal, AbortSignal.timeout(input.timeoutMs)])
        const url = new URL(target.url)
        const request = url.protocol == 'https:' ? httpsRequest : httpRequest
        return new Promise<ProbeResult>(function perform(resolve) {
            let settled = false
            function finish(outcome: ProbeResult['outcome'], code: number, detail: string) {
                if (settled) return
                settled = true
                resolve({outcome, code, detail, latencyMs: Math.min(12000, Date.now() - started)})
            }
            const call = request(url, {method: 'GET', agent: false, maxHeaderSize: 8192, signal,
                // Address pinning comes only from operator configuration. No DNS lookup and no redirect following.
                lookup(_hostname, options, callback) {
                    const family = isIP(target.address)
                    if (options.all) callback(null, [{address: target.address, family}])
                    else callback(null, target.address, family)
                }, headers: {'accept': 'application/json,text/plain', 'user-agent': 'Wenay-Monitor/1', 'connection': 'close'}}, function response(message) {
                const code = message.statusCode ?? 0
                if (code >= 300 && code < 400) {
                    finish('down', code, 'Перенаправление запрещено политикой проверки')
                    message.destroy()
                    return
                }
                let bytes = 0
                message.on('data', function data(chunk: Buffer) {
                    bytes += chunk.byteLength
                    if (bytes > 16384) {
                        finish('down', code, 'Ответ превышает 16 КиБ')
                        message.destroy()
                    }
                })
                message.once('end', function completed() {
                    const ok = code >= 200 && code < 300
                    const detail = ok ? 'Ответ получен' : 'HTTP ' + code
                    finish(ok ? 'up' : 'down', code, detail)
                })
                message.once('error', () => finish('down', code, 'Чтение ответа прервано'))
            })
            call.once('error', function failed() {
                const outcome = input.signal.aborted ? 'unknown' : 'down'
                const detail = signal.aborted ? 'Проверка прервана или истёк срок' : 'Соединение не установлено'
                finish(outcome, 0, detail)
            })
            call.end()
        })
    }
    return {control: {check}, view: {presets: () => [...targets.values()].map(({id, name}) => ({id, name}))}}
}
