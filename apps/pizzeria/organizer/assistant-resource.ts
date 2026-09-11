import {createAiRunHost, type AiRunRunner, type AiRunUsage} from 'wenay-common2/ai'
import {openAiCheckpoint} from './ai-checkpoint'

export type AssistantProvider = {transcribe(input: {bytes: Uint8Array, signal: AbortSignal}): Promise<{text: string, usage?: AiRunUsage}>}
export type Proposal = {transcript: string, items: {title: string, due: string, assignee: string}[], demo: boolean}

// The recorder produces this bounded PCM WAV format; arbitrary attachments are not audio input.
export function validateVoice(bytes: Uint8Array) {
    if (!(bytes instanceof Uint8Array) || bytes.length < 46 || bytes.length > 480044) throw new Error('Некорректный размер голосового сообщения')
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const tag = (at: number, length: number) => String.fromCharCode(...bytes.subarray(at, at + length))
    const rate = view.getUint32(24, true)
    if (tag(0, 4) != 'RIFF' || tag(8, 8) != 'WAVEfmt ' || tag(36, 4) != 'data' ||
        view.getUint32(4, true) != bytes.length - 8 || view.getUint32(16, true) != 16 ||
        view.getUint16(20, true) != 1 || view.getUint16(22, true) != 1 ||
        rate < 8000 || rate > 96000 || view.getUint32(28, true) != rate * 2 ||
        view.getUint16(32, true) != 2 || view.getUint16(34, true) != 16 ||
        view.getUint32(40, true) != bytes.length - 44 || (bytes.length - 44) % 2 ||
        (bytes.length - 44) / (rate * 2) > 12.1) throw new Error('Ожидается короткое голосовое PCM WAV')
}

// Provider IO is injected; the common2 run host owns progress, cancellation and approval.
export function createAssistant(deps: {
    allowed: (account: string, room: string) => boolean,
    read: (account: string, room: string, file: string) => Promise<Uint8Array>,
    messages: (account: string, room: string) => string[],
    save: (account: string, room: string, id: string, result: Proposal) => Promise<unknown>,
    provider?: AssistantProvider,
    directory?: string,
}) {
    const controllers = new Map<string, {controller: AbortController, account: string, room: string}>()
    const runner: AiRunRunner = {async run(ctx) {
        const input = ctx.input as {room: string, text?: string, file?: string}
        const controller = new AbortController()
        controllers.set(ctx.run.id, {controller, account: ctx.run.owner, room: input.room})
        try {
            if (!deps.allowed(ctx.run.owner, input.room)) throw new Error('Нет доступа к разговору')
            ctx.report({progress: 0.1, message: 'Подготовка разрешённого материала'})
            let text = input.text ?? ''
            let usage: AiRunUsage | undefined
            if (ctx.run.kind == 'transcribe') {
                if (!deps.provider) throw new Error('Провайдер распознавания не настроен. Платные запросы отключены')
                const bytes = await deps.read(ctx.run.owner, input.room, input.file ?? '')
                validateVoice(bytes)
                controller.signal.throwIfAborted()
                if (!deps.allowed(ctx.run.owner, input.room)) throw new Error('Доступ отозван')
                const result = await deps.provider.transcribe({bytes, signal: controller.signal})
                text = result.text
                usage = result.usage
            } else if (ctx.run.kind == 'demo-summary') text = deps.messages(ctx.run.owner, input.room).slice(-8).join('\n')
            if (ctx.cancelled() || controller.signal.aborted || !deps.allowed(ctx.run.owner, input.room)) throw new Error('Обработка отменена или доступ отозван')
            if (typeof text != 'string' || !text.trim() || text.length > 8000) throw new Error('Нет подходящего текста; требуется ручная проверка')
            const result: Proposal = {transcript: text, demo: ctx.run.kind != 'transcribe',
                items: ctx.run.kind == 'demo-summary' ? [] : text.split(/[\n.!?;]+/).map(title => title.trim()).filter(Boolean).slice(0, 10).map(title => ({title: title.slice(0, 160), due: '', assignee: ctx.run.owner}))}
            ctx.report({progress: 0.8, message: 'Проверьте текст, сроки и исполнителей; задачи ещё не созданы', usage})
            if (ctx.cancelled()) return
            await deps.save(ctx.run.owner, input.room, ctx.run.requestId, result)
            return {result, usage}
        } finally {controllers.delete(ctx.run.id)}
    }, cancel({run}) {controllers.get(run.id)?.controller.abort()}}
    const host = createAiRunHost({...openAiCheckpoint({directory: deps.directory}), runner, history: 10, capabilities: [
        {kind: 'transcribe', label: deps.provider ? 'Распознать голос' : 'Распознавание: провайдер не настроен', acceptsResources: true},
        {kind: 'demo-tasks', label: 'Тестовый исполнитель: черновик задач из текста'},
        {kind: 'demo-summary', label: 'Тестовый исполнитель: выдержка из обсуждения'},
    ], policy: {
        canCreate(account, request) {
            const input = request.input as {room?: unknown, text?: unknown} | null
            if (!input || typeof input.room != 'string' || !deps.allowed(account, input.room)) return false
            if (input.text != undefined && (typeof input.text != 'string' || input.text.length > 8000)) return false
            return ['transcribe', 'demo-tasks', 'demo-summary'].includes(request.kind) && request.resourceIds?.[0] == input.room &&
                (Object.values(host.store.state.runs).some(run => run.owner == account && run.requestId == request.requestId) ||
                Object.keys(host.store.state.runs).length < 100 && !Object.values(host.store.state.runs).some(run => ['queued', 'running', 'waiting_input', 'waiting_approval'].includes(run.state)))
        },
        canRead: (account, run) => run.owner == account && deps.allowed(account, run.resourceIds[0]),
        canWrite: (account, run) => run.owner == account && deps.allowed(account, run.resourceIds[0]),
    }})
    function reconcile() {
        for (const pending of controllers.values()) if (!deps.allowed(pending.account, pending.room)) pending.controller.abort()
    }
    function close() {
        for (const pending of controllers.values()) pending.controller.abort()
        host.close()
    }
    // Server-only recovery contains private inputs and must never be spread onto the RPC facade.
    return {connection: host.connection, reconcile, close, recovery: host.recovery}
}

// Optional server-side HTTP provider contract; no endpoint means no network call.
export function httpAssistantProvider(deps: {url: string, token?: string}): AssistantProvider {
    const url = new URL(deps.url)
    if (url.protocol != 'https:' && !(url.protocol == 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) throw new Error('ИИ-провайдер требует HTTPS или localhost')
    return {async transcribe({bytes, signal}) {
        const response = await fetch(url, {method: 'POST', headers: {'content-type': 'audio/wav', ...(deps.token ? {authorization: 'Bearer ' + deps.token} : {})}, body: new Uint8Array(bytes), signal: AbortSignal.any([signal, AbortSignal.timeout(60_000)])})
        if (!response.ok) throw new Error('Провайдер не подтвердил обработку; автоматический повтор отключён')
        const reader = response.body?.getReader()
        if (!reader) throw new Error('Провайдер вернул пустой ответ')
        let size = 0
        const chunks: Uint8Array[] = []
        try {
            while (true) {
                const next = await reader.read()
                if (next.done) break
                size += next.value.length
                if (size > 65536) throw new Error('Ответ провайдера слишком велик')
                chunks.push(next.value)
            }
        } finally {await reader.cancel()}
        const body = new Uint8Array(size)
        let offset = 0
        for (const chunk of chunks) {body.set(chunk, offset); offset += chunk.length}
        const data = JSON.parse(new TextDecoder().decode(body)) as {text?: unknown}
        if (typeof data.text != 'string' || data.text.length > 8000) throw new Error('Провайдер вернул некорректный текст')
        return {text: data.text}
    }}
}
