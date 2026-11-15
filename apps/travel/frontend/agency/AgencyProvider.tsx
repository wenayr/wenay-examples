import {createContext, useContext, useEffect, useMemo, type ReactNode} from 'react'
import {createStore} from 'wenay-common2/observe'
import {useStoreNode} from 'wenay-react2/react'
import type {AgencyLead, AgencyLeadInput, AgencyProfile, AgencySession, AgencySettings, AgencyStorefront, tAgencyLeadStatus} from '../../src/agency-contract.ts'
import {setDirectoryAgencyScope} from '../directory-query.ts'

const initialSession: AgencySession = {authenticated: false, storageAvailable: false, agency: null, leads: []}

export function agencyStorefrontSlug() {
    const match = window.location.pathname.match(/^\/a\/([a-z0-9][a-z0-9-]{1,38}[a-z0-9])\/?$/)
    return match?.[1] ?? null
}

export function createAgencyClient(deps: {fetch: typeof fetch, slug?: string | null}) {
    const slug = deps.slug ?? null
    const store = createStore({
        session: initialSession, storefront: null as AgencyStorefront | null, loading: true, saving: false, error: '', conflict: false,
    })
    setDirectoryAgencyScope({slug: slug ?? undefined})
    let generation = 0

    async function request<T>(path: string, method = 'GET', body?: unknown, base = '/api/travel/agency'): Promise<T> {
        const response = await deps.fetch(base + path, {
            method, credentials: 'same-origin', headers: {'content-type': 'application/json'},
            body: body == undefined ? undefined : JSON.stringify(body),
        })
        const data = await response.json()
        if (!response.ok) {
            store.node.conflict.set(response.status == 409)
            throw new Error(data.error ?? 'Не удалось сохранить изменения. Попробуйте ещё раз.')
        }
        return data as T
    }

    function publish(session: AgencySession) {
        setDirectoryAgencyScope({revision: session.agency?.revision})
        store.node.session.replace(session)
    }

    async function load() {
        const current = ++generation
        store.node.loading.set(true)
        try {
            if (slug) {
                const result = await request<{agency: AgencyStorefront}>('', 'GET', undefined, '/api/travel/storefront/' + slug)
                if (current != generation) return
                setDirectoryAgencyScope({slug, revision: result.agency.revision})
                store.node.storefront.replace(result.agency)
                store.node.error.set('')
                return
            }
            const session = await request<AgencySession>('')
            if (current != generation) return
            publish(session)
            store.node.error.set('')
            store.node.conflict.set(false)
        } catch (error) {
            if (current == generation) store.node.error.set(error instanceof Error ? error.message : 'Не удалось загрузить кабинет.')
        } finally {
            if (current == generation) store.node.loading.set(false)
        }
    }

    async function change<T>(action: () => Promise<T>) {
        if (store.node.saving.get()) return null
        store.node.saving.set(true)
        store.node.error.set('')
        store.node.conflict.set(false)
        generation += 1
        try {
            return await action()
        } catch (error) {
            store.node.error.set(error instanceof Error ? error.message : 'Не удалось сохранить изменения.')
            return null
        } finally {
            store.node.saving.set(false)
            store.node.loading.set(false)
        }
    }

    function create(settings: AgencySettings) {
        return change(async function createProfile() {
            const session = await request<AgencySession>('', 'POST', settings)
            publish(session)
            return session.agency
        })
    }

    function save(profile: AgencySettings & Pick<AgencyProfile, 'revision'>) {
        return change(async function saveProfile() {
            const session = await request<AgencySession>('', 'PUT', profile)
            publish(session)
            return session.agency
        })
    }

    function addLead(input: AgencyLeadInput) {
        return change(async function createLead() {
            const result = await request<{lead: AgencyLead}>('/leads', 'POST', input)
            const session = store.node.session.get()
            store.node.session.replace({...session, leads: [result.lead, ...session.leads]})
            return result.lead
        })
    }

    function updateLead(lead: AgencyLead, status: tAgencyLeadStatus) {
        return change(async function saveLead() {
            const result = await request<{lead: AgencyLead}>('/leads/' + encodeURIComponent(lead.id), 'PATCH', {status, revision: lead.revision})
            const session = store.node.session.get()
            store.node.session.replace({...session, leads: session.leads.map(item => item.id == lead.id ? result.lead : item)})
            return result.lead
        })
    }

    function addStorefrontLead(input: AgencyLeadInput) {
        return change(async function createStorefrontLead() {
            if (!slug) throw new Error('Откройте витрину агентства, чтобы отправить запрос.')
            return request<{accepted: true, reference: string}>('/leads', 'POST', input, '/api/travel/storefront/' + slug)
        })
    }

    return {node: store.node, slug, control: {load, create, save, addLead, updateLead, addStorefrontLead}}
}

type AgencyClient = ReturnType<typeof createAgencyClient>
const AgencyContext = createContext<AgencyClient | null>(null)

export function AgencyProvider({children}: {children: ReactNode}) {
    const client = useMemo(() => createAgencyClient({fetch: window.fetch.bind(window), slug: agencyStorefrontSlug()}), [])
    useEffect(() => { void client.control.load() }, [client])
    return <AgencyContext.Provider value={client}>{children}</AgencyContext.Provider>
}

export function useAgency() {
    const client = useContext(AgencyContext)
    if (!client) throw new Error('Кабинет агентства требует AgencyProvider.')
    const view = useStoreNode(client.node, {mode: 'snapshot'}).value
    return {...view, agency: view.storefront ?? view.session.agency, slug: client.slug, leads: view.session.leads, control: client.control}
}
