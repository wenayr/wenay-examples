export type ParsedTable = {headers: string[], rows: string[][]}

export function validateTable(table: ParsedTable) {
    const headers = Array.isArray(table.headers) ? table.headers : []
    const badHeader = headers.some(function malformed(value) {
        return typeof value != 'string' || !value.trim() || value.length > 120
    })
    if (!headers.length || headers.length > 20 || badHeader) {
        throw new Error('От 1 до 20 заголовков длиной до 120 символов')
    }
    if (new Set(table.headers).size != table.headers.length) throw new Error('Заголовки должны быть уникальными')
    const badRow = (row: unknown[]) => row.some(function cell(value) {
        return typeof value != 'string' || value.length > 1000
    })
    const malformedRows = !Array.isArray(table.rows) || table.rows.some(function row(value) {
        return !Array.isArray(value) || value.length != table.headers.length || badRow(value)
    })
    if (malformedRows || table.rows.length > 200) {
        throw new Error('До 200 строк, ячейки до 1000 символов, число колонок должно совпадать')
    }
    if (Buffer.byteLength(JSON.stringify(table)) > 512 * 1024) throw new Error('Извлечённая таблица превышает 512 КиБ')
    return {headers: [...table.headers], rows: table.rows.map(row => [...row])}
}

export function parseCsv(source: string): ParsedTable {
    const rows: string[][] = []
    let row: string[] = [], cell = '', quoted = false, closed = false
    const text = source.replace(/^\uFEFF/, '')
    function pushCell() {
        row.push(cell)
        cell = ''
        closed = false
    }
    function pushRow() {
        pushCell()
        if (row.some(value => value.length)) rows.push(row)
        row = []
        if (rows.length > 201) throw new Error('В CSV допускается до 200 строк данных')
    }
    for (let index = 0; index < text.length; index++) {
        const value = text[index]
        if (quoted) {
            if (value == '"') {
                if (text[index + 1] == '"') {
                    cell += '"'
                    index++
                }
                else {
                    quoted = false
                    closed = true
                }
            } else cell += value
        } else if (value == ',') pushCell()
        else if (value == '\n' || value == '\r') {
            pushRow()
            if (value == '\r' && text[index + 1] == '\n') index++
        }
        else if (value == '"' && !cell && !closed) quoted = true
        else {
            if (value == '"' || closed) throw new Error('Некорректные кавычки в CSV')
            cell += value
        }
        if (cell.length > 1000 || row.length > 20) throw new Error('Ячейка до 1000 символов, до 20 колонок')
    }
    if (quoted) throw new Error('Незакрытые кавычки в CSV')
    if (cell || row.length || closed) pushRow()
    const headers = rows.shift() ?? []
    return validateTable({headers, rows})
}

export function parseText(name: string, bytes: Uint8Array) {
    const text = new TextDecoder('utf-8', {fatal: true}).decode(bytes)
    if (/\.csv$/i.test(name)) return parseCsv(text)
    if (/\.txt$/i.test(name)) return validateTable({
        headers: ['Строка', 'Текст'],
        rows: text.split(/\r?\n/).filter(Boolean).map((value, index) => [String(index + 1), value])
    })
    throw new Error('Этот обработчик принимает CSV и UTF-8 TXT')
}


