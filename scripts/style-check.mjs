import {existsSync, readFileSync, readdirSync} from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const skipped = new Set(['node_modules', 'public', 'work', 'dist', '.git', 'organizer-public', 'vendor'])

export function settings() {
    const file = path.join(repository, 'scripts', 'style-check.json')
    return JSON.parse(readFileSync(file, 'utf8'))
}

function sourceFiles(directory, found = []) {
    if (!existsSync(directory)) return found
    for (const entry of readdirSync(directory, {withFileTypes: true})) {
        if (skipped.has(entry.name) || /-data$/.test(entry.name)) continue
        const full = path.join(directory, entry.name)
        if (entry.isDirectory()) {
            sourceFiles(full, found)
            continue
        }
        if (!/\.(ts|tsx|mjs)$/.test(entry.name) || entry.name.endsWith('.d.ts')) continue
        found.push(full)
    }
    return found
}

// После этих символов `/` начинает регулярное выражение, а не деление.
const beforeRegExp = new Set(['', '(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '*', '~', '%', '<', '>'])

function startsRegExp(before) {
    const trimmed = before.trimEnd()
    if (trimmed == '') return true
    if (beforeRegExp.has(trimmed.slice(-1))) return true
    return /\b(?:return|case|typeof|in|of|instanceof)$/.test(trimmed)
}

function regExpEnd(rest) {
    let cursor = 1
    let inClass = false
    while (cursor < rest.length) {
        const character = rest[cursor]
        if (character == '\\') {cursor += 2; continue}
        if (character == '[') inClass = true
        else if (character == ']') inClass = false
        else if (character == '/' && !inClass) return cursor + 1 + (rest.slice(cursor + 1).match(/^[dgimsuvy]*/)?.[0].length ?? 0)
        cursor++
    }
    return rest.length
}

// Литералы, комментарии и регулярные выражения заменяются пробелами:
// правила смотрят на структуру кода, а не на содержимое строк.
export function withoutText(line, state) {
    let result = ''
    let index = 0
    while (index < line.length) {
        const rest = line.slice(index)
        if (state.template) {
            const end = rest.indexOf('`')
            if (end < 0) {
                result += ' '.repeat(rest.length)
                break
            }
            state.template = false
            result += ' '.repeat(end + 1)
            index += end + 1
            continue
        }
        if (state.comment) {
            const end = rest.indexOf('*/')
            if (end < 0) {
                result += ' '.repeat(rest.length)
                break
            }
            state.comment = false
            result += ' '.repeat(end + 2)
            index += end + 2
            continue
        }
        if (rest.startsWith('//')) {
            result += ' '.repeat(rest.length)
            break
        }
        if (rest.startsWith('/*')) {
            state.comment = true
            result += '  '
            index += 2
            continue
        }
        if (rest[0] == '/' && startsRegExp(result)) {
            const end = regExpEnd(rest)
            result += ' '.repeat(end)
            index += end
            continue
        }
        const quote = rest[0]
        if (quote == '`') {
            state.template = true
            result += ' '
            index += 1
            continue
        }
        if (quote == "'" || quote == '"') {
            let cursor = 1
            while (cursor < rest.length && (rest[cursor] != quote || rest[cursor - 1] == '\\')) cursor++
            result += ' '.repeat(Math.min(cursor + 1, rest.length))
            index += cursor + 1
            continue
        }
        result += rest[0]
        index += 1
    }
    return result
}

const rules = [
    {
        name: 'chain',
        message: 'цепочка из трёх и более преобразований в одной строке',
        test(code) {return (code.match(/\.(?:map|filter|flatMap|some|every|reduce|find)\(/g) ?? []).length >= 3}
    },
    {
        name: 'one-statement',
        message: 'точка с запятой соединяет операторы',
        test(code) {return /;\s*\S/.test(code) && !/^\s*for\s*\(/.test(code)}
    },
    {
        name: 'condition',
        message: 'условие из трёх и более операндов',
        test(code) {
            if (!/\b(?:if|while)\s*\(|^\s*return\b/.test(code)) return false
            return (code.match(/&&|\|\|/g) ?? []).length >= 3
        }
    },
    {
        name: 'spacing',
        message: 'нет пробела после запятой, вокруг = или после if/for/while',
        test(code) {
            // `.catch(` и `.find(` — вызовы метода, а не ключевые слова.
            if (/(?<![.\w])(?:if|for|while|switch|catch)\(/.test(code)) return true
            if (/,[^\s)\]}]/.test(code)) return true
            // `attr={...}` и `attr="..."` — обычная запись атрибута JSX, а не присваивание.
            return /[^\s=!<>+\-*/%&|^~]=[^\s={"]/.test(code) && !/=>/.test(code)
        }
    },
    {
        name: 'ternary',
        message: 'вложенный тернарный оператор',
        test(code) {
            // `?.`, `??` и необязательное свойство `name?:` тернарником не являются.
            const marks = code.match(/(?<![?])\?(?![.?:])/g) ?? []
            return marks.length >= 2
        }
    }
]

// Одна длинная строковая константа или импорт разбиению не подлежат.
function unbreakable(line) {
    if (/^\s*import\s/.test(line)) return true
    const withoutLiterals = withoutText(line, {template: false, comment: false})
    return withoutLiterals.trim().replace(/[(),;]/g, '').length < 40
}

export function checkFile(file, maxLine) {
    const text = readFileSync(file, 'utf8')
    const state = {template: false, comment: false}
    const found = []
    const relative = path.relative(repository, file).replaceAll('\\', '/')
    text.split('\n').forEach(function line(source, index) {
        const code = withoutText(source, state)
        if (source.includes('style: ignore')) return
        if (source.length > maxLine && !unbreakable(source)) {
            found.push({file: relative, line: index + 1, rule: 'max-line', text: source.length + ' символов'})
        }
        for (const rule of rules) {
            if (!rule.test(code)) continue
            found.push({file: relative, line: index + 1, rule: rule.name, text: source.trim().slice(0, 70)})
        }
    })
    return found
}

export function check(options = {}) {
    const config = settings()
    const maxLine = config.maxLine
    const excluded = new Set(config.exclude ?? [])
    const targets = []
    if (options.path) {
        targets.push(path.join(repository, options.path))
    } else {
        const apps = options.app ? [options.app] : config.apps
        for (const directory of config.paths) targets.push(...sourceFiles(path.join(repository, directory)))
        for (const app of apps) targets.push(...sourceFiles(path.join(repository, 'apps', app)))
        // Отдельные файлы приложений, уже приведённых к правилам: приложение
        // целиком попадает в `apps`, когда чистыми становятся все его файлы.
        if (!options.app) for (const file of config.files ?? []) targets.push(path.join(repository, file))
    }
    const files = targets.flatMap(target => target.endsWith('.ts') || target.endsWith('.tsx') || target.endsWith('.mjs') ? [target] : sourceFiles(target))
    const selected = files.filter(file => !excluded.has(path.relative(repository, file).replaceAll('\\', '/')))
    return {found: selected.flatMap(file => checkFile(file, maxLine)), files: selected.length}
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
    const flag = name => process.argv.find(value => value.startsWith('--' + name + '='))?.split('=')[1]
    const app = flag('app')
    const target = flag('path')
    const only = app && target ? path.join('apps', app, target) : target
    const {found, files} = check({app, path: only})
    for (const item of found) console.log(item.file + ':' + item.line + ': ' + item.rule + ': ' + item.text)
    const byRule = new Map()
    for (const item of found) byRule.set(item.rule, (byRule.get(item.rule) ?? 0) + 1)
    console.log('')
    for (const [rule, count] of [...byRule].sort((a, b) => b[1] - a[1])) console.log(rule + ': ' + count)
    console.log('Файлов проверено: ' + files + ', нарушений: ' + found.length)
    process.exitCode = found.length > 0 ? 1 : 0
}
