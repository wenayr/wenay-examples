import assert from 'node:assert/strict'
import {createAiRunClient, createAiRunHost} from 'wenay-common2/ai'

// Public API reproduction: application membership changes without an AI store mutation.
// Default confirms the published limitation; --expect-fixed checks the desired invariant.
async function main() {
    let allowed = true
    const secret = 'private-tenant-result-policy-repro'
    const host = createAiRunHost({
        runner: {run() {return {result: secret}}},
        policy: {
            canCreate: () => allowed,
            canRead: () => allowed,
            canWrite: () => allowed,
        },
    })
    const connection = host.connection('agent')
    const client = createAiRunClient({remote: connection.fragment})
    let sameFragment: ReturnType<typeof createAiRunClient> | undefined
    let freshConnection: ReturnType<typeof host.connection> | undefined
    let freshClient: ReturnType<typeof createAiRunClient> | undefined
    try {
        await client.ready
        const run = await client.createRun({requestId: 'one-draft', kind: 'fixture', input: null, resourceIds: ['tenant-a/ticket-1']})
        const deadline = Date.now() + 2000
        while (client.store.state.runs[run.id]?.state != 'completed') {
            assert(Date.now() < deadline, 'Completion did not reach the client')
            await new Promise(resolve => setTimeout(resolve, 5))
        }
        assert.equal(client.store.state.runs[run.id]?.result, secret)

        allowed = false
        // A new mirror must read a fresh server keyframe through the original resource.
        // This distinguishes server disclosure after revocation from old client memory.
        sameFragment = createAiRunClient({remote: connection.fragment})
        await sameFragment.ready
        const keyframe = await connection.fragment.state.keyframe()
        freshConnection = host.connection('agent')
        freshClient = createAiRunClient({remote: freshConnection.fragment})
        await freshClient.ready
        assert.equal(freshClient.store.state.runs[run.id], undefined, 'New server connection must apply current policy')
        await assert.rejects(() => client.cancelRun(run.id), /forbidden|missing/)

        const observation = {
            originalClientRetainsResult: client.store.state.runs[run.id]?.result == secret,
            newClientFromOldFragmentReceivesResult: sameFragment.store.state.runs[run.id]?.result == secret,
            oldFragmentKeyframeContainsResult: JSON.stringify(keyframe).includes(secret),
            newConnectionReceivesResult: freshClient.store.state.runs[run.id]?.result == secret,
        }
        console.log(JSON.stringify(observation))
        if (process.argv.includes('--expect-fixed')) {
            assert.equal(observation.newClientFromOldFragmentReceivesResult, false, 'Revoked policy must prevent a new read through an existing fragment')
            assert.equal(observation.oldFragmentKeyframeContainsResult, false, 'Revoked result remains in the server keyframe')
            assert.equal(observation.originalClientRetainsResult, false, 'Existing client projection was not invalidated')
        } else {
            assert.equal(observation.newClientFromOldFragmentReceivesResult, true)
            assert.equal(observation.oldFragmentKeyframeContainsResult, true)
            console.log('Confirmed common2 3.1.1 external-policy projection invalidation gap; no paid calls or network used')
        }
    } finally {
        freshClient?.close()
        freshConnection?.close()
        sameFragment?.close()
        client.close()
        connection.close()
        host.close()
    }
}

void main().catch(function failed(error) {
    console.error(error)
    process.exitCode = 1
})
