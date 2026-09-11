import {createStore, exposeStoreReplay} from 'wenay-common2/observe'
import {createMediaRelay} from 'wenay-common2/peer'
import {decodeMediaFrame} from 'wenay-common2/media'
import type {ServiceResourceContext} from 'wenay-common2/service'

export type ScreenState = {owner: string, account: string, epoch: number}

// A small broadcast room. SC1 owns authorization and connection lifetime.
export function createScreenRoom(deps: {allow: readonly string[]}) {
    const state = createStore<ScreenState>({owner: '', account: '', epoch: 0})
    const replay = exposeStoreReplay(state, {history: 1})
    const relay = createMediaRelay({lines: {screen: 'video'}, videoHistory: 1})
    const publish = relay.publishOf('room')
    const members = new Set<string>()
    let lastFrame = 0
    let lastActivity = 0
    let timer: ReturnType<typeof setInterval> | undefined
    function stop() {state.state.owner = ''; state.state.account = ''; state.state.epoch++}
    const resource = {allow: deps.allow, placement: 'authority' as const,
        open(ctx: ServiceResourceContext) {
            if (members.size >= 2) throw new Error('В показе экрана уже участвуют двое')
            members.add(ctx.resourceId)
            let closed = false
            function active() {if (closed || ctx.signal.aborted) throw new Error('Показ экрана отключён')}
            function begin() {
                active()
                if (state.state.owner && state.state.owner != ctx.resourceId) throw new Error('Другой участник уже показывает экран')
                state.state.epoch++
                state.state.owner = ctx.resourceId
                state.state.account = ctx.principal.account
                lastActivity = Date.now()
                lastFrame = 0
                return state.state.epoch
            }
            function end() {active(); if (state.state.owner == ctx.resourceId) stop()}
            function frame(epoch: number, bytes: Uint8Array) {
                active()
                if (state.state.owner != ctx.resourceId || epoch != state.state.epoch) throw new Error('Показ уже завершён')
                if (!(bytes instanceof Uint8Array) || bytes.byteLength > 180_000) throw new Error('Кадр слишком большой')
                const decoded = decodeMediaFrame(bytes)
                if (decoded.kind != 'video-frame' || decoded.codec != 'jpeg' || !decoded.width || !decoded.height || decoded.width > 1280 || decoded.height > 720) throw new Error('Неподдерживаемый кадр')
                const now = Date.now()
                lastActivity = now
                if (now - lastFrame < 180) return false
                lastFrame = now
                publish('screen', {epoch, bytes}, now)
                return true
            }
            return {facade: {control: {begin, end, frame}, view: replay.api.replay, frames: relay.lines('room').screen},
                close() {closed = true; members.delete(ctx.resourceId); if (state.state.owner == ctx.resourceId) stop()}}
        },
    }
    function mount() {
        timer = setInterval(function expire() {if (state.state.owner && Date.now() - lastActivity > 12_000) stop()}, 1000)
        timer.unref()
        return function close() {clearInterval(timer); relay.close(); replay.close(); members.clear()}
    }
    return {resource, mount}
}
export type ScreenFacade = ReturnType<ReturnType<typeof createScreenRoom>['resource']['open']>['facade']
