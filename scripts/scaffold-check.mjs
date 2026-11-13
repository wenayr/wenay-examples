import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {readFileSync} from 'node:fs'
import {cp, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {createSaasExample, templates} from './create-saas-example.mjs'

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')


// Ни один отслеживаемый исходник приложения не должен потеряться молча: он либо копируется,
// либо назван в skip с причиной. Иначе новый файл просто не попадёт в самостоятельную копию.
function checkManifests() {
    const always = new Set(['package.json', 'package-lock.json', 'tsconfig.json', 'scaffold.json'])
    for (const app of templates(repository)) {
        const prefix = 'apps/' + app + '/'
        const plan = JSON.parse(readFileSync(path.join(repository, prefix, 'scaffold.json'), 'utf8'))
        const known = new Set([...plan.files, ...plan.optional, ...Object.keys(plan.skip), ...always])
        const listed = execFileSync('git', ['ls-files', prefix], {cwd: repository, encoding: 'utf8'})
        for (const line of listed.trim().split('\n').filter(Boolean)) {
            const relative = line.slice(prefix.length)
            assert(known.has(relative), app + ': файл не описан в scaffold.json (добавьте в files или в skip с причиной): ' + relative)
        }
        for (const [file, reason] of Object.entries(plan.skip)) {
            assert(typeof reason == 'string' && reason.length >= 10, app + ': у пропуска ' + file + ' нет внятной причины')
            assert(!plan.files.includes(file), app + ': файл одновременно в files и skip: ' + file)
        }
    }
    return templates(repository).length
}

async function check() {
    const temporary = await mkdtemp(path.join(await realpath(tmpdir()), 'wenay-scaffold-check-'))
    const prefix = temporary + path.sep
    async function remove(target) {
        const absolute = path.resolve(target)
        assert(absolute == temporary || absolute.startsWith(prefix), 'cleanup must remain inside its own temporary directory')
        await rm(absolute, {recursive: true, force: true})
    }
    async function put(file, text) {
        await mkdir(path.dirname(file), {recursive: true})
        await writeFile(file, text)
    }
    async function allFiles(directory) {
        const files = []
        for (const entry of await readdir(directory, {withFileTypes: true})) {
            const file = path.join(directory, entry.name)
            assert(!entry.isSymbolicLink(), 'copied result must not contain links')
            if (entry.isDirectory()) files.push(...await allFiles(file))
            else files.push(file)
        }
        return files
    }
    async function checkReadme(directory) {
        const readme = await readFile(path.join(directory, 'README.md'), 'utf8')
        const pkg = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'))
        for (const command of readme.matchAll(/\bnpm\s+(?:run\s+([\w:-]+)|(test|start))\b/g)) {
            const script = command[1] ?? command[2]
            assert(Object.hasOwn(pkg.scripts, script), directory + ': README предлагает отсутствующий npm script ' + script)
        }
        for (const link of readme.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
            if (/^[a-z]+:|^#/.test(link[1])) continue
            const file = path.resolve(directory, link[1].split('#')[0])
            assert(file.startsWith(directory + path.sep), 'стартовый README ссылается за пределы копии: ' + link[1])
            assert((await lstat(file)).isFile(), 'файл стартового README отсутствует: ' + link[1])
        }
        assert(!readme.includes('## Документация исходного примера'), 'инструкция копии не должна включать README донора целиком')
        const source = await readFile(path.join(directory, 'SOURCE-README.md'), 'utf8')
        assert(source.includes('не инструкция запуска этой копии'), 'история донора должна быть явно отделена')
        const note = await readFile(path.join(directory, 'SCAFFOLD.md'), 'utf8')
        assert(note.includes('Копировщик их не запускал') && note.includes('baseline'), 'результат исходных проверок пока неизвестен')
        assert(!note.includes('Они запускаются и проходят'), 'нельзя обещать результат проверок до их запуска')
    }
    async function checkProductGuide(directory, accounts) {
        const readme = await readFile(path.join(directory, 'README.md'), 'utf8')
        const described = readme.match(/Демонстрационные аккаунты: ([^;]+);/)
        assert(described, directory + ': в стартовом README нет демо-аккаунтов')
        assert.deepEqual(described[1].split(', '), accounts, directory + ': README предлагает аккаунты другого продукта')
        assert(!/DOCUMENT_PYTHON|Python|CSV|OCR|Node-обработка|примера documents/.test(readme), directory + ': осталась инструкция documents')
    }

    try {
        const described = checkManifests()
        assert(described >= 8, 'ожидалось не меньше восьми шаблонов с манифестом')
        const copy = path.join(temporary, 'support-copy')
        const result = await createSaasExample({template: 'support', destination: copy, name: 'support-copy'})
        assert(result.files >= 20)
        const pkg = JSON.parse(await readFile(path.join(copy, 'package.json'), 'utf8'))
        const lock = JSON.parse(await readFile(path.join(copy, 'package-lock.json'), 'utf8'))
        assert.equal(pkg.name, 'support-copy')
        assert.equal(lock.name, pkg.name)
        assert.equal(lock.packages[''].name, pkg.name)
        const sourcePackage = JSON.parse(await readFile(path.join(repository, 'apps', 'support', 'package.json'), 'utf8'))
        assert.deepEqual(pkg.dependencies, sourcePackage.dependencies)
        assert.deepEqual(pkg.devDependencies, sourcePackage.devDependencies)
        assert((await readFile(path.join(copy, 'README.md'), 'utf8')).includes('npm ci'))
        assert((await readFile(path.join(copy, 'AGENTS.md'), 'utf8')).includes('doc/CODE-RULES.md'))

        const fixture = path.join(temporary, 'source-repository')
        const fixtureSource = path.join(fixture, 'apps', 'support')
        await cp(copy, fixtureSource, {recursive: true, force: false, errorOnExist: true})
        const donorOnly = 'DONOR_ONLY_UNAVAILABLE_STEP\n\nnpm run source:only\n\n[Внешний отчёт](../../doc/ABSENT-DONOR.md)\n'
        await put(path.join(fixtureSource, 'README.md'), donorOnly)
        await put(path.join(fixture, 'doc', 'CODE-RULES.md'), await readFile(path.join(repository, 'doc', 'CODE-RULES.md')))
        const marker = 'PRIVATE_TEST_ONLY_' + Date.now()
        for (const name of ['.env', '.env.production', 'backend/.env', 'backend/secrets.ts', 'backend/private-key.pem', 'backend/token.json', 'backend/temporary/debug.ts', 'public/index.html', 'support-data/private.json', 'testtemp/dump.json']) {
            await put(path.join(fixtureSource, name), marker)
        }
        const external = path.join(temporary, 'external-private')
        await put(path.join(external, 'secret.txt'), marker)
        await symlink(external, path.join(fixtureSource, 'node_modules'), process.platform == 'win32' ? 'junction' : 'dir')
        const clean = path.join(temporary, 'clean-copy')
        await mkdir(clean)
        await createSaasExample({template: 'support', repository: fixture, destination: clean, name: 'clean-copy'})
        await checkReadme(clean)
        assert(!(await readFile(path.join(clean, 'README.md'), 'utf8')).includes('DONOR_ONLY_UNAVAILABLE_STEP'))
        assert((await readFile(path.join(clean, 'SOURCE-README.md'), 'utf8')).includes(donorOnly))
        const outputs = await allFiles(clean)
        for (const file of outputs) assert(!(await readFile(file, 'utf8')).includes(marker), 'secret/build/data marker was copied: ' + file)
        for (const name of ['.env', '.env.production', 'node_modules', 'public', 'support-data', 'testtemp', 'backend/secrets.ts', 'backend/temporary']) {
            await assert.rejects(lstat(path.join(clean, name)), {code: 'ENOENT'})
        }
        assert.equal(await readFile(path.join(external, 'secret.txt'), 'utf8'), marker)

        const occupied = path.join(temporary, 'occupied')
        await put(path.join(occupied, 'keep.txt'), marker)
        await assert.rejects(createSaasExample({template: 'support', repository: fixture, destination: occupied}), /пустым/)
        assert.deepEqual(await readdir(occupied), ['keep.txt'])
        assert.equal(await readFile(path.join(occupied, 'keep.txt'), 'utf8'), marker)
        for (const collision of [fixtureSource, path.join(fixtureSource, 'new-copy'), path.dirname(fixtureSource)]) {
            await assert.rejects(createSaasExample({template: 'support', repository: fixture, destination: collision}), /пересекается/)
        }

        const destinationLink = path.join(temporary, 'destination-link')
        await symlink(external, destinationLink, process.platform == 'win32' ? 'junction' : 'dir')
        await assert.rejects(createSaasExample({template: 'support', repository: fixture, destination: path.join(destinationLink, 'new-copy')}), /Ссылки/)
        assert.deepEqual(await readdir(external), ['secret.txt'])

        const mainFile = path.join(fixtureSource, 'frontend', 'main.tsx')
        const original = await readFile(mainFile, 'utf8')
        await put(mainFile, original + "\nimport '../../../other-app/private.ts'\n")
        const crossDestination = path.join(temporary, 'cross-app-copy')
        await assert.rejects(createSaasExample({template: 'support', repository: fixture, destination: crossDestination}), /за пределы примера/)
        await assert.rejects(lstat(crossDestination), {code: 'ENOENT'})
        await put(mainFile, original + "\nimport './unlisted-source.ts'\n")
        await assert.rejects(createSaasExample({template: 'support', repository: fixture, destination: crossDestination}), /разрешённый набор/)
        await put(mainFile, original)

        const frontend = path.join(fixtureSource, 'frontend')
        await remove(frontend)
        await symlink(path.join(copy, 'frontend'), frontend, process.platform == 'win32' ? 'junction' : 'dir')
        await assert.rejects(createSaasExample({template: 'support', repository: fixture, destination: path.join(temporary, 'linked-source')}), /Ссылки/)
        assert.equal(await readFile(path.join(copy, 'frontend', 'main.tsx'), 'utf8'), original)

        const named = path.join(temporary, 'named-copy')
        const namedResult = await createSaasExample({template: 'approvals', destination: named, name: 'named-copy', port: 4990, title: 'Проба копии'})
        assert.equal(namedResult.port, '4990')
        assert((await readFile(path.join(named, 'frontend/index.html'), 'utf8')).includes('<title>Проба копии</title>'))
        assert((await readFile(path.join(named, 'backend/server.ts'), 'utf8')).includes('4990'))
        assert((await readFile(path.join(named, 'frontend/vite.config.ts'), 'utf8')).includes('4990'))
        for (const file of await allFiles(named)) {
            if (path.basename(file) == 'SOURCE-README.md') continue
            assert(!(await readFile(file, 'utf8')).includes('3818'), 'донорский порт остался в ' + file)
        }
        assert((await readFile(path.join(named, 'README.md'), 'utf8')).startsWith('# Проба копии'))
        const note = await readFile(path.join(named, 'SCAFFOLD.md'), 'utf8')
        assert(note.includes('approvals') && note.includes('4990') && note.includes('backend/check.ts'))
        assert(namedResult.inherited.length >= 2)
        for (const file of namedResult.inherited) {
            assert((await readFile(path.join(named, file), 'utf8')).startsWith('// Проверка унаследована от шаблона approvals'))
        }
        await assert.rejects(createSaasExample({template: 'approvals', destination: path.join(temporary, 'bad-port'), port: 80}), /Порт копии/)

        await assert.rejects(createSaasExample({template: 'unknown', destination: path.join(temporary, 'bad')}), /Выберите один из шаблонов/)
        await assert.rejects(createSaasExample({template: 'support', destination: path.join(temporary, 'bad'), name: '../escape'}), /Имя npm/)
        const documents = path.join(temporary, 'documents-copy')
        const crm = path.join(temporary, 'crm-copy')
        await createSaasExample({template: 'crm', destination: crm, name: 'crm-copy'})
        const crmPackage = JSON.parse(await readFile(path.join(crm, 'package.json'), 'utf8'))
        assert.equal(crmPackage.name, 'crm-copy')
        for (const file of ['backend/imports.ts', 'backend/import-check.ts', 'backend/assistant-resource.ts', 'backend/check.ts', 'organizer/task-domain.ts', 'frontend/imports.tsx', 'frontend/assistant.tsx']) assert((await lstat(path.join(crm, file))).isFile())
        assert((await readFile(path.join(crm, 'README.md'), 'utf8')).includes('3913'))
        const approvals = path.join(temporary, 'approvals-copy')
        await createSaasExample({template: 'approvals', destination: approvals, name: 'approvals-copy'})
        await checkProductGuide(approvals, ['owner', 'reviewer', 'requester', 'requester2', 'outsider'])
        const approvalFiles = ['backend/domain.ts', 'backend/domain-check.ts', 'backend/check.ts', 'backend/questions.ts', 'frontend/questions.tsx', 'frontend/main.tsx']
        for (const file of approvalFiles) assert((await lstat(path.join(approvals, file))).isFile())
        const approvalSource = await readFile(path.join(approvals, 'backend', 'domain.ts'), 'utf8')
        assert(approvalSource.includes('requestDecide'), 'копия согласований содержит решение по версии')
        assert(!approvalSource.includes('formSave'), 'в копии согласований не осталось команд forms')
        assert((await readFile(path.join(approvals, 'README.md'), 'utf8')).includes('3918'))
        const docs = await createSaasExample({template: 'documents', destination: documents, name: 'documents-copy'})
        assert(docs.files >= 20)
        assert((await readFile(path.join(documents, 'backend', 'processor.py'), 'utf8')).includes('csv'))
        assert((await readFile(path.join(documents, 'backend', 'pdf-processor.mjs'), 'utf8')).includes('pdfjs-dist'))
        const metering = path.join(temporary, 'metering-copy')
        await createSaasExample({template: 'metering', destination: metering, name: 'metering-copy'})
        const meterPackage = JSON.parse(await readFile(path.join(metering, 'package.json'), 'utf8'))
        const meterSource = JSON.parse(await readFile(path.join(repository, 'apps/metering/package.json'), 'utf8'))
        const meterLock = JSON.parse(await readFile(path.join(metering, 'package-lock.json'), 'utf8'))
        assert.deepEqual(meterPackage.dependencies, meterSource.dependencies)
        assert.deepEqual(meterPackage.devDependencies, meterSource.devDependencies)
        assert.equal(meterPackage.name, meterLock.packages[''].name)
        assert.equal(meterPackage.name, meterLock.name)
        // Копия сохраняет основной npm test донора без шагов, которых в ней нет.
        const meterExpected = meterSource.scripts.test.split(' && ').filter(step => !step.includes('backup-check.ts')).join(' && ')
        assert.equal(meterPackage.scripts.test, meterExpected)
        assert.equal(meterPackage.scripts['test:integration'], undefined)
        assert.equal(meterPackage.scripts['test:backup'], undefined)
        await assert.rejects(lstat(path.join(metering, 'backend/backup-check.ts')), {code: 'ENOENT'})
        await assert.rejects(lstat(path.join(metering, 'backend/integration-check.ts')), {code: 'ENOENT'})
        for (const file of ['backend/domain-check.ts', 'backend/webhook-check.ts', 'backend/check.ts', 'backend/provider-http.ts', 'frontend/webhooks.tsx', 'Dockerfile', '.dockerignore', '.env.example']) assert((await lstat(path.join(metering, file))).isFile())
        assert(!(await readFile(path.join(metering, 'README.md'), 'utf8')).includes('test:integration'))
        const meteringFixture = path.join(fixture, 'apps/metering')
        await cp(metering, meteringFixture, {recursive: true, force: false, errorOnExist: true})
        for (const name of ['.env', 'metering-data/private.json', 'backend/secret.ts', 'public/index.html']) await put(path.join(meteringFixture, name), marker)
        const meteringClean = path.join(temporary, 'metering-clean')
        await createSaasExample({template: 'metering', repository: fixture, destination: meteringClean})
        for (const file of await allFiles(meteringClean)) assert(!(await readFile(file, 'utf8')).includes(marker))
        const booking = path.join(temporary, 'booking-copy')
        await createSaasExample({template: 'booking', destination: booking, name: 'booking-copy'})
        const bookingPackage = JSON.parse(await readFile(path.join(booking, 'package.json'), 'utf8'))
        const bookingLock = JSON.parse(await readFile(path.join(booking, 'package-lock.json'), 'utf8'))
        assert.equal(bookingPackage.name, bookingLock.packages[''].name)
        assert.equal(bookingPackage.name, bookingLock.name)
        assert.equal(bookingPackage.dependencies['@js-temporal/polyfill'], '0.5.1')
        assert(!(await readFile(path.join(booking, 'README.md'), 'utf8')).includes('test:backup'))
        assert((await readFile(path.join(booking, 'SOURCE-README.md'), 'utf8')).includes('test:backup'))
        for (const file of ['backend/schedule.ts', 'backend/assistant-resource.ts', 'backend/assistant-check.ts', 'backend/check.ts', 'frontend/assistant.tsx', 'Dockerfile', '.dockerignore']) assert((await lstat(path.join(booking, file))).isFile())
        assert((await readFile(path.join(booking, 'README.md'), 'utf8')).includes('3914'))
        const bookingFixture = path.join(fixture, 'apps/booking')
        await cp(booking, bookingFixture, {recursive: true, force: false, errorOnExist: true})
        for (const name of ['.env', 'booking-data/private.json', 'booking-data/jobs/results.replay', 'backend/secret.ts', 'public/index.html']) await put(path.join(bookingFixture, name), marker)
        const bookingClean = path.join(temporary, 'booking-clean')
        await createSaasExample({template: 'booking', repository: fixture, destination: bookingClean})
        for (const file of await allFiles(bookingClean)) assert(!(await readFile(file, 'utf8')).includes(marker))
        const forms = path.join(temporary, 'forms-copy')
        await createSaasExample({template: 'forms', destination: forms, name: 'forms-copy'})
        const formsPackage = JSON.parse(await readFile(path.join(forms, 'package.json'), 'utf8'))
        const formsLock = JSON.parse(await readFile(path.join(forms, 'package-lock.json'), 'utf8'))
        assert.equal(formsPackage.name, formsLock.packages[''].name)
        assert.equal(formsPackage.name, formsLock.name)
        for (const file of ['backend/archive.ts', 'backend/grouping-resource.ts', 'backend/grouping-check.ts', 'backend/resource-check.ts', 'backend/check.ts', 'frontend/grouping.tsx', 'frontend/respondent.tsx', 'Dockerfile', '.dockerignore']) assert((await lstat(path.join(forms, file))).isFile())
        assert((await readFile(path.join(forms, 'README.md'), 'utf8')).includes('3915'))
        const formsFixture = path.join(fixture, 'apps/forms')
        await cp(forms, formsFixture, {recursive: true, force: false, errorOnExist: true})
        for (const name of ['.env', 'forms-data/forms.jsonl', 'forms-data/exports/grouping/groups.replay', 'backend/secret.ts', 'public/index.html']) await put(path.join(formsFixture, name), marker)
        const formsClean = path.join(temporary, 'forms-clean')
        await createSaasExample({template: 'forms', repository: fixture, destination: formsClean})
        for (const file of await allFiles(formsClean)) assert(!(await readFile(file, 'utf8')).includes(marker))
        const content = path.join(temporary, 'content-copy')
        await createSaasExample({template: 'content', destination: content, name: 'content-copy'})
        await checkProductGuide(content, ['owner', 'author', 'editor', 'publisher', 'reader', 'outsider'])
        const contentPackage = JSON.parse(await readFile(path.join(content, 'package.json'), 'utf8'))
        assert(!JSON.stringify(contentPackage.scripts).includes('test:integration'))
        assert(!JSON.stringify(contentPackage.scripts).includes('integration-check'))
        await assert.rejects(lstat(path.join(content, 'backend/integration-check.ts')), {code: 'ENOENT'})
        for (const file of ['backend/public-http.ts', 'backend/files-resource.ts', 'backend/published-contract.ts', 'frontend/editor.tsx', 'frontend/article.tsx', 'frontend/media.tsx']) {
            assert((await lstat(path.join(content, file))).isFile())
        }
        assert((await readFile(path.join(content, 'README.md'), 'utf8')).includes('3917'))

        const monitoring = path.join(temporary, 'monitoring-copy')
        await createSaasExample({template: 'monitoring', destination: monitoring, name: 'monitoring-copy'})
        const monitoringPackage = JSON.parse(await readFile(path.join(monitoring, 'package.json'), 'utf8'))
        const monitoringLock = JSON.parse(await readFile(path.join(monitoring, 'package-lock.json'), 'utf8'))
        assert.equal(monitoringPackage.name, monitoringLock.packages[''].name)
        assert.equal(monitoringPackage.name, monitoringLock.name)
        for (const file of ['backend/http-probe.ts', 'backend/probe-worker.ts', 'backend/probe-check.ts', 'backend/assistant-check.ts', 'backend/ui-fixture.ts', 'backend/check.ts', 'frontend/tasks.tsx', 'organizer/task-domain.ts', 'Dockerfile']) assert((await lstat(path.join(monitoring, file))).isFile())
        assert((await readFile(path.join(monitoring, 'README.md'), 'utf8')).includes('3916'))
        const monitoringFixture = path.join(fixture, 'apps/monitoring')
        await cp(monitoring, monitoringFixture, {recursive: true, force: false, errorOnExist: true})
        for (const name of ['.env', 'monitoring-data/monitoring.jsonl', 'monitoring-data/assistant/results.replay', 'preview/report.json', 'backend/secret.ts', 'public/index.html']) await put(path.join(monitoringFixture, name), marker)
        const monitoringClean = path.join(temporary, 'monitoring-clean')
        await createSaasExample({template: 'monitoring', repository: fixture, destination: monitoringClean})
        for (const file of await allFiles(monitoringClean)) assert(!(await readFile(file, 'utf8')).includes(marker))
        const chat = path.join(temporary, 'chat-copy')
        await createSaasExample({template: 'chat', destination: chat, name: 'chat-copy'})
        await checkProductGuide(chat, ['alice', 'bob'])
        await assert.rejects(lstat(path.join(chat, 'desktop')), {code: 'ENOENT'})
        assert((await readFile(path.join(chat, 'README.md'), 'utf8')).includes('3919'))
        for (const directory of [copy, named, crm, approvals, documents, metering, booking, forms, content, monitoring, chat]) {
            await checkReadme(directory)
        }
        console.log('Scaffold checks passed: ' + described + ' apps with own manifests, exact lock/name, monitoring HTTP workers/AI/organizer, forms archive/grouping/public sources, booking DST/AI/runtime sources, metering repo-only integration omitted, no secrets/data/build/deps, no overwrite, collision guards, no symlink/junction following, approvals decision domain without forms commands, content without cross-app integration check, own port/title and marked inherited checks, no cross-app or missing local imports')
    } finally {
        await remove(temporary)
    }
}

check().catch(function failed(error) {console.error(error); process.exitCode = 1})
