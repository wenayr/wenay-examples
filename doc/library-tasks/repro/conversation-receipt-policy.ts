import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import path from 'node:path'

// Resolve only the installed public export from the caller's apps/chat directory.
const requireApp = createRequire(path.join(process.cwd(), 'package.json'))
const {createConversationHost} = requireApp('wenay-common2/conversation')

async function main() {
    let allowed = true
    const marker = 'private-conversation-receipt-policy-result'
    const host = createConversationHost({policy: {
        canCreate: () => allowed,
        canRead: () => allowed,
        canWrite: () => allowed
    }})
    const connection = host.connection('alice')
    const fragment = connection.fragment
    try {
        const create = {requestId: 'create-known', title: marker}
        const created = await fragment.createConversation(create)
        const channelInput = {requestId: 'channel-known', conversationId: created.conversation.id, title: marker}
        const channel = await fragment.createChannel(channelInput)
        const input = {
            requestId: 'post-known', conversationId: created.conversation.id, channelId: channel.id,
            blocks: [{kind: 'text', version: 1, text: marker}]
        }
        const posted = await fragment.postMessage(input)
        allowed = false
        await assert.rejects(fragment.postMessage({...input, requestId: 'post-new'}))
        await assert.rejects(fragment.createChannel({...channelInput, requestId: 'channel-new'}))
        await assert.rejects(fragment.createConversation({...create, requestId: 'create-new'}))
        const repeated = await fragment.postMessage(input).catch(() => null)
        const repeatedChannel = await fragment.createChannel(channelInput).catch(() => null)
        const repeatedCreate = await fragment.createConversation(create).catch(() => null)
        const keyframe = await fragment.state.keyframe()
        const fresh = host.connection('alice')
        let freshFrame
        try {freshFrame = await fresh.fragment.state.keyframe()} finally {fresh.close()}
        const result = {
            repeatedPostReturnsPrivateResult: repeated?.id == posted.id && JSON.stringify(repeated).includes(marker),
            repeatedChannelReturnsPrivateResult: repeatedChannel?.id == channel.id && repeatedChannel.title == marker,
            repeatedCreateReturnsPrivateResult: repeatedCreate?.conversation.title == marker,
            freshRequestIdsDenied: true,
            retainedKeyframeContainsPrivateResult: JSON.stringify(keyframe).includes(marker),
            freshConnectionKeyframeContainsPrivateResult: JSON.stringify(freshFrame).includes(marker)
        }
        console.log(JSON.stringify(result, null, 4))
        if (process.argv.includes('--expect-fixed')) {
            assert.equal(result.repeatedPostReturnsPrivateResult, false, 'Revoked policy must prevent receipt result disclosure')
        } else {
            assert.equal(result.repeatedPostReturnsPrivateResult, true)
            assert.equal(result.repeatedChannelReturnsPrivateResult, true)
            assert.equal(result.repeatedCreateReturnsPrivateResult, true)
            assert.equal(result.freshConnectionKeyframeContainsPrivateResult, false)
        }
    } finally {
        connection.close()
        host.close()
    }
}

main().catch(function failed(error) {
    console.error(error)
    process.exitCode = 1
})
