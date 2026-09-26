import assert from 'node:assert/strict'
import type {Store} from 'wenay-common2/observe'
import type {ServiceResourceContext} from 'wenay-common2/service'
import {hasProject, type HostingState} from './service'
import {createPublicOrigin} from './public-origin-resource'

type SetOrigin = Parameters<ReturnType<typeof createPublicOrigin>['mount']>[0]['setOrigin']

export async function checkPublicOriginGuards(store: Store<HostingState>, setOrigin: SetOrigin) {
    const original = {...store.state.accounts.owner, projects: [...store.state.accounts.owner.projects]}
    const input = {requestId: 'public-origin', environment: 'public-app', revision: 0, publicOrigin: 'https://app.example.test'}
    function context(signal = new AbortController().signal): ServiceResourceContext {
        return {principal: {account: 'owner', roles: ['owner']}, signal, sessionId: 'guard-check', resourceId: 'origin-check'}
    }
    const fixture = createPublicOrigin({hasProject})
    let after: (() => void) | undefined
    const closeMount = fixture.mount({store, async setOrigin(requestId, payload) {
        const receipt = await setOrigin(requestId, payload)
        after?.()
        return receipt
    }})
    try {
        const resource = fixture.resource.open(context())
        store.state.accounts.owner.projects = []
        await assert.rejects(resource.facade.control.set(input), /unavailable/, 'old receipt denied after project loss')
        store.state.accounts.owner = {...original, role: 'observer'}
        await assert.rejects(resource.facade.control.set(input), /unavailable/, 'old receipt denied after owner role loss')
        store.state.accounts.owner = {...original, projects: ['other']}
        await assert.rejects(resource.facade.control.set({...input, environment: 'other-public-app'}), /unavailable/,
            'changed input cannot expose the revoked original receipt environment')
        store.state.accounts.owner = {...original}
        after = () => {store.state.accounts.owner.projects = []}
        await assert.rejects(resource.facade.control.set(input), /unavailable/, 'post-await ACL is current')
        store.state.accounts.owner = {...original}
        after = () => {store.state.accounts.owner.role = 'observer'}
        await assert.rejects(resource.facade.control.set(input), /unavailable/, 'post-await role is current')
        store.state.accounts.owner = {...original}
        after = () => {resource.close()}
        await assert.rejects(resource.facade.control.set(input), /closed/, 'explicit close suppresses in-flight receipt')
        after = undefined
        await assert.rejects(resource.facade.control.set(input), /closed/, 'closed resource cannot be reused')
        const abort = new AbortController(), abortResource = fixture.resource.open(context(abort.signal))
        after = () => {abort.abort()}
        await assert.rejects(abortResource.facade.control.set(input), /abort/i, 'post-await abort suppresses receipt')
        await assert.rejects(abortResource.facade.control.set(input), /abort/i, 'pre-await abort suppresses receipt')
        const stale = fixture.resource.open(context())
        let closeReplacement = () => {}
        after = () => {closeReplacement = fixture.mount({store, setOrigin})}
        await assert.rejects(stale.facade.control.set(input), /closed/, 'remount invalidates old generation')
        closeMount()
        after = undefined
        const current = fixture.resource.open(context())
        assert.equal((await current.facade.control.set(input)).environment, input.environment, 'old mount disposer preserves newer mount')
        current.close()
        closeReplacement()
    } finally {
        store.state.accounts.owner = original
        closeMount()
    }
}
