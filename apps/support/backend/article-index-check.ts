import assert from 'node:assert/strict'
import {createServiceLeader} from 'wenay-common2/service/server'
import {createSupportService} from './service'
import {createArticleIndex} from './article-index'

async function main() {
    const {definition} = createSupportService(), index = createArticleIndex()
    const leader = createServiceLeader({definition, selfUrl: () => 'http://localhost'})
    const close = index.mount(leader.line.control.store), owner = leader.corridor.fragment('owner')
    try {
        const article = await owner.articleSave('index-new', {
            orgId: 'northstar',
            id: '',
            revision: 0,
            title: 'Гарантия',
            body: 'Настройка гарантийного обслуживания'
        })
        assert.equal(index.search('customer', 'northstar', 'гарантийного').length, 0)
        const published = await owner.articlePublish('index-publish', {orgId: 'northstar', ...article, status: 'published'})
        assert.equal(index.search('customer', 'northstar', 'гарантийного')[0].revision, published.revision)
        const next = await owner.articleSave('index-change', {orgId: 'northstar', ...published, title: 'Гарантия', body: 'Новая формулировка: возврат товара'})
        assert.equal(index.search('customer', 'northstar', 'гарантийного').length, 0, 'stale indexed version excluded immediately')
        await owner.articlePublish('index-republish', {orgId: 'northstar', ...next, status: 'published'})
        assert.equal(index.search('customer', 'northstar', 'возврат')[0].id, article.id)
        assert.throws(() => index.search('outsider', 'northstar', 'возврат'), /доступа/)
        assert.equal(index.search('outsider', 'harbor', 'возврат').length, 0)
        await owner.memberRole('index-revoke', {orgId: 'northstar', account: 'customer', role: 'revoked'})
        assert.throws(() => index.search('customer', 'northstar', 'возврат'), /доступа/)
        const restored = createArticleIndex(), closeRestored = restored.mount(leader.line.control.store)
        assert.equal(restored.search('owner', 'northstar', 'возврат')[0].id, article.id, 'rebuild from authoritative state')
        closeRestored()
        console.log('PASS article index: draft excluded, version-bound refresh, immediate withdrawal, tenant isolation, current ACL and rebuild without separate durable state')
    } finally {close()
    leader.control.close()}
}
main().catch(function failed(error) {
    console.error(error)
    process.exitCode = 1
})
