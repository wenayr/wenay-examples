import path from 'node:path'
import {createReconciler} from 'wenay-common2'
import type {Store} from 'wenay-common2/observe'
import type {ServiceResourceContext} from 'wenay-common2/service'
import type {createServiceLeader} from 'wenay-common2/service/server'
import {createContentService, contentDefinition} from './service'
import {own, publicPage} from './domain'
import type {ContentState} from './model'
import {createContentFiles} from './files-resource'
import {createContentAssistant, type EditProvider} from './assistant-resource'
import type {PublishedFacade} from './published-contract'

export function createContentRuntime(deps: {directory?: string, now?: () => number, provider?: EditProvider, timeoutMs?: number} = {}) {
    const service = createContentService(deps), now = deps.now ?? Date.now
    const files = createContentFiles({directory: deps.directory ? path.join(deps.directory, 'images') : undefined})
    const assistant = createContentAssistant({...deps, directory: deps.directory ? path.join(deps.directory, 'assistant') : undefined})
    let store: Store<ContentState> | null = null
    function publicRead(input: {orgId: string, slug: string}) {
        if (!store) throw new Error('Публикации временно недоступны')
        if (!own(store.state.organizations, input.orgId)) throw new Error('Публикация недоступна')
        const pages = Object.values(store.state.pages).filter(page => page.orgId == input.orgId)
        const published = pages.map(page => publicPage(store!.state, page))
        const result = published.find(page => page?.slug == input.slug)
        if (!result) throw new Error('Публикация недоступна')
        return result
    }
    function publicList(orgId: string) {
        if (!store || !own(store.state.organizations, orgId)) throw new Error('Публикации недоступны')
        return Object.values(store.state.pages).filter(page => page.orgId == orgId).flatMap(page => {
            const value = publicPage(store!.state, page)
            if (!value) return []
            return [{
                id: value.id,
                orgId,
                slug: value.slug,
                title: value.title,
                version: value.version,
                publicationRevision: value.publicationRevision
            }]
        })
    }
    const published = {allow: ['account'], placement: 'authority' as const, open(ctx: ServiceResourceContext) {
        const control = {
            read(input: {orgId: string, slug: string}) {
                ctx.signal.throwIfAborted()
                return publicRead(input)
            },
            list(orgId: string) {
                ctx.signal.throwIfAborted()
                return publicList(orgId)
            }
        }
        const facade = {control} satisfies PublishedFacade
        return {facade, close() {}}
    }}
    const resources = {published, files: files.resource, assistant: assistant.resource}
    return {
        definition: {...service.definition, resources},
        publicRead,
        publicList,
        publicImage: files.publicRead,
        mount(deps: {store: Store<ContentState>, system: ReturnType<typeof createServiceLeader<typeof contentDefinition>>['corridor']['system']}) {
            store = deps.store
            const closeFiles = files.mount(deps)
            const closeAssistant = assistant.mount(deps.store)
            function duePublications() {
                return Object.values(deps.store.state.pages).flatMap(function planned(page) {
                    const waiting = page.schedules.filter(entry => entry.status == 'pending')
                    return waiting.map(entry => ({id: entry.id, dueAt: entry.dueAt}))
                })
            }
            const worker = createReconciler({
                read: duePublications,
                subscribe: deps.store.listen().on,
                async run(entries, ctx) {
                    if (entries.some(entry => entry.dueAt <= now())) {
                        ctx.signal.throwIfAborted()
                        await deps.system.publicationSweep('publication-sweep-' + crypto.randomUUID(), {})
                    }
                    for (const entry of entries) if (entry.dueAt > now()) ctx.retry(entry.id, Math.max(1, entry.dueAt - now()))
                }})
            worker.control.request()
            return async function close() {
                closeFiles()
                closeAssistant()
                await worker.close()
                store = null
            }
        }}
}
export type ContentDefinition = ReturnType<typeof createContentRuntime>['definition']
