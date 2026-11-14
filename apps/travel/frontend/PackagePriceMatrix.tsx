import {useEffect, useEffectEvent, useMemo, useState, type CSSProperties, type KeyboardEvent} from 'react'
import type {PackageMatrixCell} from '../src/package-matrix-contract.ts'
import {packageMatrixStatuses} from '../src/package-matrix-contract.ts'
import {dateLabel} from './presentation.ts'
import {type PackagePreferences} from './package-preferences.ts'
import {matrixCellKey, matrixDates, matrixPageDates, matrixRangeNights, matrixVisibleRows, type MatrixViewContext} from './package-matrix.ts'
import {usePackageMatrix} from './package-matrix-query.ts'
import './package-matrix.css'

const money = new Intl.NumberFormat('ru-RU', {style: 'currency', currency: 'EUR', maximumFractionDigits: 2})
const date = new Intl.DateTimeFormat('ru-RU', {day: 'numeric', month: 'short', timeZone: 'UTC'})
const week = new Intl.DateTimeFormat('ru-RU', {weekday: 'short', timeZone: 'UTC'})
const price = (total: number) => money.format(total / 100)

function description(cell: PackageMatrixCell | undefined, pending: boolean, failed: boolean) {
    if (!cell && pending) return 'Ожидает проверки'
    if (!cell) return failed ? 'Не удалось проверить' : 'Не подтверждено'
    if (cell.status == 'in-budget' && cell.inBudget) return price(cell.inBudget.total) + ' за всю группу'
    if (cell.status == 'outside-budget' && cell.lowest) return 'От ' + price(cell.lowest.total) + ' · вне бюджета'
    if (cell.status == 'unknown' && cell.lowest) return 'Получено от ' + price(cell.lowest.total) + ' · тариф в бюджете не подтверждён'
    if (pending && cell.status == 'unknown') return 'Проверяем цену'
    return packageMatrixStatuses[cell.status]
}

function cellAmount(cell: PackageMatrixCell | undefined, status: string) {
    const fare = cell?.inBudget ?? cell?.lowest
    if (fare) return price(fare.total)
    if (status == 'failed') return '!'
    if (status == 'empty') return '—'
    return '· · ·'
}

function cellLabel(cell: PackageMatrixCell | undefined, status: string, selected: boolean) {
    if (status == 'waiting') return 'обновляем'
    if (selected) return 'Выбрано'
    if (status == 'unknown' && cell?.lowest) return 'неполный ответ'
    const labels = {
        'in-budget': 'за группу', 'outside-budget': 'вне бюджета', loading: 'проверяем',
        unknown: 'нет данных', empty: 'туров нет', failed: 'ошибка',
    } satisfies Record<string, string>
    return labels[status as keyof typeof labels]
}

function keyboardCell(event: KeyboardEvent<HTMLButtonElement>, row: number, column: number) {
    const movement = {ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0]} as const
    if (!Object.hasOwn(movement, event.key)) return
    event.preventDefault()
    const [deltaRow, deltaColumn] = movement[event.key as keyof typeof movement]
    const table = event.currentTarget.closest('table')
    const target = table?.querySelector<HTMLButtonElement>('[data-cell="' + (row + deltaRow) + '/' + (column + deltaColumn) + '"]')
    target?.focus({preventScroll: false})
}

export function PackagePriceMatrix({prefs, selectedFareId, onSelect, onSnapshot, view, onView}: {
    prefs: PackagePreferences, selectedFareId: string | undefined, onSelect: (cell: PackageMatrixCell) => void,
    onSnapshot: (cells: PackageMatrixCell[], failedCellKeys: string[]) => void,
    view: MatrixViewContext, onView: (patch: Partial<MatrixViewContext>) => void,
}) {
    const allDates = useMemo(() => matrixDates(prefs.firstDeparture, prefs.lastDeparture), [prefs.firstDeparture, prefs.lastDeparture])
    const durations = matrixRangeNights(view.firstNights, view.lastNights)
    const rowOffset = Math.min(view.durationOffset, Math.max(0, durations.length - matrixVisibleRows))
    const nights = durations.slice(rowOffset, rowOffset + matrixVisibleRows)
    const visibleOffset = Math.min(view.dateOffset, Math.max(0, allDates.length - matrixPageDates))
    const departures = allDates.slice(visibleOffset, visibleOffset + matrixPageDates)
    const query = usePackageMatrix(prefs, departures, nights, true)
    const snapshot = useEffectEvent(onSnapshot)
    useEffect(() => { snapshot(query.cells, query.failedCellKeys) }, [query.cells, query.failedCellKeys])
    const cells = new Map(query.cells.map(cell => [matrixCellKey(cell.departure, cell.nights), cell]))
    const [inspected, setInspected] = useState<string | null>(null)
    const inspectedCell = inspected ? cells.get(inspected) : undefined
    const observed = query.cells.flatMap(cell => cell.inBudget ? [cell.inBudget.total] : [])
    const low = Math.min(...observed)
    const high = Math.max(...observed)
    const checked = query.cells.length
    const total = departures.length * nights.length
    const hasRetryable = query.failed.length > 0 || query.cells.some(cell => cell.status == 'failed' || cell.status == 'unknown')
    function changeNights(first: number, last: number) {
        onView({firstNights: first, lastNights: last, durationOffset: 0})
        setInspected(null)
    }
    return <section className="package-matrix" aria-label="Матрица цен по датам выезда и дням поездки" aria-busy={query.loading}>
        <div className="package-matrix__controls">
            <div className="package-matrix__durations" aria-label="Длительность для сравнения">
                <label>
                    <span>Дни поездки от</span>
                    <select value={durations[0]} aria-label="Дни поездки от"
                        onChange={event => changeNights(Number(event.target.value), Math.max(Number(event.target.value), durations.at(-1)!))}>
                        {Array.from({length: 30}, (_, item) => item + 1).map(value => <option key={value} value={value}>
                            {value + 1} дн. / {value} ноч.</option>)}
                    </select>
                </label>
                <label>
                    <span>Дни поездки до</span>
                    <select value={durations.at(-1)} aria-label="Дни поездки до"
                        onChange={event => changeNights(Math.min(Number(event.target.value), durations[0]), Number(event.target.value))}>
                        {Array.from({length: 30}, (_, item) => item + 1).map(value => <option key={value} value={value}>
                            {value + 1} дн. / {value} ноч.</option>)}
                    </select>
                </label>
            </div>
            <button type="button" className="package-matrix__weekly" onClick={() => changeNights(7, 14)}>От недели до двух</button>
        </div>
        {durations.length > matrixVisibleRows && <div className="package-matrix__row-nav">
            <span>Длительность · {nights[0] + 1}–{nights.at(-1)! + 1} дней из диапазона {durations[0] + 1}–{durations.at(-1)! + 1}</span>
            <div>
                <button type="button" aria-label="Меньшая длительность поездки" disabled={rowOffset == 0}
                    onClick={() => onView({durationOffset: Math.max(0, rowOffset - matrixVisibleRows)})}>↑</button>
                <button type="button" aria-label="Большая длительность поездки" disabled={rowOffset + matrixVisibleRows >= durations.length}
                    onClick={() => onView({durationOffset: rowOffset + matrixVisibleRows})}>↓</button>
            </div>
        </div>}
        <div className="package-matrix__date-nav">
            <span><strong>Даты выезда →</strong> {departures.length > 0 && dateLabel(departures[0]) + ' — ' + dateLabel(departures.at(-1)!)}</span>
            {allDates.length > matrixPageDates && <div>
                <button type="button" aria-label="Предыдущие даты выезда" disabled={visibleOffset == 0}
                    onClick={() => onView({dateOffset: Math.max(0, visibleOffset - matrixPageDates)})}>←</button>
                <button type="button" aria-label="Следующие даты выезда" disabled={visibleOffset + matrixPageDates >= allDates.length}
                    onClick={() => onView({dateOffset: visibleOffset + matrixPageDates})}>→</button>
            </div>}
        </div>
        <div className="package-matrix__scroll" tabIndex={0} aria-label="Таблица цен, можно прокручивать по горизонтали">
            <table className="package-matrix__table">
                <caption className="sr-only">Даты выезда по горизонтали, количество дней поездки по вертикали. Цена в евро за всю группу.</caption>
                <thead><tr><th scope="col">Дни<br/>поездки ↓</th>{departures.map(departure => {
                    const day = new Date(departure + 'T00:00:00Z')
                    return <th key={departure} scope="col"><strong>{date.format(day)}</strong><span>{week.format(day)}</span></th>
                })}</tr></thead>
                <tbody>{nights.map((night, row) => <tr key={row}>
                    <th scope="row"><strong>{night + 1} дней</strong><span>{night} ночей</span></th>
                    {departures.map((departure, column) => {
                        const key = matrixCellKey(departure, night)
                        const cell = cells.get(key)
                        const stale = query.staleCellKeys.includes(key)
                        const failed = query.failedCellKeys.includes(key)
                        const selected = Boolean(cell?.inBudget && cell.inBudget.id == selectedFareId)
                        let status: string = cell?.status ?? (query.loading ? 'loading' : 'failed')
                        if (stale) status = 'waiting'
                        if (failed) status = 'failed'
                        const heat = cell?.inBudget ? (cell.inBudget.total - low) / Math.max(1, high - low) : undefined
                        const label = stale ? 'Последняя полученная цена. Ожидаем обновления' : description(cell, query.loading, failed)
                        return <td key={departure}>
                            <button type="button" className="package-matrix__cell" data-status={status} data-cell={row + '/' + column}
                                style={{'--heat': heat == null ? undefined : String(heat * 100) + '%'} as CSSProperties}
                                aria-label={dateLabel(departure) + ', ' + (night + 1) + ' дней, ' + night + ' ночей. ' + label}
                                aria-pressed={cell?.inBudget ? selected : undefined} aria-disabled={!cell?.inBudget || stale}
                                onKeyDown={event => keyboardCell(event, row, column)}
                                onFocus={() => setInspected(key)} onMouseEnter={() => setInspected(key)}
                                onClick={() => {
                                    setInspected(key)
                                    if (cell?.inBudget && !stale) onSelect(cell)
                                }}>
                                <strong>{cellAmount(cell, status)}</strong>
                                <small>{cellLabel(cell, status, selected)}</small>
                            </button>
                        </td>
                    })}
                </tr>)}</tbody>
            </table>
        </div>
        <div className="package-matrix__legend">
            {observed.length > 0 ? <span className="package-matrix__scale"><span>{price(low)}</span><i/><span>{price(high)}</span></span>
                : <span>Цвет появится у полученных цен в бюджете.</span>}
            <span>EUR · за {prefs.adults} взрослых</span>
        </div>
        <p className="package-matrix__progress" role="status">{query.loading ? 'Проверяем цены · ' : 'Проверено ячеек · '}{checked} / {total}
            {!query.loading && hasRetryable && <button type="button" onClick={query.retry}>Повторить неподтверждённые</button>}
            {!query.loading && <button type="button" onClick={query.refresh}>Обновить цены</button>}</p>
        {query.waitingUntil && <p className="package-matrix__waiting" role="status">
            Ожидаем обновления до {new Date(query.waitingUntil).toLocaleTimeString('ru-RU')}. Проверка продолжится автоматически.
            {observed.length > 0 && ' Показаны последние полученные цены.'}
        </p>}
        {inspectedCell && <div className="package-matrix__inspected" aria-live="polite">
            <strong>{dateLabel(inspectedCell.departure)} · {inspectedCell.days} дней / {inspectedCell.nights} ночей</strong>
            <span>{description(inspectedCell, false, false)}</span>
            {inspectedCell.inBudget?.room && <span>{inspectedCell.inBudget.room}{inspectedCell.inBudget.board && ' · ' + inspectedCell.inBudget.board}</span>}
            {inspectedCell.checkedAt && <time dateTime={inspectedCell.checkedAt}>
                Проверено {new Date(inspectedCell.checkedAt).toLocaleString('ru-RU')}</time>}
        </div>}
        <p className="package-matrix__note">Дни считаем как ночи проживания + день выезда. Время обратного перелёта уточняется у оператора.</p>
    </section>
}
