import {createHash} from 'node:crypto'
import {existsSync, readFileSync, readdirSync} from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {APPS} from './run-all.mjs'

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const roots = ['backend', 'frontend', 'shared', 'organizer']

function digest(file) {
    return createHash('sha256').update(readFileSync(file)).digest('hex').slice(0, 12)
}

function collectFiles(app) {
    const found = new Map()
    function walk(directory, prefix) {
        if (!existsSync(directory)) return
        for (const entry of readdirSync(directory, {withFileTypes: true})) {
            const full = path.join(directory, entry.name)
            const relative = prefix + entry.name
            if (entry.isDirectory()) {walk(full, relative + '/'); continue}
            if (!/\.(ts|tsx|mjs)$/.test(entry.name)) continue
            found.set(relative, full)
        }
    }
    for (const root of roots) walk(path.join(repository, 'apps', app, root), root + '/')
    return found
}

// Одинаковый путь в нескольких приложениях — кандидат на общий исходник.
export function groups() {
    const byPath = new Map()
    for (const app of APPS) {
        for (const [relative, full] of collectFiles(app)) {
            if (!byPath.has(relative)) byPath.set(relative, [])
            byPath.get(relative).push({app, full, hash: digest(full), lines: readFileSync(full, 'utf8').split('\n')})
        }
    }
    const result = []
    for (const [relative, copies] of byPath) {
        if (copies.length < 2) continue
        const hashes = new Map()
        for (const copy of copies) {
            if (!hashes.has(copy.hash)) hashes.set(copy.hash, [])
            hashes.get(copy.hash).push(copy.app)
        }
        result.push({path: relative, copies, hashes})
    }
    return result.sort((a, b) => b.copies.length - a.copies.length || a.path.localeCompare(b.path))
}

// Грубая мера расхождения: строки, встречающиеся не во всех вариантах.
function differingLines(copies) {
    const sets = copies.map(copy => new Set(copy.lines.map(line => line.trim()).filter(Boolean)))
    const union = new Set(sets.flatMap(set => [...set]))
    let differing = 0
    for (const line of union) {
        if (!sets.every(set => set.has(line))) differing++
    }
    return differing
}

export function classify(group) {
    if (group.hashes.size == 1) return 'идентичны'
    const differing = differingLines(group.copies)
    return differing <= 10 ? 'случайное расхождение (' + differing + ' строк)' : 'по делу (' + differing + ' строк)'
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
    const sections = {'идентичны': [], 'случайное': [], 'по делу': []}
    for (const group of groups()) {
        const kind = classify(group)
        const key = kind.startsWith('идентичны') ? 'идентичны' : kind.startsWith('случайное') ? 'случайное' : 'по делу'
        const variants = [...group.hashes].map(([hash, apps]) => hash + ': ' + apps.join(' ')).join(' | ')
        sections[key].push({path: group.path, count: group.copies.length, kind, variants})
    }
    for (const [name, rows] of Object.entries(sections)) {
        console.log('== ' + name + ' (' + rows.length + ') ==')
        for (const row of rows) console.log('  ' + row.path + '  ×' + row.count + '  ' + row.kind + '\n      ' + row.variants)
    }
}
