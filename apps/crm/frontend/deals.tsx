import {Overlay} from 'wenay-react2/ui'
import React, {lazy, useEffect, useMemo, useRef, useState} from 'react'
import {useClientStore, useOwnedClient, useReorderBoard} from 'wenay-react2/react'
import type {CrmWorkspace} from '../backend/domain'
import type {tStage} from '../backend/model'
import {useServiceAction} from '../shared/react/service-action'
import {DeferredPanel} from '../shared/react/deferred-panel'
import {DealPanel, DealForm} from './detail'
import {
    stages, money, date, download,
    type Commands, type Resources, type Organization, type DealRow
} from './contracts'

type DealsProps = {
    value: CrmWorkspace,
    org: Organization,
    commands: Commands,
    resources: Resources,
    busy: boolean
}

const DealTable = lazy(() => import('./deal-table').then(module => ({default: module.DealTable})))

const closedStages = ['won', 'lost']

export function Deals({value, org, commands, resources, busy}: DealsProps) {
    const owned = useOwnedClient({
        key: resources,
        create: () => ({...resources.open('crm'), ready: Promise.resolve()})
    })
    const status = useClientStore(useMemo(() => owned.client ? {store: owned.client.status} : null, [owned.client]))
    const remote = status.state?.phase == 'ready' ? owned.client?.current()?.remote : null
    const action = useServiceAction(remote)

    const [mode, setMode] = useState('board')
    const [query, setQuery] = useState('')
    const [stage, setStage] = useState('all')
    const [archived, setArchived] = useState(false)
    const [selected, setSelected] = useState('')
    const [creating, setCreating] = useState(false)
    const [checked, setChecked] = useState<string[]>([])

    const current = useRef({remote, orgId: org.id})
    current.current = {remote, orgId: org.id}
    useEffect(() => () => {current.current = {remote: null, orgId: ''}}, [])

    const staff = org.role != 'customer'
    const manager = org.role == 'owner' || org.role == 'lead'
    const all = value.deals.filter(item => item.orgId == org.id)
    const needle = query.toLocaleLowerCase()

    function matching(item: DealRow) {
        if (item.archived != archived) return false
        if (stage != 'all' && item.stage != stage) return false
        const company = value.companies.find(value => value.id == item.companyId)?.name ?? ''
        const text = item.title + ' ' + item.description + ' ' + company
        return text.toLocaleLowerCase().includes(needle)
    }

    const rows = all.filter(matching)
    const selectedRow = all.find(item => item.id == selected)
    const people = value.people.filter(item => item.orgId == org.id && item.role != 'customer')
    const live = all.filter(item => !item.archived && !closedStages.includes(item.stage))

    async function exportData(format: 'csv' | 'json') {
        const active = current.current
        await action.action(async function exportScope() {
            if (!active.remote) throw new Error('Соединение ещё не готово')
            const file = await active.remote.control.export({orgId: active.orgId, format})
            const same = current.current.remote == active.remote && current.current.orgId == active.orgId
            if (same) download(file)
        })
    }
    function assign(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault()
        const assignee = String(new FormData(event.currentTarget).get('assignee'))
        const items = rows.filter(item => checked.includes(item.id)).map(({id, revision}) => ({id, revision}))
        void commands.run('batchAssign', {orgId: org.id, items, assignee})
    }

    const metrics = <div className="metrics">
        <div>
            <span>Открытые сделки</span>
            <strong>{live.length}</strong>
            <small>в вашей организации</small>
        </div>
        <div>
            <span>В работе</span>
            <strong>{money(live.reduce((sum, item) => sum + item.amount, 0))}</strong>
            <small>условная стоимость проектов</small>
        </div>
        <div>
            <span>Предложения</span>
            <strong>{all.filter(item => !item.archived && item.stage == 'proposal').length}</strong>
            <small>на пути к согласованию</small>
        </div>
        <div>
            <span>Договорились</span>
            <strong>{all.filter(item => !item.archived && item.proposalDecision == 'accept').length}</strong>
            <small>предложений принято</small>
        </div>
    </div>

    const toolbar = <div className="toolbar">
        <div className="segmented">
            <button aria-pressed={mode == 'board'} onClick={() => setMode('board')}>▦ Воронка</button>
            <button aria-pressed={mode == 'table'} onClick={() => setMode('table')}>☷ Таблица</button>
        </div>
        <input
            aria-label="Поиск сделок"
            placeholder="Найти сделку или компанию…"
            value={query}
            onChange={event => setQuery(event.target.value)}
        />
        <select aria-label="Этап сделки" value={stage} onChange={event => setStage(event.target.value)}>
            <option value="all">Все этапы</option>
            {Object.entries(stages).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
        <label className="inline">
            <input
                type="checkbox"
                checked={archived}
                onChange={event => setArchived(event.target.checked)}
            />
            Архив
        </label>
        {staff && <>
            <button disabled={!remote || action.busy} onClick={() => void exportData('csv')}>CSV ↓</button>
            <button disabled={!remote || action.busy} onClick={() => void exportData('json')}>JSON ↓</button>
        </>}
    </div>

    const batch = <form className="batch" onSubmit={assign}>
        <span>Выбрано: {rows.filter(item => checked.includes(item.id)).length}</span>
        <select name="assignee" aria-label="Назначить выбранные сделки">
            {people.map(item => <option key={item.account} value={item.account}>{item.name}</option>)}
        </select>
        <button disabled={busy || !rows.some(item => checked.includes(item.id)) || archived}>
            Назначить
        </button>
    </form>

    return <>
        <div className="page-title">
            <div>
                <p className="eyebrow">
                    {staff ? 'ОТ КОНТАКТА К ДОГОВОРЁННОСТИ' : 'ВАШИ ПРОЕКТЫ И ПРЕДЛОЖЕНИЯ'}
                </p>
                <h1>{staff ? 'Следующий шаг — ближе.' : 'Давайте договоримся.'}</h1>
                <p>
                    {staff
                        ? 'Каждая сделка на своём месте. Каждое обещание в контексте.'
                        : 'Проверяйте предложения и обсуждайте детали с командой.'}
                </p>
            </div>
            {staff && (
                <button className="primary" disabled={busy} onClick={() => setCreating(true)}>
                    + Новая сделка
                </button>
            )}
        </div>
        {metrics}
        {toolbar}
        {action.error && <p className="error-inline" role="alert">{action.error}</p>}
        {manager && mode == 'table' && batch}
        {mode == 'board' && !archived ? <Funnel
            value={value}
            org={org}
            rows={rows}
            commands={commands}
            busy={busy}
            onOpen={setSelected}
        /> : <DeferredPanel className="deal-grid" loadingLabel="Загружаем таблицу сделок…">
            <DealTable
                rows={rows}
                companies={value.companies}
                checked={checked}
                onChecked={setChecked}
                select={manager && !archived}
                onOpen={setSelected}
            />
        </DeferredPanel>}
        {!rows.length && <div className="empty">
            <span>◎</span>
            <h2>Здесь есть место для новых возможностей</h2>
            <p>Измените фильтр или добавьте первую сделку.</p>
        </div>}
        {creating && <Overlay
            scrimClassName="modal-backdrop"
            outsideClassName="modal"
            ariaLabel="Новая сделка"
            onEscape={() => setCreating(false)}
        >
            <DealForm
                value={value}
                org={org}
                commands={commands}
                busy={busy}
                onClose={() => setCreating(false)}
            />
        </Overlay>}
        {selectedRow && <DealPanel
            key={selectedRow.id + ':' + org.role}
            row={selectedRow}
            value={value}
            org={org}
            remote={remote ?? null}
            resources={resources}
            commands={commands}
            busy={busy}
            close={() => setSelected('')}
        />}
    </>
}

type FunnelProps = {
    value: CrmWorkspace,
    org: Organization,
    rows: DealRow[],
    commands: Commands,
    busy: boolean,
    onOpen: (id: string) => void
}

function Funnel({value, org, rows, commands, busy, onOpen}: FunnelProps) {
    const byId = Object.fromEntries(rows.map(item => [item.id, item]))
    const stored = value.columns.find(item => item.orgId == org.id)?.stages ?? []
    const columns = stored.map(item => ({...item, items: item.items.filter(id => !!byId[id])}))
    const grab = useRef<{id: string, revision: number} | null>(null)

    // Менеджер переносит только свои сделки, клиент — только читает.
    function canDrag(id: string) {
        if (busy || org.role == 'customer') return false
        return org.role != 'manager' || byId[id]?.assignee == value.me?.account
    }

    const board = useReorderBoard({
        columns,
        canDrag,
        onDragStart({key}) {grab.current = {id: key, revision: byId[key].revision}},
        commit(next) {
            const item = grab.current
            if (!item) return
            const column = next.find(part => part.items.includes(item.id))
            if (!column) return
            const at = column.items.indexOf(item.id)
            void commands.run('dealMove', {
                orgId: org.id,
                ...item,
                stage: column.key as tStage,
                beforeId: column.items[at + 1] ?? '',
                reason: ''
            })
        }
    })

    useEffect(function cancelStale() {
        const item = grab.current
        if (!board.dragKey || !item) return
        if (busy || byId[item.id]?.revision != item.revision) board.cancel()
    }, [busy, rows, board.dragKey])

    function proposalTag(item: DealRow) {
        if (item.proposalDecision == 'accept') return '✓ Принято'
        if (item.proposalDecision == 'changes') return 'Нужны изменения'
        return 'Предложение v' + item.proposalVersion
    }

    function card(id: string) {
        const item = byId[id]
        const drag = board.item(id)
        const company = value.companies.find(value => value.id == item.companyId)
        const assignee = value.people.find(person => person.account == item.assignee)
        return <article key={id} style={drag.style} className="deal-card">
            {org.role != 'customer' && (
                <button {...drag.handleProps} className="grip" aria-label={'Переместить ' + item.title}>
                    ⋮⋮
                </button>
            )}
            <span className="company-label">{company?.name ?? 'Ваш проект'}</span>
            <button className="deal-title" onClick={() => onOpen(id)}>{item.title}</button>
            <strong className="deal-amount">{money(item.amount)}</strong>
            {item.proposalVersion > 0 && (
                <span className={'proposal-tag ' + (item.proposalDecision ?? '')}>
                    {proposalTag(item)}
                </span>
            )}
            <footer>
                <span className="avatar small">{assignee?.name.slice(0, 1) ?? '?'}</span>
                <span>{assignee?.name.split(' · ')[0] ?? item.assignee}</span>
                <time>{date(item.updatedAt).split(',')[0]}</time>
            </footer>
        </article>
    }

    return <>
        <p className="drag-hint">
            {org.role == 'customer'
                ? 'Откройте карточку, чтобы посмотреть предложение.'
                : 'Переносите за ручку: мышь или пробел → стрелки → Enter.'
                    + ' Закрытие с причиной доступно в карточке.'}
        </p>
        <div className="funnel">
            {columns.map(column => (
                <section className={'stage ' + column.key} key={column.key}>
                    <header>
                        <i/>
                        <h2>{stages[column.key]}</h2>
                        <span>{column.items.length}</span>
                    </header>
                    <div className="stage-items" ref={board.columnRef(column.key)}>
                        {column.items.map(card)}
                    </div>
                </section>
            ))}
        </div>
        <p className="sr-only" aria-live="polite">
            {board.over ? 'Перенос: ' + stages[board.over.col as tStage] : ''}
        </p>
    </>
}
