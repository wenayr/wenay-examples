import assert from 'node:assert/strict'
import {mkdtempSync, realpathSync, rmSync, readdirSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {createServiceLeader} from 'wenay-common2/service/server'
import {createContentRuntime} from './runtime'
import {contentRoles, hash} from './domain'

async function main() {
    const temporary = realpathSync(tmpdir()), directory = mkdtempSync(path.join(temporary, 'content-files-'))
    const runtime = createContentRuntime({directory}), leader = createServiceLeader({definition: runtime.definition, selfUrl: () => 'http://localhost'})
    const close = runtime.mount({store: leader.line.control.store, system: leader.corridor.system}), controller = new AbortController()
    const state = () => leader.line.control.store.snapshot()
    const context = (account: string) => ({
        principal: {account, roles: contentRoles(state(), account)},
        sessionId: account,
        resourceId: 'files',
        signal: controller.signal
    })
    const author = runtime.definition.resources.files.open(context('author')), outsider = runtime.definition.resources.files.open(context('outsider'))
    const owner = leader.corridor.fragment('owner')
    const writer = leader.corridor.fragment('author')
    const editor = leader.corridor.fragment('editor')
    const publisher = leader.corridor.fragment('publisher')
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l5sAAAAASUVORK5CYII=', 'base64')
    let seq = 0
    const rpc = () => 'files-' + (++seq), orgId = 'northstar'
    function input() {return {orgId, id: 'welcome', revision: state().pages.welcome.revision}}
    try {
        await assert.rejects(author.facade.control.upload({orgId, name: 'fake.png', bytes: Buffer.from('<svg><script>bad</script></svg>')}), /PNG/)
        await assert.rejects(author.facade.control.upload({orgId, name: 'huge.png', bytes: Buffer.alloc(512 * 1024 + 1)}), /512/)
        const asset = await author.facade.control.upload({orgId, name: 'photo.png', bytes: png})
        const duplicate = await author.facade.control.upload({orgId, name: 'same.png', bytes: png})
        assert.equal(duplicate.id, asset.id)
        assert.equal(Object.keys(state().assets).length, 1)
        assert.deepEqual(Buffer.from((await author.facade.control.download({orgId, id: asset.id})).bytes), png)
        await assert.rejects(runtime.publicImage(orgId, asset.id), /не опубликовано/)
        await assert.rejects(outsider.facade.control.download({orgId, id: asset.id}), /доступа/)
        const foreign = await outsider.facade.control.upload({orgId: 'harbor', name: 'same.png', bytes: png})
        assert.notEqual(asset.id, foreign.id, 'same bytes in another tenant have independent lifetime')
        await outsider.facade.control.remove({orgId: 'harbor', id: foreign.id})
        assert.deepEqual(Buffer.from((await author.facade.control.download({orgId, id: asset.id})).bytes), png)
        await writer.assetDescribe(rpc(), {orgId, id: asset.id, revision: asset.revision, alt: 'Белый пиксель'})
        const draft = state().pages.welcome.draft
        const photo = {id: 'photo', kind: 'image' as const, text: 'Белый пиксель', assetId: asset.id, href: ''}
        await writer.pageSave(rpc(), {...input(), ...draft, blocks: [...draft.blocks, photo]})
        await assert.rejects(author.facade.control.remove({orgId, id: asset.id}), /используется/)
        const review = await writer.reviewSubmit(rpc(), input())
        await editor.reviewDecide(rpc(), {...input(), version: review.version, decision: 'approved', body: ''})
        await publisher.pagePublish(rpc(), {...input(), version: review.version, key: 'image-publish'})
        assert.deepEqual(Buffer.from((await runtime.publicImage(orgId, asset.id)).bytes), png)
        await publisher.pageWithdraw(rpc(), {...input(), key: 'hide-image'})
        await assert.rejects(runtime.publicImage(orgId, asset.id), /не опубликовано/)
        await writer.pageSave(rpc(), {...input(), ...draft})
        await assert.rejects(author.facade.control.remove({orgId, id: asset.id}), /используется/, 'snapshot retains image after draft drops it')
        const unusedBytes = Buffer.concat([png, Buffer.from('second-fixture')])
        const unused = await author.facade.control.upload({orgId, name: 'unused.png', bytes: unusedBytes})
        await author.facade.control.remove({orgId, id: unused.id})
        await author.facade.control.remove({orgId, id: unused.id})
        assert(!readdirSync(path.join(directory, 'images', hash(orgId))).includes(unused.id))
        const revived = await author.facade.control.upload({orgId, name: 'again.png', bytes: unusedBytes})
        assert.equal(revived.id, unused.id)
        assert(!revived.removedAt)
        await owner.memberRole(rpc(), {orgId, account: 'author', role: 'revoked'})
        await assert.rejects(author.facade.control.download({orgId, id: asset.id}), /доступа/)
        await assert.rejects(author.facade.control.upload({orgId, name: 'new.png', bytes: png}), /доступа/)
        console.log('PASS content images: signature/byte limits, SHA256, same-file dedupe, separate tenant lifetime, fresh ACL, draft/snapshot references, public visibility, tombstone removal/retry/reupload and open-resource revocation')
    } finally {
        controller.abort()
        author.close()
        outsider.close()
        await close()
        leader.control.close()
        assert(path.dirname(path.resolve(directory)) == temporary && path.basename(directory).startsWith('content-files-'))
        rmSync(directory, {recursive: true, force: true})
    }
}
main().catch(function failed(error) {
    console.error(error)
    process.exitCode = 1
})
