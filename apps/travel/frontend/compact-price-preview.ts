import type {PackageMatrixCell} from '../src/package-matrix-contract.ts'
import type {PackageTrendPoint} from '../src/package-trends-contract.ts'

export interface CompactPriceMatrix {
    departures: readonly string[]
    nights: readonly number[]
    cells: readonly PackageMatrixCell[]
    staleCellKeys?: readonly string[]
    pending?: boolean
}

export interface CompactPriceInput {
    trend?: readonly PackageTrendPoint[]
    nights?: number
    mode?: 'graph' | 'matrix'
    matrix?: CompactPriceMatrix
    now?: number
}

const price = new Intl.NumberFormat('ru-RU', {style: 'currency', currency: 'EUR', maximumFractionDigits: 0})
const date = new Intl.DateTimeFormat('ru-RU', {day: 'numeric', month: 'short', timeZone: 'UTC'})
const statusLabels = {
    quoted: 'за всю группу', unknown: 'не проверено', empty: 'тур не получен',
    failed: 'не удалось проверить', 'outside-budget': 'вне бюджета', stale: 'последняя цена, требует обновления',
} as const
type tCompactStatus = keyof typeof statusLabels

function shortDate(value: string) {
    const stamp = Date.parse(value + 'T00:00:00Z')
    return Number.isFinite(stamp) ? date.format(stamp) : value
}

function trendCell(point: PackageTrendPoint, nights: number) {
    const quoted = point.status == 'quoted' && point.total != null
    let status: tCompactStatus = 'empty'
    if (point.status == 'unknown') status = 'unknown'
    if (quoted) status = 'quoted'
    return {departure: point.departure, nights, total: quoted ? point.total : null, status, checkedAt: point.checkedAt, cached: false}
}

function matrixCell(departure: string, nights: number, matrix: CompactPriceMatrix, input: CompactPriceInput) {
    const cell = matrix.cells.find(item => item.departure == departure && item.nights == nights)
    const fare = cell?.inBudget ?? cell?.lowest
    let status: tCompactStatus = 'unknown'
    if (cell?.status == 'empty') status = 'empty'
    if (cell?.status == 'failed') status = 'failed'
    if (cell?.status == 'outside-budget') status = 'outside-budget'
    if (cell?.inBudget) status = 'quoted'
    const staleKey = departure + '/' + nights
    const expired = Boolean(cell?.source.stale || matrix.staleCellKeys?.includes(staleKey))
    if (expired) status = fare?.total != null ? 'stale' : 'unknown'
    if (expired && cell?.status == 'failed' && fare?.total == null) status = 'failed'
    const trend = nights == input.nights ? input.trend?.find(point => point.departure == departure && point.status == 'quoted') : null
    const trendTime = trend?.checkedAt ? Date.parse(trend.checkedAt) : NaN
    const cellTime = cell?.checkedAt ? Date.parse(cell.checkedAt) : NaN
    const realTrend = trend?.total != null && Number.isFinite(trendTime)
    const confirmedEmpty = cell?.status == 'empty' && cell.complete
    const newerEmpty = confirmedEmpty && (!Number.isFinite(cellTime) || cellTime >= trendTime)
    if (fare?.total == null && realTrend && !newerEmpty) {
        return {departure, nights, total: trend!.total, status: 'quoted' as const, checkedAt: trend!.checkedAt, cached: true}
    }
    return {departure, nights, total: fare?.total ?? null, status, checkedAt: cell?.checkedAt ?? fare?.checkedAt ?? null, cached: false}
}

export function compactPricePreview(input: CompactPriceInput) {
    const trend = input.trend ?? []
    const nights = input.nights ?? 0
    const matrix = input.mode == 'matrix' ? input.matrix : undefined
    const departures = matrix?.departures ?? trend.map(point => point.departure)
    const durations = matrix?.nights ?? [nights]
    const cells = matrix
        ? durations.flatMap(duration => departures.map(departure => matrixCell(departure, duration, matrix, input)))
        : trend.map(point => trendCell(point, nights))
    const amounts = cells.flatMap(cell => cell.total != null ? [cell.total] : [])
    const min = amounts.length ? Math.min(...amounts) : null
    const max = amounts.length ? Math.max(...amounts) : null
    const now = input.now ?? Date.now()
    const heat = cells.map(cell => {
        const checked = cell.checkedAt ? Date.parse(cell.checkedAt) : NaN
        const expired = cell.total != null && Number.isFinite(checked) && now - checked > 120_000
        const status: tCompactStatus = expired ? 'stale' : cell.status
        return {...cell, status, heat: cell.total == null ? null : (cell.total - min!) / Math.max(1, max! - min!)}
    })
    const mode = input.mode == 'matrix' ? 'matrix' : 'graph'
    const range = departures.length ? shortDate(departures[0]) + ' — ' + shortDate(departures.at(-1)!) : 'Даты ещё не проверены'
    let durationLabel = (nights + 1) + ' дней / ' + nights + ' ночей'
    if (durations.length > 1) {
        durationLabel = (durations[0] + 1) + '–' + (durations.at(-1)! + 1) + ' дней · ' + durations[0] + '–' + durations.at(-1) + ' ночей'
    }
    let label = (mode == 'matrix' ? 'Миниматрица' : 'График') + ' · ' + range
    if (nights) label += ' · ' + durationLabel
    if (min != null) label += ' · ' + price.format(min / 100) + (max != min ? ' — ' + price.format(max! / 100) : '')
    if (!amounts.length) label += ' · подтверждённых цен пока нет'
    if (mode == 'matrix' && cells.length) {
        const unconfirmed = heat.filter(cell => cell.status == 'unknown' || cell.status == 'failed').length
        label += ' · получено цен: ' + amounts.length + ' · не подтверждено: ' + unconfirmed
    }
    if (heat.some(cell => cell.cached)) label += ' · используются цены сохранённого графика'
    if (heat.some(cell => cell.status == 'stale')) label += ' · часть цен требует обновления'
    if (matrix?.pending) label += ' · обновляется'
    return {mode, departures, durations, cells: heat, min, max, label, pending: Boolean(matrix?.pending)}
}

const namespace = 'http://www.w3.org/2000/svg'

function svgNode(name: string, attributes: Record<string, string | number>) {
    const node = document.createElementNS(namespace, name)
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value))
    return node
}

function cellTitle(cell: ReturnType<typeof compactPricePreview>['cells'][number]) {
    let label = shortDate(cell.departure)
    if (cell.nights) label += ' · ' + cell.nights + ' ночей'
    if (cell.total != null) label += ' · ' + price.format(cell.total / 100)
    if (cell.cached) label += ' · из сохранённого графика'
    label += ' · ' + statusLabels[cell.status]
    if (cell.checkedAt) label += ' · проверено ' + new Date(cell.checkedAt).toLocaleString('ru-RU')
    return label
}

export function createCompactPricePreview(input: CompactPriceInput) {
    const model = compactPricePreview(input)
    const graph = svgNode('svg', {viewBox: '0 0 168 20', class: 'compact-price-preview', 'aria-hidden': 'true'})
    graph.setAttribute('data-price-preview', model.mode)
    graph.setAttribute('data-price-rows', String(model.durations.length))
    graph.setAttribute('data-price-columns', String(model.departures.length))
    const title = svgNode('title', {})
    title.textContent = model.label
    graph.append(title)
    if (!model.departures.length) {
        graph.append(svgNode('path', {d: 'M2 10H148', class: 'compact-price-preview__pending'}))
        return {graph, label: model.label}
    }
    if (model.mode == 'matrix') {
        const width = 168 / model.departures.length
        const height = 20 / Math.max(1, model.durations.length)
        const gap = Math.min(.45, width / 5, height / 5)
        model.cells.forEach((cell, index) => {
            const x = index % model.departures.length * width + gap / 2
            const y = Math.floor(index / model.departures.length) * height + gap / 2
            const rect = svgNode('rect', {x, y, width: width - gap, height: height - gap, rx: Math.min(.45, height / 5)})
            rect.setAttribute('data-status', cell.status)
            if (cell.heat != null) rect.setAttribute('fill', 'hsl(' + (154 - cell.heat * 111) + ' 48% ' + (45 + cell.heat * 18) + '%)')
            const tooltip = svgNode('title', {})
            tooltip.textContent = cellTitle(cell)
            rect.append(tooltip)
            graph.append(rect)
            if (cell.status == 'unknown') {
                const length = Math.min(width - gap, height - gap)
                const bottom = y + height - gap
                graph.append(svgNode('path', {d: 'M' + x + ' ' + bottom + 'l' + length + ' -' + length,
                    class: 'compact-price-preview__unknown'}))
            }
        })
    } else {
        graph.append(svgNode('path', {d: 'M2 18H166', class: 'compact-price-preview__baseline'}))
        let path = ''
        let connected = false
        model.cells.forEach((cell, index) => {
            const x = 3 + index / Math.max(1, model.cells.length - 1) * 162
            const tooltip = svgNode('title', {})
            tooltip.textContent = cellTitle(cell)
            if (cell.total == null) {
                connected = false
                const mark = svgNode('text', {x, y: 14, 'text-anchor': 'middle', class: 'compact-price-preview__gap'})
                mark.textContent = cell.status == 'unknown' ? '·' : '–'
                mark.append(tooltip)
                graph.append(mark)
                return
            }
            const y = model.max == model.min ? 10 : 16 - 12 * cell.heat!
            path += (connected ? ' L ' : ' M ') + x.toFixed(2) + ' ' + y.toFixed(2)
            connected = true
            const dot = svgNode('circle', {cx: x, cy: y, r: cell.total == model.min ? 2.7 : 1.9})
            dot.setAttribute('data-status', cell.status)
            dot.append(tooltip)
            graph.append(dot)
        })
        graph.insertBefore(svgNode('path', {d: path, class: 'compact-price-preview__line'}), graph.children[1] ?? null)
    }
    return {graph, label: model.label}
}
