import {existsSync, readFileSync, readdirSync} from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const skipped = new Set(['node_modules', 'public', 'work', 'dist', '.git', 'organizer-public', 'vendor'])

function markdownFiles(directory, found = []) {
    for (const entry of readdirSync(directory, {withFileTypes: true})) {
        if (skipped.has(entry.name) || /-data$/.test(entry.name)) continue
        const full = path.join(directory, entry.name)
        if (entry.isDirectory()) {markdownFiles(full, found); continue}
        if (entry.name.endsWith('.md')) found.push(full)
    }
    return found
}

// Внутри `кода` и блоков ``` ссылок нет: там встречаются примеры вида ](...).
function withoutCode(text) {
    const fenced = text.replace(/```[\s\S]*?```/g, match => match.replace(/[^\n]/g, ' '))
    return fenced.replace(/`[^`\n]*`/g, match => ' '.repeat(match.length))
}

// Относительные ссылки на файлы репозитория. Внешние схемы и якоря не проверяются.
function targets(text) {
    const found = []
    for (const match of withoutCode(text).matchAll(/\]\(([^)\s]+)\)/g)) {
        const target = match[1]
        if (/^(https?:|mailto:|#)/.test(target)) continue
        found.push({target, index: match.index})
    }
    return found
}

function lineOf(text, index) {
    return text.slice(0, index).split('\n').length
}

export function check() {
    const broken = []
    let total = 0
    for (const file of markdownFiles(repository)) {
        const text = readFileSync(file, 'utf8')
        for (const {target, index} of targets(text)) {
            total++
            const relative = decodeURIComponent(target.split('#')[0])
            if (!relative) continue
            const resolved = path.resolve(path.dirname(file), relative)
            if (existsSync(resolved)) continue
            broken.push({file: path.relative(repository, file), line: lineOf(text, index), target})
        }
    }
    return {broken, total}
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
    const {broken, total} = check()
    for (const item of broken) console.log(item.file + ':' + item.line + ': нет файла ' + item.target)
    console.log('')
    console.log('Проверено ссылок: ' + total + ', битых: ' + broken.length)
    process.exitCode = broken.length > 0 ? 1 : 0
}
