import {validateTable, type ParsedTable} from './csv-table'

export type FieldOrigin = {row: number, column: number, page: number, line: number, quote: string}
export type ModelExtraction = {table: ParsedTable, fields: FieldOrigin[], provider: string, demo: boolean}
export type ExtractionProvider = {extract(input: {name: string, bytes: Uint8Array, sourceVersion: number, signal: AbortSignal}): Promise<ModelExtraction>}

export function validateExtraction(value: ModelExtraction) {
    const table = validateTable(value.table)
    if (typeof value.provider != 'string' || !value.provider.trim() || value.provider.length > 80 || typeof value.demo != 'boolean') throw new Error('Некорректный источник извлечения')
    if (!Array.isArray(value.fields) || value.fields.length != table.rows.length * table.headers.length) throw new Error('Каждое извлечённое поле требует источник')
    const seen = new Set<string>()
    const fields = value.fields.map(field => {
        if (!Number.isInteger(field.row) || field.row < 0 || field.row >= table.rows.length || !Number.isInteger(field.column) || field.column < 0 || field.column >= table.headers.length || !Number.isInteger(field.page) || field.page < 0 || field.page > 10 || !Number.isInteger(field.line) || field.line < 0 || field.line > 10000 || !field.page && !field.line || typeof field.quote != 'string' || !field.quote.trim() || field.quote.length > 1000) throw new Error('Некорректная ссылка на страницу/строку источника')
        const id = field.row + ':' + field.column
        if (seen.has(id)) throw new Error('Источник поля повторяется')
        seen.add(id)
        return {...field}
    })
    return {table, fields, provider: value.provider, demo: value.demo}
}

// Deliberate local fixture exercising the real extraction port. It is neither OCR nor an LLM.
export function createTestExtractionProvider(): ExtractionProvider {
    return {async extract(input) {
        input.signal.throwIfAborted()
        if (!/\.txt$/i.test(input.name)) throw new Error('Тестовый обработчик принимает TXT со строками Поле: значение')
        const rows: string[][] = [], fields: FieldOrigin[] = []
        const text = new TextDecoder('utf-8', {fatal: true}).decode(input.bytes)
        for (const [index, line] of text.split(/\r?\n/).entries()) {
            if (!line.trim()) continue
            const colon = line.indexOf(':')
            if (colon < 1 || line.length > 1000) throw new Error('Для теста нужны строки Поле: значение до 1000 символов')
            const row = rows.length
            rows.push([line.slice(0, colon).trim(), line.slice(colon + 1).trim()])
            fields.push(...[0, 1].map(column => ({row, column, page: 0, line: index + 1, quote: line})))
        }
        input.signal.throwIfAborted()
        return validateExtraction({table: {headers: ['Поле', 'Значение'], rows}, fields, provider: 'local-key-value-fixture', demo: true})
    }}
}
