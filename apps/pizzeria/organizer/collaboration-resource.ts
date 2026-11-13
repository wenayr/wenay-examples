import {createStore, exposeStoreReplay, type Store} from 'wenay-common2/observe'
import type {ServiceResourceContext, tServicePrincipal} from 'wenay-common2/service'
import type {WorkView} from './model'
import {BOARD_INTERVAL, BOARD_TTL, type BoardActivity, type BoardPresence} from './collaboration-model'
import {cleanActivity, projectActivity} from './activity'

// One room per authority host. Only the existing work projection decides task visibility.
export function createBoardRoom(deps: {allow: readonly string[]}) {
    let project: ((principal: tServicePrincipal) => WorkView) | null = null
    let stop = () => {}
    let timer: ReturnType<typeof setInterval> | undefined
    type Member = {ctx: ServiceResourceContext, activity: BoardActivity, at: number, store: Store<BoardPresence>}
    const members = new Map<string, Member>()

    function refresh() {
        if (!project) return
        const now = Date.now()
        const views = new Map([...members].map(([id, member]) => [id, project!(member.ctx.principal)]))
        for (const [id, member] of members) {
            const viewer = views.get(id)!
            const participants = [...members].flatMap(([otherId, other]) => {
                if (now - other.at >= BOARD_TTL || other.ctx.signal.aborted) return []
                const person = viewer.people.find(person => person.account == other.ctx.principal.account)
                if (!person) return []
                const source = views.get(otherId)!
                return [{id: otherId, account: person.account, name: person.name,
                    ...projectActivity({activity: other.activity, source, viewer})}]
            })
                if (JSON.stringify(member.store.state.participants) != JSON.stringify(participants)) member.store.state.participants = participants
        }
    }

    const resource = {
        allow: deps.allow, placement: 'authority' as const,
        open(ctx: ServiceResourceContext) {
            if (!project) throw new Error('Board room is not mounted')
            const store = createStore<BoardPresence>({self: ctx.resourceId, participants: []})
            const replay = exposeStoreReplay(store, {history: 1, keepMs: BOARD_TTL})
            const member: Member = {ctx, activity: {cursor: null, selected: ''}, at: Date.now(), store}
            members.set(ctx.resourceId, member)
            let last = 0
            let closed = false
            refresh()
            function update(activity: BoardActivity) {
                if (closed || ctx.signal.aborted) return false
                const now = Date.now()
                if (now - last < BOARD_INTERVAL) return false
                // Rebuild only the admitted fields; identity and clocks always come from the server.
                const source = project!(ctx.principal)
                member.activity = projectActivity({activity: cleanActivity(activity), source, viewer: source})
                member.at = last = now
                refresh()
                return true
            }
            function close() {
                if (closed) return
                closed = true
                members.delete(ctx.resourceId)
                replay.close()
                refresh()
            }
            return {facade: {control: {update}, view: replay.api.replay}, close}
        },
    }

    function mount<S extends object>(deps: {store: Store<S>, project: (state: S, principal: tServicePrincipal) => WorkView}) {
        if (project) throw new Error('Board room already mounted')
        project = principal => deps.project(deps.store.state, principal)
        stop = deps.store.on(refresh)
        timer = setInterval(refresh, 1000)
        timer.unref()
        return close
    }
    function close() {
        stop()
        clearInterval(timer)
        project = null
        members.clear()
    }
    return {resource, mount, close}
}

export type BoardFacade = ReturnType<ReturnType<typeof createBoardRoom>['resource']['open']>['facade']
