import assert from 'node:assert/strict'
import {existsSync, mkdtempSync, realpathSync, rmSync, readdirSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {setTimeout as delay} from 'node:timers/promises'
import {createServiceLeader} from 'wenay-common2/service/server'
import {createProcessResource} from 'wenay-common2/server/process'
import {createDocumentProcessor} from './processing-resource'
import {createDocumentRuntime} from './runtime'
import {validateExtraction} from './model-extraction'

async function until(label: string, test: () => boolean) {const deadline = Date.now() + 10000; while (!test()) {assert(Date.now() < deadline, label); await delay(15)}}
function pdfFixture() {
    const content = 'BT /F1 12 Tf 20 100 Td (Independent Node document) Tj ET'
    const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [5 0 R] /Count 1 >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', '<< /Length ' + content.length + ' >>\nstream\n' + content + '\nendstream', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 3 0 R >> >> /Contents 4 0 R >>']
    let text = '%PDF-1.4\n'; const offsets = [0]
    for (const [index, object] of objects.entries()) {offsets.push(Buffer.byteLength(text)); text += index + 1 + ' 0 obj\n' + object + '\nendobj\n'}
    const xref = Buffer.byteLength(text)
    text += 'xref\n0 6\n0000000000 65535 f \n' + offsets.slice(1).map(offset => String(offset).padStart(10, '0') + ' 00000 n \n').join('') + 'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n'
    return Buffer.from(text)
}
async function main() {
    const temporary = realpathSync(tmpdir()), directory = mkdtempSync(path.join(temporary, 'documents-advanced-'))
    const children: {pid: number, stopped: () => boolean, release: () => void}[] = []
    // Gate delivery after real child output, keeping both actual processes alive to exercise independent cancellation.
    const processFactory: typeof createProcessResource = function childResource(input) {
        const child = createProcessResource(input)
        const ready = child.ready.then(async function parsed(value) {await new Promise<void>(release => children.push({pid: child.view.pid()!, stopped: child.view.stopped, release})); return value})
        return {...child, ready}
    }
    const processor = createDocumentProcessor({directory, python: process.env.DOCUMENT_PYTHON, processFactory})
    const runtime = createDocumentRuntime({directory, processor}), leader = createServiceLeader({definition: runtime.definition, selfUrl: () => 'http://localhost'})
    const close = runtime.mount({store: leader.line.control.store, execute: leader.corridor.system}); await runtime.view.ready()
    const controller = new AbortController(), context = (account: string) => ({principal: {account, roles: ['signedIn']}, sessionId: account, resourceId: 'processor', signal: controller.signal})
    const customer = runtime.definition.resources.processor.open(context('customer')), foreign = runtime.definition.resources.processor.open(context('outsider'))
    const commands = leader.corridor.fragment('reviewer'), state = () => leader.line.control.store.snapshot()
    let seq = 0; const rpc = () => 'advanced-' + (++seq), orgId = 'northstar'
    function request(id: string, processor: string) {return {requestId: rpc(), kind: 'extract', resourceIds: [id], input: {orgId, documentId: id, revision: state().documents[id].revision, processor}}}
    try {
        const token = customer.facade.control.beginUpload(orgId)
        assert.throws(() => foreign.facade.control.cancelUpload(token.uploadId), /недоступна/)
        const uploading = customer.facade.control.upload({orgId, name: 'cancel.csv', bytes: Buffer.from('a,b\n1,2'), uploadId: token.uploadId})
        assert.equal(customer.facade.control.cancelUpload(token.uploadId).status, 'cancelled')
        await assert.rejects(uploading)
        assert.equal(Object.keys(state().documents).length, 0)
        await assert.rejects(customer.facade.control.upload({orgId, name: 'retry.csv', bytes: Buffer.from('a,b\n1,2'), uploadId: token.uploadId}))
        assert(!existsSync(path.join(directory, 'blobs')) || !readdirSync(path.join(directory, 'blobs')).length)
        const completedToken = customer.facade.control.beginUpload(orgId)
        const uploaded = await customer.facade.control.upload({orgId, name: 'fields.txt', bytes: Buffer.from('Имя: Анна\nСумма: 1200'), uploadId: completedToken.uploadId})
        assert.equal(customer.facade.control.cancelUpload(completedToken.uploadId).status, 'completed', 'cancel does not lie after commit')
        customer.facade.ai.createRun(request(uploaded.id, 'model'))
        await until('model extraction', () => state().documents[uploaded.id].status == 'review')
        const first = state().documents[uploaded.id]
        assert.equal(first.provenance?.demo, true); assert.equal(first.provenance.sourceVersion, 1); assert.equal(first.provenance.fields.length, 4)
        assert.equal(first.provenance.fields[3].line, 2); assert.equal(first.provenance.fields[3].quote, 'Сумма: 1200')
        assert.equal(first.table.rows[1][1], '1200')
        const approved = await commands.documentApprove(rpc(), {orgId, id: first.id, revision: first.revision})
        const reopened = await commands.documentReopen(rpc(), {orgId, id: first.id, revision: approved.revision})
        const edited = await commands.documentRow(rpc(), {orgId, id: first.id, revision: reopened.revision, index: 1, values: ['Сумма', '1250'], comment: 'Сверено человеком'})
        const comparison = await customer.facade.control.compare({orgId, id: first.id, revision: edited.revision, approvedRevision: approved.revision})
        assert.equal(comparison.previous.table.rows[1][1], '1200'); assert.equal(comparison.current.table.rows[1][1], '1250')
        assert.equal(comparison.previous.provenance?.fields[3].quote, 'Сумма: 1200')
        await assert.rejects(foreign.facade.control.compare({orgId, id: first.id, revision: edited.revision, approvedRevision: approved.revision}))
        await assert.rejects(customer.facade.control.compare({orgId, id: first.id, revision: first.revision, approvedRevision: approved.revision}), /изменён/)
        assert.throws(() => validateExtraction({table: {headers: ['x'], rows: [['y']]}, fields: [], demo: true, provider: 'bad-fixture'}), /поле требует/)
        let receivedVersion = 0
        const replacement = createDocumentProcessor({directory, extractor: {async extract(input) {receivedVersion = input.sourceVersion; assert.deepEqual(Buffer.from(input.bytes), pdfFixture()); return {table: {headers: ['Текст'], rows: [['Fixture extraction']]}, fields: [{row: 0, column: 0, page: 1, line: 0, quote: 'Fixture source on page 1'}], provider: 'fake-ocr-acceptance', demo: true}}}})
        const extracted = await replacement.extract({name: 'scan.pdf', bytes: pdfFixture(), sourceVersion: 7, processor: 'model', signal: new AbortController().signal})
        assert.equal(receivedVersion, 7); assert.equal(extracted.provenance?.sourceVersion, 7); assert.equal(extracted.provenance?.fields[0].page, 1)
        if (!process.env.DOCUMENT_PYTHON) throw new Error('D07 acceptance requires DOCUMENT_PYTHON; do not claim real Python coverage without it')
        const nodeDoc = await customer.facade.control.upload({orgId, name: 'parallel.pdf', bytes: pdfFixture()})
        const pythonDoc = await customer.facade.control.upload({orgId, name: 'parallel.csv', bytes: Buffer.from('name,amount\nIndependent Python,42')})
        const nodeRun = customer.facade.ai.createRun(request(nodeDoc.id, 'node')), pythonRun = customer.facade.ai.createRun(request(pythonDoc.id, 'python'))
        await until('two real child outputs', () => children.length == 2)
        assert(children.every(child => child.pid > 0 && !child.stopped())); assert.notEqual(children[0].pid, children[1].pid)
        assert.equal(state().documents[nodeDoc.id].status, 'processing'); assert.equal(state().documents[pythonDoc.id].status, 'processing')
        await customer.facade.ai.cancelRun(nodeRun.id, 'Cancel only Node')
        await until('one child stopped independently', () => children.filter(child => child.stopped()).length == 1)
        assert.equal(state().documents[nodeDoc.id].status, 'cancelled'); assert.equal(state().documents[pythonDoc.id].status, 'processing')
        const continuing = children.find(child => !child.stopped())!, cancelledChild = children.find(child => child.stopped())!
        continuing.release(); await until('Python independently succeeds', () => state().documents[pythonDoc.id].status == 'review')
        assert.equal(state().documents[pythonDoc.id].table.rows[0][1], '42')
        cancelledChild.release(); await delay(100)
        assert.equal(state().documents[nodeDoc.id].status, 'cancelled'); assert.equal(state().documents[nodeDoc.id].table.rows.length, 0)
        assert(pythonRun.id != nodeRun.id); await until('both children cleaned', () => children.every(child => child.stopped()))
        console.log('PASS document gaps: cancellable upload before commit, private transfer token, truthful completed boundary, model/OCR provider port with explicit local fixtures and per-field sourceVersion, immutable comparison, two actual Node/Python PIDs alive concurrently, cancel Node while Python continues, late result ignored')
    } finally {
        for (const child of children) child.release()
        controller.abort(); customer.close(); foreign.close(); close(); leader.control.close(); await delay(150)
        assert(path.dirname(path.resolve(directory)) == temporary && path.basename(directory).startsWith('documents-advanced-')); rmSync(directory, {recursive: true, force: true})
    }
}
main().catch(function failed(error) {console.error(error); process.exitCode = 1})
