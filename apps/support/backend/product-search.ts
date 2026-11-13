import {createHash} from 'node:crypto'
import {buildInputValidate, type InferInput} from 'wenay-common2/service'
import type {createArticleIndex} from './article-index'
import type {UsageGate} from './metered-execution'

export const SEARCH_INPUT = {orgId: 'string', query: 'string', limit: 'number', requestId: 'string'} as const
const validate = buildInputValidate(SEARCH_INPUT)

export function createPublishedSearch(deps: {search: ReturnType<typeof createArticleIndex>['search'], usage?: UsageGate}) {
    async function published(account: string, input: InferInput<typeof SEARCH_INPUT>, signal = AbortSignal.timeout(8000)) {
        validate(input)
        const asked = input.query.trim() && input.query.length <= 2000
        if (!/^[\w.-]{1,100}$/.test(input.requestId) || !asked) {
            throw new Error('Укажите запрос до 2000 символов и уникальный requestId')
        }
        function current() {
            signal.throwIfAborted()
            return deps.search(account, input.orgId, input.query, input.limit)
        }
        if (!deps.usage) return current()
        current()
        async function execute() {return current()}
        const eventId = 'public-search-' + createHash('sha256').update(JSON.stringify([account, input.requestId])).digest('hex')
        await deps.usage.run({orgId: input.orgId, eventId, metric: 'search', reference: input.requestId, units: 1, signal}, execute)
        // Settlement тоже выполняет IO: после него повторяем ACL и читаем текущую публикацию.
        return current()
    }
    return {published}
}
