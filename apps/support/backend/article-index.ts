import {createReconciler} from 'wenay-common2'
import type {Store} from 'wenay-common2/observe'
import {authorizeOrganization} from './domain'
import type {SupportState, Article} from './model'

// A rebuildable version index. Source records remain the authority for access and text.
export function createArticleIndex(deps: {authorizeSearch?: (state: SupportState, account: string, orgId: string) => unknown} = {}) {
    let store: Store<SupportState> | null = null
    const index = new Map<string, {orgId: string, revision: number, text: string}>()
    function entry(article: Article) {
        let value = index.get(article.id)
        if (!value || value.orgId != article.orgId || value.revision != article.revision) {
            value = {orgId: article.orgId, revision: article.revision, text: (article.title + '\n' + article.body).toLocaleLowerCase()}
            index.set(article.id, value)
        }
        return value
    }
    function search(account: string, orgId: string, query: string, limit = 3) {
        if (!store) throw new Error('Поиск закрыт')
        const authorize = deps.authorizeSearch ?? authorizeOrganization
        authorize(store.state, account, orgId)
        const text = typeof query == 'string' && query.length <= 8000
        const size = Number.isInteger(limit) && limit >= 1 && limit <= 50
        if (!text || !size) throw new Error('Некорректный запрос поиска')
        const words = [...new Set(query.toLocaleLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? [])]
        // A stale or withdrawn index entry can never authorize a result. A just-published
        // version is indexed on demand while the reconciler catches up with the rest.
        return Object.values(store.state.articles).filter(article => article.orgId == orgId && article.status == 'published')
            .map(article => ({article, score: words.filter(word => entry(article).text.includes(word)).length}))
            .filter(item => item.score > 0).sort((a, b) => b.score - a.score || a.article.id.localeCompare(b.article.id)).slice(0, limit)
            .map(({article}) => ({id: article.id, title: article.title, body: article.body, revision: article.revision}))
    }
    return {search, mount(value: Store<SupportState>) {
        store = value
        const worker = createReconciler({read: () => Object.values(value.state.articles), subscribe: value.listen().on,
            run(articles) {
                const live = new Set<string>()
                for (const article of articles) if (article.status == 'published') {
                    entry(article)
                    live.add(article.id)
                }
                for (const id of index.keys()) if (!live.has(id)) index.delete(id)
            }})
        worker.control.request()
        return function close() {
            store = null
            index.clear()
            void worker.close()
        }
    }}
}
