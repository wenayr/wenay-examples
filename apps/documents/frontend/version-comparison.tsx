import React, {useEffect, useState} from 'react'
import type {DocumentDetail, DocumentMetadata, ProcessorRemote} from './contracts'

type Comparison = Awaited<ReturnType<ProcessorRemote['control']['compare']>>
export function VersionComparison({detail, document, remote}: {detail: DocumentDetail, document: DocumentMetadata, remote: ProcessorRemote}) {
    const [revision, setRevision] = useState(detail.approvals.at(-1)?.revision ?? 0)
    const selected = detail.approvals.find(value => value.revision == revision)?.revision ?? detail.approvals.at(-1)?.revision ?? 0
    const [loaded, setLoaded] = useState<{key: string, remote: ProcessorRemote, value: Comparison} | null>(null), [error, setError] = useState('')
    const key = [document.id, document.revision, selected].join(':')
    useEffect(function compare() {
        let active = true; setError('')
        if (selected) void remote.control.compare({orgId: document.orgId, id: document.id, revision: document.revision, approvedRevision: selected}).then(value => {if (active) setLoaded({key, remote, value})}, error => {if (active) setError(error instanceof Error ? error.message : 'Версия недоступна')})
        return () => {active = false}
    }, [key, remote])
    const result = loaded?.key == key && loaded.remote == remote ? loaded.value : null
    if (!detail.approvals.length) return <p className="empty">Сначала утвердите версию. После исправлений здесь появится сравнение с её неизменной копией.</p>
    return <section className="version-comparison"><label>Сравнить с утверждённой версией<select value={selected} onChange={event => setRevision(Number(event.target.value))}>{detail.approvals.map(item => <option key={item.revision} value={item.revision}>Версия {item.revision} · исходник {item.sourceVersion}</option>)}</select></label>{error && <p className="inline-error" role="alert">{error}</p>}{result ? <><p>Слева — утверждённая v{result.previous.revision}, справа — текущая v{result.current.revision}. Подсвечены изменённые ячейки.</p><div className="comparison-scroll"><table><thead><tr><th>Строка / поле</th><th>Утверждено</th><th>Сейчас</th></tr></thead><tbody>{Array.from({length: Math.max(result.previous.table.rows.length, result.current.table.rows.length)}, (_, row) => Array.from({length: Math.max(result.previous.table.headers.length, result.current.table.headers.length)}, (_, column) => {
        const before = result.previous.table.rows[row]?.[column], after = result.current.table.rows[row]?.[column]
        const changed = before != after || result.previous.table.headers[column] != result.current.table.headers[column]
        return <tr key={row + ':' + column} className={changed ? 'changed' : ''}><th>{row + 1} · {result.current.table.headers[column] ?? result.previous.table.headers[column]}</th><td>{before ?? 'Нет ячейки'}</td><td>{after ?? 'Нет ячейки'}{changed && <span className="diff-label">Изменено</span>}</td></tr>
    }))}</tbody></table></div></> : !error && <p className="empty">Загружаем версии…</p>}</section>
}
