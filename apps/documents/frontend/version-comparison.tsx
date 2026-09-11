import React, {useEffect, useState} from 'react'
import type {DocumentDetail, DocumentMetadata, ProcessorRemote} from './contracts'

type Comparison = Awaited<ReturnType<ProcessorRemote['control']['compare']>>

type ComparisonProps = {detail: DocumentDetail, document: DocumentMetadata, remote: ProcessorRemote}

export function VersionComparison({detail, document, remote}: ComparisonProps) {
    const [revision, setRevision] = useState(detail.approvals.at(-1)?.revision ?? 0)
    const last = detail.approvals.at(-1)?.revision ?? 0
    const selected = detail.approvals.find(value => value.revision == revision)?.revision ?? last
    const [loaded, setLoaded] = useState<{key: string, remote: ProcessorRemote, value: Comparison} | null>(null)
    const [error, setError] = useState('')
    const key = [document.id, document.revision, selected].join(':')

    // Ответ приходит асинхронно: применяем его, только пока показан тот же документ и то же соединение.
    useEffect(function compare() {
        let active = true
        setError('')
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
            if (active) setError(reason instanceof Error ? reason.message : 'Версия недоступна')
        })
        return () => {active = false}
    }, [key, remote])

    const result = loaded?.key == key && loaded.remote == remote ? loaded.value : null
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

    const table = result && <>
        <p>
            Слева — утверждённая v{result.previous.revision},
            справа — текущая v{result.current.revision}. Подсвечены изменённые ячейки.
        </p>
        <div className="comparison-scroll">
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
        </div>
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
