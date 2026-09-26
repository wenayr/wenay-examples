import React, {useEffect, useState} from 'react'
import type {DocumentDetail, DocumentMetadata, ProcessorRemote} from './contracts'

type Comparison = Awaited<ReturnType<ProcessorRemote['control']['compare']>>

type ComparisonProps = {detail: DocumentDetail, document: DocumentMetadata, remote: ProcessorRemote}

export function VersionComparison({detail, document, remote}: ComparisonProps) {
    // Выбор относится к документу, а не к совпадающему номеру версии в другой карточке.
    return <ComparisonPanel key={JSON.stringify([document.orgId, document.id])} detail={detail} document={document} remote={remote}/>
}

function ComparisonPanel({detail, document, remote}: ComparisonProps) {
    const [revision, setRevision] = useState<number | null>(null)
    const last = detail.approvals.at(-1)?.revision ?? 0
    const earlier = detail.approvals.findLast(value => value.revision != document.revision)?.revision ?? last
    const currentApproved = detail.approvals.some(value => value.revision == document.revision)
    const preferred = currentApproved ? earlier : last
    const selected = detail.approvals.find(value => value.revision == revision)?.revision ?? preferred
    const [loaded, setLoaded] = useState<{key: string, remote: ProcessorRemote, value: Comparison} | null>(null)
    const [failed, setFailed] = useState<{key: string, remote: ProcessorRemote, message: string} | null>(null)
    const key = JSON.stringify([document.orgId, document.id, document.revision, selected])

    // Ответ приходит асинхронно: применяем его, только пока показан тот же документ и то же соединение.
    useEffect(function compare() {
        let active = true
        setFailed(null)
        if (!selected) return
        const request = remote.control.compare({
            orgId: document.orgId,
            id: document.id,
            revision: document.revision,
            approvedRevision: selected
        })
        void request.then(function ready(value) {
            if (active) setLoaded({key, remote, value})
        }, function failed(reason) {
            if (active) setFailed({key, remote, message: reason instanceof Error ? reason.message : 'Версия недоступна'})
        })
        return () => {active = false}
    }, [key, remote])

    const result = loaded?.key == key && loaded.remote == remote ? loaded.value : null
    const error = failed?.key == key && failed.remote == remote ? failed.message : ''
    if (!detail.approvals.length) {
        return <p className="empty">
            Сначала утвердите версию. После исправлений здесь появится сравнение с её неизменной копией.
        </p>
    }

    function cells(value: Comparison) {
        const rows = Math.max(value.previous.table.rows.length, value.current.table.rows.length)
        const columns = Math.max(value.previous.table.headers.length, value.current.table.headers.length)
        return Array.from({length: rows}, (_, row) => Array.from({length: columns}, function cell(_ignored, column) {
            const before = value.previous.table.rows[row]?.[column]
            const after = value.current.table.rows[row]?.[column]
            const headerBefore = value.previous.table.headers[column]
            const headerAfter = value.current.table.headers[column]
            const changed = before != after || headerBefore != headerAfter
            return <tr key={row + ':' + column} className={changed ? 'changed' : ''}>
                <th>{row + 1} · {headerAfter ?? headerBefore}</th>
                <td>{before ?? 'Нет ячейки'}</td>
                <td>
                    {after ?? 'Нет ячейки'}
                    {changed && <span className="diff-label">Изменено</span>}
                </td>
            </tr>
        }))
    }

    const unchanged = result && JSON.stringify(result.previous.table) == JSON.stringify(result.current.table)
    let emptyMessage = 'В таблице нет изменений по сравнению с выбранной утверждённой версией.'
    if (result?.previous.revision == result?.current.revision) {
        emptyMessage = 'Выбрана текущая утверждённая версия: таблица совпадает с её копией.'
        if (detail.approvals.length == 1) {
            emptyMessage = 'Это первая утверждённая версия. После исправлений здесь появится сравнение с её неизменной копией.'
        }
    }
    const table = result && <>
        <p>
            Слева — утверждённая v{result.previous.revision},
            справа — текущая v{result.current.revision}.
            {!unchanged && ' Подсвечены изменённые ячейки.'}
        </p>
        {unchanged ? <p className="empty" role="status">{emptyMessage}</p> : <div className="comparison-scroll">
            <table>
                <thead>
                    <tr>
                        <th>Строка / поле</th>
                        <th>Утверждено</th>
                        <th>Сейчас</th>
                    </tr>
                </thead>
                <tbody>{cells(result)}</tbody>
            </table>
        </div>}
    </>

    return <section className="version-comparison">
        <label>Сравнить с утверждённой версией
            <select value={selected} onChange={event => setRevision(Number(event.target.value))}>
                {detail.approvals.map(item => (
                    <option key={item.revision} value={item.revision}>
                        Версия {item.revision} · исходник {item.sourceVersion}
                    </option>
                ))}
            </select>
        </label>
        {error && <p className="inline-error" role="alert">{error}</p>}
        {table}
        {!result && !error && <p className="empty">Загружаем версии…</p>}
    </section>
}
