import assert from 'node:assert/strict'
import {existsSync, mkdtempSync, realpathSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {createServiceLeader} from 'wenay-common2/service/server'
import {createDocumentRuntime} from './runtime'
import {createDocumentProcessor, parseCsv, parseText} from './processing-resource'
import {createDocumentDomain, documentRoles, documentWorkspace} from './domain'
import type {ParsedTable} from './model'
import type {UsageReceipt} from './metering-contract'

async function until(label: string, check: () => boolean) {
    const end = Date.now() + 12000
    while (!check()) {
        assert(Date.now() < end, 'Timeout: ' + label)
        await new Promise(resolve => setTimeout(resolve, 15))
    }
}

function pdfFixture(text: string, pages = 1, password = false) {
    const content = text ? 'BT /F1 12 Tf 20 100 Td (' + text + ') Tj ET' : ''
    const objects = [
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [' + Array.from({length: pages}, (_, index) => (index + 5) + ' 0 R').join(' ') + '] /Count ' + pages + ' >>',
        '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
        '<< /Length ' + Buffer.byteLength(content) + ' >>\nstream\n' + content + '\nendstream',
        ...Array.from({length: pages}, () => '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 3 0 R >> >> /Contents 4 0 R >>')
    ]
    if (password) objects.push('<< /Filter /Standard /V 1 /R 2 /Length 40 /O <' + '00'.repeat(32) + '> /U <' + '00'.repeat(32) + '> /P -4 >>')
    let value = '%PDF-1.4\n'
    const offsets = [0]
    for (const [index, object] of objects.entries()) {
        offsets.push(Buffer.byteLength(value))
        value += (index + 1) + ' 0 obj\n' + object + '\nendobj\n'
    }
    const xref = Buffer.byteLength(value)
    value += 'xref\n0 ' + (objects.length + 1) + '\n0000000000 65535 f \n'
    value += offsets.slice(1).map(offset => String(offset).padStart(10, '0') + ' 00000 n \n').join('')
    const identifier = '<00112233445566778899aabbccddeeff>'
    const encryption = password
        ? ' /Encrypt ' + objects.length + ' 0 R /ID [' + identifier + identifier + ']'
        : ''
    value += 'trailer\n<< /Size ' + (objects.length + 1) + ' /Root 1 0 R' + encryption
    value += ' >>\nstartxref\n' + xref + '\n%%EOF\n'
    return Buffer.from(value)
}

async function main() {
    const temporary = realpathSync(tmpdir())
    const directory = mkdtempSync(path.join(temporary, 'documents-domain-'))
    const real = createDocumentProcessor({directory, python: process.env.DOCUMENT_PYTHON})
    const delayed = new Map<string, (table: ParsedTable) => void>()
    let hold = true
    const runtime = createDocumentRuntime({directory, processor: {async extract(input) {
        if (hold && input.name.startsWith('slow')) return new Promise(resolve => delayed.set(input.name, resolve))
        return real.extract(input)
    }}})
    const leader = createServiceLeader({definition: runtime.definition, selfUrl: () => 'http://localhost'})
    const close = runtime.mount({store: leader.line.control.store, execute: leader.corridor.system})
    await runtime.view.ready()
    const signal = new AbortController()
    function session(account: string) {
        const roles = documentRoles(leader.line.control.store.state, account)
        return runtime.definition.resources.processor.open({
            principal: {account, roles},
            sessionId: account,
            resourceId: 'processor',
            signal: signal.signal
        })
    }
    const customer = session('customer'), reviewer = session('reviewer'), outsider = session('outsider')
    const customerCommands = leader.corridor.fragment('customer')
    const reviewerCommands = leader.corridor.fragment('reviewer')
    const ownerCommands = leader.corridor.fragment('owner')
    const state = () => leader.line.control.store.snapshot()
    const doc = (id: string) => state().documents[id]
    const orgId = 'northstar'
    const bytes = Buffer.from('name,amount,note\r\n"Анна, Мария",12,"строка 1\nстрока 2"\r\nИлья,7,"Он сказал ""да"""\r\n')
    function run(id: string, processor: 'node' | 'python', requestId: string) {
        const input = {orgId, documentId: id, revision: doc(id).revision, processor}
        return customer.facade.ai.createRun({kind: 'extract', requestId, resourceIds: [id], input})
    }
    try {
        assert.deepEqual(parseCsv('a,b\n"x,y","he said ""ok"""'), {headers: ['a', 'b'], rows: [['x,y', 'he said "ok"']]})
        assert.throws(() => parseCsv('a,b\n"unfinished'), /кавычки/)
        assert.throws(() => parseCsv('a,a\nx,y'), /уникальными/)
        assert.deepEqual(parseText('notes.txt', Buffer.from('Первое\nВторое')), {headers: ['Строка', 'Текст'], rows: [['1', 'Первое'], ['2', 'Второе']]})
        const forged = {
            orgId, id: 'a'.repeat(64), actor: 'customer',
            name: 'forged.csv', blobId: 'b'.repeat(64), size: 10
        }
        await assert.rejects(ownerCommands.documentImport('forged-internal', forged), /forbidden/)
        await assert.rejects(customer.facade.control.upload({orgId: 'harbor', name: 'other.csv', bytes}), /доступа/)
        await assert.rejects(customer.facade.control.upload({orgId, name: 'huge.csv', bytes: new Uint8Array(512 * 1024 + 1)}), /512/)
        await assert.rejects(customer.facade.control.upload({orgId, name: 'malware.exe', bytes}), /CSV/)
        const imported = await customer.facade.control.upload({orgId, name: 'contacts.csv', bytes})
        assert.deepEqual(await customer.facade.control.upload({orgId, name: 'contacts.csv', bytes}), imported)
        assert.equal(Object.keys(state().documents).length, 1)
        const started = run(imported.id, 'node', 'node-csv')
        await until('node extraction', () => doc(imported.id).status == 'review' || doc(imported.id).status == 'failed')
        assert.equal(doc(imported.id).status, 'review', doc(imported.id).error)
        assert.equal(doc(imported.id).table.rows[0][0], 'Анна, Мария')
        assert.equal(doc(imported.id).table.rows[0][2], 'строка 1\nстрока 2')
        const view = documentWorkspace(state(), {account: 'customer', roles: ['owner']})
        assert(!JSON.stringify(view).includes('Анна, Мария'), 'table payload is fetched privately, not replicated to every view')
        assert(!JSON.stringify(view).includes('blobId'))
        await assert.rejects(outsider.facade.control.detail({orgId, id: imported.id, revision: doc(imported.id).revision}), /доступа/)
        await assert.rejects(customerCommands.documentApprove('customer-approve', {orgId, id: imported.id, revision: doc(imported.id).revision}), /forbidden/)
        const firstRevision = doc(imported.id).revision
        const competing = await Promise.allSettled([
            reviewerCommands.documentRow('edit-a', {
                orgId, id: imported.id, revision: firstRevision, index: 0,
                values: ['Анна', '13', 'Проверено'], comment: 'Уточнили сумму'
            }),
            ownerCommands.documentRow('edit-b', {
                orgId, id: imported.id, revision: firstRevision, index: 0,
                values: ['Анна', '14', 'Проверено'], comment: 'Конкурентная правка'
            })
        ])
        assert.equal(competing.filter(result => result.status == 'fulfilled').length, 1)
        await assert.rejects(reviewer.facade.control.detail({orgId, id: imported.id, revision: firstRevision}), /изменён/)
        const current = await reviewer.facade.control.detail({orgId, id: imported.id, revision: doc(imported.id).revision})
        assert(current.originalText.includes('Анна, Мария'))
        assert.equal(current.comments.length, 1)
        await assert.rejects(reviewer.facade.control.export({orgId, id: imported.id, revision: current.revision, format: 'json'}), /утверждения/)
        const approved = await reviewerCommands.documentApprove('approve', {orgId, id: imported.id, revision: current.revision})
        const exported = await customer.facade.control.export({orgId, id: imported.id, revision: approved.revision, format: 'json'})
        assert.equal(JSON.parse(Buffer.from(exported.bytes).toString()).rows[0][1], '13')
        const csv = await customer.facade.control.export({orgId, id: imported.id, revision: approved.revision, format: 'csv'})
        assert.equal(parseCsv(Buffer.from(csv.bytes).toString()).rows[0][1], '13')
        await reviewerCommands.documentReopen('reopen', {orgId, id: imported.id, revision: approved.revision})
        await reviewerCommands.documentRow('edit-after-approve', {
            orgId,
            id: imported.id,
            revision: doc(imported.id).revision,
            index: 0,
            values: ['Анна', '99', 'Другая редакция'],
            comment: ''
        })
        assert.equal(doc(imported.id).approvals[0].table.rows[0][1], '13', 'approved snapshot immutable under later review changes')

        const slow = await customer.facade.control.upload({orgId, name: 'slow-a.csv', bytes})
        const slowRun = run(slow.id, 'node', 'slow-cancel')
        await until('first slow execution', () => delayed.has('slow-a.csv'))
        // Forged negative input is never accepted as a real Counter settlement.
        const forgedReceipt: UsageReceipt = {id: 'a'.repeat(64), eventId: 'documents-' + slowRun.id, orgId,
            status: 'committed', period: '2026-09', units: 1, reservedUnits: 1, fresh: true}
        const negativeReceipts = [
            {...forgedReceipt, orgId: 'harbor'}, {...forgedReceipt, eventId: 'documents-other-run'},
            {...forgedReceipt, status: 'reserved' as const}, {...forgedReceipt, units: 2},
            {...forgedReceipt, reservedUnits: 2}, {...forgedReceipt, id: 'invalid'}, {...forgedReceipt, period: '2026-13'}
        ]
        const resultInput = {orgId, id: slow.id, actor: 'customer', runId: slowRun.id, attempt: doc(slow.id).attempt,
            sourceVersion: doc(slow.id).sourceVersion, headers: ['rejected'], rows: [['forged']]}
        for (const [index, usageReceipt] of negativeReceipts.entries()) {
            await assert.rejects(leader.corridor.system.processingResult('negative-receipt-' + index, {...resultInput, usageReceipt}))
        }
        for (const sourceVersion of [undefined, resultInput.sourceVersion + 1]) {
            await assert.rejects(leader.corridor.system.processingResult('negative-source-' + sourceVersion,
                {...resultInput, sourceVersion, usageReceipt: forgedReceipt}))
        }
        assert.equal(doc(slow.id).status, 'processing')
        assert.equal(doc(slow.id).usageReceipt, undefined)
        assert.equal(doc(slow.id).table.rows.length, 0)
        // Seed stale metadata only in an isolated domain snapshot to prove clearing, not settlement validity.
        for (const command of ['processingBegin', 'documentImport'] as const) {
            const isolated = state()
            const previous = isolated.documents[slow.id]
            previous.status = command == 'processingBegin' ? 'failed' : 'deleted'
            previous.usageReceipt = {...forgedReceipt}
            previous.provenance = {sourceVersion: previous.sourceVersion, provider: 'stale-fixture', demo: true, fields: []}
            const ctx = {state: isolated, account: 'system', roles: ['system'], requestId: 'isolated-clear', command}
            const commands = createDocumentDomain().commands
            if (command == 'processingBegin') commands.processingBegin.apply(ctx, {
                orgId, id: slow.id, actor: 'customer', runId: 'new-attempt', revision: previous.revision, processor: 'node'
            })
            else commands.documentImport.apply(ctx, {orgId, id: slow.id, actor: 'customer', name: previous.name,
                blobId: previous.blobId, size: previous.size})
            assert.equal(isolated.documents[slow.id].usageReceipt, undefined)
            assert.equal(isolated.documents[slow.id].provenance, undefined)
        }
        customer.facade.ai.cancelRun(slowRun.id)
        await until('cancelled document', () => doc(slow.id).status == 'cancelled')
        hold = false
        run(slow.id, 'node', 'retry-after-cancel')
        await until('retry succeeds', () => doc(slow.id).status == 'review')
        delayed.get('slow-a.csv')!({headers: ['evil'], rows: [['stale']]})
        await new Promise(resolve => setTimeout(resolve, 40))
        assert.equal(doc(slow.id).table.headers[0], 'name', 'late cancelled attempt cannot overwrite retry')
        hold = true
        const a = await customer.facade.control.upload({orgId, name: 'slow-b.csv', bytes})
        const b = await customer.facade.control.upload({orgId, name: 'slow-c.csv', bytes})
        const c = await customer.facade.control.upload({orgId, name: 'third.csv', bytes})
        const ar = run(a.id, 'node', 'parallel-a'), br = run(b.id, 'node', 'parallel-b')
        await until('two independent processors', () => delayed.has('slow-b.csv') && delayed.has('slow-c.csv'))
        assert.throws(() => run(c.id, 'node', 'parallel-third'), /denied|forbidden|allowed/)
        customer.facade.ai.cancelRun(ar.id)
        customer.facade.ai.cancelRun(br.id)
        await until('both slots cancelled', () => doc(a.id).status == 'cancelled' && doc(b.id).status == 'cancelled')
        delayed.get('slow-b.csv')!({headers: ['late'], rows: []})
        delayed.get('slow-c.csv')!({headers: ['late'], rows: []})
        hold = false
        if (process.env.DOCUMENT_PYTHON) {
            const python = await customer.facade.control.upload({orgId, name: 'python.csv', bytes})
            run(python.id, 'python', 'python-extraction')
            await until('python extraction', () => ['review', 'failed'].includes(doc(python.id).status))
            assert.equal(doc(python.id).status, 'review', doc(python.id).error)
            assert.deepEqual(doc(python.id).table, parseCsv(bytes.toString()))
        } else console.log('SKIP real Python: set DOCUMENT_PYTHON to the installed interpreter')
        const parsed = await real.extract({
            name: 'invoice.pdf',
            bytes: pdfFixture('Invoice total 42'),
            processor: 'node',
            signal: signal.signal
        })
        assert(parsed.rows[0][1].includes('Invoice total 42'))
        const pdf = await customer.facade.control.upload({orgId, name: 'invoice.pdf', bytes: pdfFixture('Invoice total 42')})
        run(pdf.id, 'node', 'pdf-text')
        await until('PDF text extraction', () => ['review', 'failed'].includes(doc(pdf.id).status))
        assert.equal(doc(pdf.id).status, 'review', doc(pdf.id).error)
        assert.equal(doc(pdf.id).table.headers[0], 'Страница')
        assert(doc(pdf.id).table.rows[0][1].includes('Invoice total 42'))
        const pdfDetail = await reviewer.facade.control.detail({orgId, id: pdf.id, revision: doc(pdf.id).revision})
        assert.equal(pdfDetail.sourceType, 'pdf')
        assert(!pdfDetail.originalText.includes('%PDF'), 'binary PDF is not decoded as UTF-8 text')
        for (const [name, content, error] of [
            ['empty.pdf', pdfFixture(''), 'текстового слоя'],
            ['protected.pdf', pdfFixture('Secret', 1, true), 'паролем'],
            ['too-many-pages.pdf', pdfFixture('Page', 11), '10 страниц'],
            ['broken.pdf', Buffer.from('%PDF-1.4\ninvalid'), 'повреждён']
        ] as const) {
            const bad = await customer.facade.control.upload({orgId, name, bytes: content})
            run(bad.id, 'node', name)
            await until('reject ' + name, () => doc(bad.id).status == 'failed')
            assert(doc(bad.id).error.includes(error), doc(bad.id).error)
        }
        const uniqueBytes = Buffer.from('private,value\nunique-cleanup,123')
        const unique = await customer.facade.control.upload({orgId, name: 'cleanup.csv', bytes: uniqueBytes})
        const blobPath = path.join(directory, 'blobs', doc(unique.id).blobId)
        assert(existsSync(blobPath))
        const removed = await customerCommands.documentDelete('cleanup-delete', {orgId, id: unique.id, revision: doc(unique.id).revision})
        await until('unreferenced blob removed', () => !existsSync(blobPath))
        const restored = await customer.facade.control.upload({orgId, name: 'cleanup.csv', bytes: uniqueBytes})
        assert.equal(restored.id, unique.id)
        assert.equal(restored.revision, removed.revision + 1)
        assert.equal(doc(restored.id).sourceVersion, 2)
        assert(existsSync(blobPath))
        hold = true
        const timed = await customer.facade.control.upload({orgId, name: 'slow-timeout.csv', bytes})
        run(timed.id, 'node', 'timeout')
        await until('hung provider bounded by timeout', () => doc(timed.id).status == 'failed')
        delayed.get('slow-timeout.csv')!({headers: ['late'], rows: []})
        assert.equal(doc(timed.id).table.rows.length, 0)
        await ownerCommands.memberRole('revoke', {orgId, account: 'customer', role: 'revoked'})
        await assert.rejects(customer.facade.control.download({orgId, id: imported.id}), /доступа/)
        assert.equal(documentWorkspace(state(), {account: 'customer', roles: ['owner']}).documents.length, 0)
        const deletion = await reviewerCommands.documentDelete('delete', {orgId, id: imported.id, revision: doc(imported.id).revision})
        await assert.rejects(reviewer.facade.control.detail({orgId, id: imported.id, revision: deletion.revision}), /недоступен/)
        assert.equal(doc(imported.id).table.rows.length, 0)
        assert.equal(started.kind, 'extract')
        console.log('PASS documents: CSV quoting/UTF-8/Python, real PDF text + empty/encrypted/oversized-pages/malformed rejection, internal command boundary, 512KiB limit, dedup, tenant/private detail, concurrent review, immutable approval/export, two processors, cancel/late result/retry/timeout, revoke, physical delete/reimport')
    } finally {
        signal.abort()
        customer.close()
        reviewer.close()
        outsider.close()
        close()
        leader.control.close()
        await new Promise(resolve => setTimeout(resolve, 100))
        assert.equal(path.dirname(realpathSync(directory)), temporary)
        rmSync(directory, {recursive: true, force: true})
    }
}

main().catch(function failed(error) {
    console.error(error)
    process.exitCode = 1
})
