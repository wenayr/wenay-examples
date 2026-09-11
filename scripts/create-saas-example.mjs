import {existsSync, readFileSync, readdirSync} from 'node:fs'
import {lstat, mkdir, readFile, readdir, writeFile} from 'node:fs/promises'
import {builtinModules} from 'node:module'
import path from 'node:path'
import {fileURLToPath, pathToFileURL} from 'node:url'

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
// Манифест копии принадлежит приложению: apps/<app>/scaffold.json перечисляет
// копируемые исходники, необязательные файлы и осознанно пропущенные с причиной.
// Копия остаётся автономной, а расхождение общих файлов ловит scripts/sync-check.mjs.
function manifestFile(root, template) {
    return path.join(root, 'apps', template, 'scaffold.json')
}

export function templates(root = repository) {
    const apps = readdirSync(path.join(root, 'apps'), {withFileTypes: true})
    const found = apps.filter(entry => entry.isDirectory() && existsSync(manifestFile(root, entry.name)))
    return found.map(entry => entry.name).sort()
}

function manifest(root, template) {
    const value = JSON.parse(readFileSync(manifestFile(root, template), 'utf8'))
    if (!Array.isArray(value.files) || value.files.length == 0) throw new Error('scaffold.json без списка files: ' + template)
    if (!Array.isArray(value.optional)) throw new Error('scaffold.json без списка optional: ' + template)
    if (!value.skip || typeof value.skip != 'object') throw new Error('scaffold.json без объекта skip: ' + template)
    return value
}

// scaffold.json переносится вместе с исходниками: копия остаётся пригодной для следующей копии.
const requiredFiles = ['package.json', 'package-lock.json', 'tsconfig.json', 'scaffold.json']

function inside(parent, child) {
    const relative = path.relative(parent, child)
    return relative == '' || (!relative.startsWith('..' + path.sep) && relative != '..' && !path.isAbsolute(relative))
}

async function info(file) {
    try {return await lstat(file)}
    catch (error) {if (error.code == 'ENOENT') return null; throw error}
}

async function rejectLinks(file) {
    const parsed = path.parse(file)
    let current = parsed.root
    for (const part of file.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
        current = path.join(current, part)
        const value = await info(current)
        if (value?.isSymbolicLink()) throw new Error('Ссылки и junction не копируются: ' + current)
    }
}

function sourceSpecifiers(source) {
    const imports = /\b(?:import|export)\s+(?:[^'";]*?\s+from\s*)?['"]([^'"]+)['"]/g
    const dynamic = /\b(?:import|require)\s*\(\s*['"]([^'"]+)['"]/g
    return [...source.matchAll(imports), ...source.matchAll(dynamic)].map(match => match[1])
}

function validateSource(files, sourceRoot, manifest) {
    const all = new Set(files.keys())
    const dependencies = {...manifest.dependencies, ...manifest.devDependencies, ...manifest.optionalDependencies, ...manifest.peerDependencies}
    for (const [name, content] of files) {
        if (!/\.[cm]?[jt]sx?$/.test(name)) continue
        const directory = path.posix.dirname(name)
        for (const specifier of sourceSpecifiers(content.toString('utf8'))) {
            if (specifier.startsWith('.')) {
                const base = path.posix.normalize(path.posix.join(directory, specifier))
                if (base == '..' || base.startsWith('../') || path.posix.isAbsolute(base)) throw new Error(name + ': импорт выходит за пределы примера: ' + specifier)
                const candidates = [base, ...['.ts', '.tsx', '.js', '.mjs', '.json', '/index.ts', '/index.tsx'].map(suffix => base + suffix)]
                if (!candidates.some(file => all.has(file))) throw new Error(name + ': импорт не входит в разрешённый набор файлов: ' + specifier)
            } else {
                if (specifier.startsWith('node:') || builtinModules.includes(specifier)) continue
                const packageName = specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0]
                if (!dependencies[packageName]) throw new Error(name + ': зависимость не указана в package.json: ' + packageName)
            }
        }
        const assets = /path\.(?:resolve|join)\(__dirname,\s*['"]([^'"]+\.(?:ts|js|mjs|py))['"]/g
        for (const match of content.toString('utf8').matchAll(assets)) {
            const asset = path.posix.normalize(path.posix.join(directory, match[1]))
            if (!all.has(asset)) throw new Error(name + ': исполняемый файл отсутствует в наборе: ' + asset)
        }
    }
    for (const [name, command] of Object.entries(manifest.scripts ?? {})) {
        for (const match of command.matchAll(/(?:^|\s)(backend\/[\w./-]+\.(?:[cm]?[jt]s|py))(?=\s|$)/g)) {
            if (!all.has(match[1])) throw new Error('npm script ' + name + ': отсутствует ' + match[1] + ' в ' + sourceRoot)
        }
    }
    for (const [name, version] of Object.entries(dependencies)) {
        if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) throw new Error('Для воспроизводимой копии нужна точная npm-версия: ' + name)
    }
}

// Шаги, запускающие пропущенный файл, убираются; опустевший npm script удаляется целиком.
function removeScript(packageJson, file) {
    const scripts = packageJson.scripts ?? {}
    for (const [key, command] of Object.entries(scripts)) {
        const parts = command.split(' && ').filter(step => !step.includes(file))
        if (parts.length == command.split(' && ').length) continue
        if (parts.length == 0) delete scripts[key]
        else scripts[key] = parts.join(' && ')
    }
}

function instructions(template, name, sourceReadme) {
    const port = {support: 3810, documents: 3811, metering: 3812, crm: 3813, booking: 3814, forms: 3815, monitoring: 3816}[template]
    return `# ${name}

Самостоятельная копия примера ${template}. Название npm-пакета изменено; сервисные идентификаторы, маршруты и предметная модель сохранены, чтобы пример работал без скрытого массового переименования.

## Первый запуск

Требуется Node.js >=22.12. Выполняйте команды последовательно из этого каталога:

\`\`\`text
npm ci --no-audit --no-fund
npm run typecheck
npm test
npm run build
npm start
\`\`\`

Откройте http://127.0.0.1:${port}/. Порт можно изменить через SERVICE_PORT. Файлы .env не загружаются автоматически: задайте переменные окружения процессу или используйте явный Node --env-file.

${template == 'monitoring' ? 'Демонстрационные аккаунты: owner, oncall, observer, outsider; пароль — имя аккаунта + -pass. Для probe-a/probe-b используются отдельные технические роли. HTTP-проверки начинают работать только после создания монитора, цели задаёт оператор. AI-сводка — локальное демо по фактам, автоматических команд хостингу нет. ui-fixture.ts создаёт явно демонстрационные отчёты, npm test выполняет настоящие HTTP-проверки.' : template == 'forms' ? 'Демонстрационные аккаунты: owner, author, analyst, outsider; пароль — имя аккаунта + -pass. Респондент входит только по опубликованному случайному токену. Формы имеют неизменяемые версии, условные поля, агрегаты, удаление и экспорт. Группировка — локальное демо без модели и платных запросов. Все npm test автономны.' : template == 'booking' ? 'Демонстрационные аккаунты: owner, staff, customer, customer2, outsider; пароль — имя аккаунта + -pass. Расписание использует IANA зоны и UTC слоты. TTL/вместимость проверяются authority; помощник — локальный parser без LLM, депозит и напоминания тестовые. Все npm test автономны.' : template == 'crm' ? 'Демонстрационные аккаунты: owner, lead, manager, customer, outsider; пароль — имя аккаунта + -pass. CRM содержит сделки, версии предложений, задачи и импорт контактов. Помощник по умолчанию использует тестовый исполнитель без платной модели.' : template == 'support' ? 'Демонстрационные аккаунты: owner, lead, agent, customer, outsider; пароль — имя аккаунта + -pass. Внешний OIDC-вход описан в OIDC.md. SERVICE_DEMO=0 требует отдельного пустого SERVICE_DATA_DIR. Помощник по умолчанию использует тестовый исполнитель, а не платную модель.' : template == 'metering' ? 'Демонстрационные аккаунты: owner, auditor, outsider; пароль — имя аккаунта + -pass. Учёт использует тестовые единицы, без денежных списаний. npm test проверяет домен, подписанные webhooks и authority с двумя serving nodes. Проверка test:integration связывает соседние приложения support/documents: она предназначена только для исходного репозитория, её файл и npm-команда не включены в эту самостоятельную копию.' : 'Демонстрационные аккаунты: owner, reviewer, customer, outsider; пароль — имя аккаунта + -pass. Для CSV через Python нужен установленный Python 3 и при необходимости DOCUMENT_PYTHON. Node-обработка CSV/TXT и PDF с текстовым слоем не требует ИИ-провайдера. OCR сканов не реализован.'}

## Что перенесено

Только разрешённые исходники, точные npm-зависимости и конфигурация примера. node_modules, сборка public, данные пользователей, .env, ключи и временные файлы не копировались. npm ci создаст зависимости, npm run build создаст public. Dockerfile, если он есть, ожидает уже собранный public.

Небольшие адаптеры shared/react принадлежат этой копии приложения. Это не отдельный SDK или общая обязательная платформа. Перед изменениями прочитайте AGENTS.md и doc/CODE-RULES.md. Уважайте существующие ролевые фасады и используйте публичные API wenay-common2/wenay-react2.

${sourceReadme ? '## Документация исходного примера\n\nНиже сохранено описание примера. Ссылки за пределы каталога (например ../../doc) относятся к исходному репозиторию wenay-examples и не входят в самостоятельную копию.\n\n' + sourceReadme : ''}
`
}

export async function createSaasExample(deps) {
    const {template, destination, name} = deps
    const root = path.resolve(deps.repository ?? repository)
    if (!templates(root).includes(template)) throw new Error('Выберите один из шаблонов: ' + templates(root).join(', '))
    if (typeof destination != 'string' || !destination.trim()) throw new Error('Укажите новый пустой каталог назначения')
    const sourceRoot = path.join(root, 'apps', template)
    const target = path.resolve(destination)
    if (inside(sourceRoot, target) || inside(target, sourceRoot)) throw new Error('Каталог назначения пересекается с исходным примером')
    for (const other of templates(root)) {
        const otherRoot = path.join(root, 'apps', other)
        if (inside(otherRoot, target) || inside(target, otherRoot)) throw new Error('Каталог назначения пересекается с исходными примерами')
    }
    await rejectLinks(sourceRoot)
    await rejectLinks(target)
    const existing = await info(target)
    if (existing && (!existing.isDirectory() || (await readdir(target)).length)) throw new Error('Каталог назначения должен быть пустым; существующие файлы не перезаписываются')
    const packageName = name ?? path.basename(target).toLowerCase()
    if (typeof packageName != 'string' || !/^[a-z0-9][a-z0-9._-]{0,213}$/.test(packageName)) throw new Error('Имя npm-пакета: строчные латинские буквы, цифры, точка, дефис или подчёркивание')

    // The explicit manifest is a boundary: newly added files are never swept into a copy implicitly.
    const files = new Map()
    const plan = manifest(root, template)
    for (const relative of [...requiredFiles, ...plan.files, ...plan.optional]) {
        const file = path.join(sourceRoot, relative)
        await rejectLinks(file)
        const value = await info(file)
        if (!value) {
            if (requiredFiles.includes(relative)) throw new Error('Отсутствует обязательный файл ' + relative)
            continue
        }
        if (!value.isFile()) throw new Error('Ожидался обычный файл: ' + relative)
        files.set(relative, await readFile(file))
    }
    const packageJson = JSON.parse(files.get('package.json').toString('utf8'))
    // Пропущенный исходник не должен остаться в npm scripts копии: иначе она выглядит
    // рабочей, а падает на первой же команде.
    for (const skipped of Object.keys(plan.skip)) removeScript(packageJson, skipped)
    const lock = JSON.parse(files.get('package-lock.json').toString('utf8'))
    if (!lock.packages?.[''] || lock.lockfileVersion < 2) throw new Error('Нужен современный package-lock.json с корневым пакетом')
    for (const [entry, value] of Object.entries(lock.packages)) {
        if (value.link) throw new Error('Локальная ссылка не входит в самостоятельный пример: ' + entry)
        if (!value.resolved) continue
        let url
        try {url = new URL(value.resolved)}
        catch {throw new Error('Непубличная зависимость в lockfile: ' + entry)}
        if (url.protocol != 'https:' || url.username || url.password || url.search || url.hash) throw new Error('Небезопасный адрес зависимости в lockfile: ' + entry)
    }
    validateSource(files, sourceRoot, packageJson)
    if (!files.has('backend/server.ts') || !files.has('frontend/main.tsx')) throw new Error('В исходном примере нет обязательных точек входа')
    packageJson.name = packageName
    lock.name = packageName
    lock.packages[''].name = packageName
    files.set('package.json', Buffer.from(JSON.stringify(packageJson, null, 2) + '\n'))
    files.set('package-lock.json', Buffer.from(JSON.stringify(lock, null, 2) + '\n'))
    files.set('README.md', Buffer.from(instructions(template, packageName, files.get('README.md')?.toString('utf8'))))
    files.set('.gitignore', Buffer.from('node_modules/\npublic/\ndist/\ncoverage/\n.env\n.env.*\n!.env.example\n*-data/\ndata/\n*.log\n*.replay\n'))
    const codeRules = path.join(root, 'doc', 'CODE-RULES.md')
    await rejectLinks(codeRules)
    files.set('doc/CODE-RULES.md', await readFile(codeRules))
    files.set('AGENTS.md', Buffer.from('# Правила приложения\n\nПрочитайте [правила кода](doc/CODE-RULES.md) перед изменениями. Используйте опубликованные публичные API wenay-common2 и wenay-react2, предметные правила оставляйте в приложении.\n'))

    await mkdir(target, {recursive: true})
    for (const [relative, content] of files) {
        const output = path.join(target, relative)
        await rejectLinks(output)
        await mkdir(path.dirname(output), {recursive: true})
        await rejectLinks(output)
        // Exclusive creation also protects an initially empty destination if another writer appears.
        await writeFile(output, content, {flag: 'wx'})
    }
    return {template, destination: target, name: packageName, files: files.size}
}

function usage() {
    return 'node scripts/create-saas-example.mjs <' + templates().join('|') + '> <empty-directory> [--name npm-name]'
}

async function main(args) {
    if (args.length == 1 && ['--help', '-h'].includes(args[0])) {
        console.log(usage())
        return
    }
    if (args.length != 2 && !(args.length == 4 && args[2] == '--name')) throw new Error('Использование: ' + usage())
    const result = await createSaasExample({template: args[0], destination: args[1], name: args[3]})
    console.log('Создан ' + result.name + ': ' + result.destination + ' (' + result.files + ' файлов). Дальше: npm ci, npm run typecheck, npm test, npm run build.')
}

if (process.argv[1] && import.meta.url == pathToFileURL(path.resolve(process.argv[1])).href) {
    main(process.argv.slice(2)).catch(function failed(error) {console.error(error.message); process.exitCode = 1})
}



