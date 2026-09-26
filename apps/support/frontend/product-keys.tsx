import React, {useEffect, useMemo, useRef, useState} from 'react'
import {useClientStore, useOwnedClient} from 'wenay-react2/react'
import {useServiceAction} from '../shared/react/service-action'
import {dateLabel, type CommandController, type SupportResources} from './contracts'

type Props = {resources: SupportResources, commands: CommandController, orgId: string, orgName: string, disabled: boolean}

export function ProductKeys({resources, commands, orgId, orgName, disabled}: Props) {
    const owned = useOwnedClient({
        key: resources,
        create: () => ({...resources.open('productKeys'), ready: Promise.resolve()})
    })
    const status = useClientStore(useMemo(() => owned.client ? {store: owned.client.status} : null, [owned.client]))
    const remote = status.state?.phase == 'ready' ? owned.client?.current()?.remote : null
    const action = useServiceAction(remote)
    type Remote = NonNullable<typeof remote>
    type Issue = Parameters<Remote['control']['issue']>[0]
    type Issued = Awaited<ReturnType<Remote['control']['issue']>>
    type Listed = Awaited<ReturnType<Remote['control']['list']>>
    const [keys, setKeys] = useState<Listed | null>(null)
    const [issued, setIssued] = useState<Issued | null>(null)
    const [copied, setCopied] = useState(false)
    const pending = useRef<Issue | null>(null)
    const guard = useRef({orgId, remote, mounted: true})
    guard.current.orgId = orgId
    guard.current.remote = remote
    const busy = disabled || action.busy || !remote

    function actual() {
        return guard.current.mounted && guard.current.orgId == orgId && guard.current.remote == remote
    }

    useEffect(function bindResource() {
        guard.current.mounted = true
        setKeys(null)
        setIssued(null)
        setCopied(false)
        if (remote) void refresh()
        return function release() {
            guard.current.mounted = false
        }
    }, [remote, orgId])

    useEffect(function clearPendingOnUnmount() {
        return function clearPending() {
            pending.current = null
        }
    }, [])

    async function load() {
        const value = await remote!.control.list({orgId})
        if (actual()) setKeys(value)
    }

    async function refresh() {
        await action.action(load)
    }

    async function issue(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault()
        if (busy) return
        const form = new FormData(event.currentTarget)
        const label = String(form.get('label')).trim()
        const days = Number(form.get('days'))
        const old = pending.current
        const same = !!old && old.orgId == orgId && old.label == label && old.days == days
        const input: Issue = old && same ? old : {requestId: crypto.randomUUID(), orgId, label, days, scopes: ['knowledge:search']}
        pending.current = input
        setIssued(null)
        setCopied(false)
        await action.action(async function createKey() {
            const value = await remote!.control.issue(input)
            if (!actual()) return
            pending.current = null
            setIssued(value)
            await load()
        })
    }

    async function revoke(id: string) {
        if (busy) return
        if (await commands.run('productKeyRevoke', {orgId, id})) {
            if (!actual()) return
            if (issued?.id == id) setIssued(null)
            await refresh()
        }
    }

    async function copySecret() {
        if (!issued?.secret) return
        await action.action(async function copy() {
            await navigator.clipboard.writeText(issued!.secret!)
            if (actual()) setCopied(true)
        })
    }

    function hideSecret() {
        setIssued(null)
        setCopied(false)
    }

    function keyState(key: Listed[number]) {
        if (key.revokedAt) return 'Отозван ' + dateLabel(key.revokedAt)
        if (key.expiresAt <= Date.now()) return 'Срок истёк'
        return 'Действует до ' + dateLabel(key.expiresAt)
    }

    return <section className="page-content product-keys">
        <div className="section-heading">
            <div>
                <p className="eyebrow">ДОСТУП ДЛЯ ИНТЕГРАЦИЙ</p>
                <h1>Машинные ключи</h1>
                <p>Поиск опубликованных знаний организации «{orgName}».</p>
            </div>
            <button disabled={busy} onClick={refresh}>Обновить список</button>
        </div>
        <form className="panel-form" onSubmit={issue}>
            <h2>Выпустить ключ</h2>
            <label>Название интеграции
                <input name="label" required maxLength={100} placeholder="Например, клиентский портал" disabled={busy}/>
            </label>
            <label>Срок действия, дней
                <input name="days" type="number" min={1} max={90} step={1} defaultValue={30} required disabled={busy}/>
            </label>
            <p className="muted">Право: knowledge:search. Ключ не открывает обращения и управление командой.</p>
            <button className="primary" disabled={busy}>{action.busy ? 'Выполняем…' : 'Выпустить ключ'}</button>
            {action.error && <p className="inline-warning" role="alert">{action.error}</p>}
            {action.error && pending.current && <p className="muted">
                Повтор с теми же названием и сроком использует тот же запрос выпуска.
                Если сервер уже создал ключ, секрет повторно не выдаётся.
            </p>}
        </form>
        {issued && <div className="product-key-result" role="status">
            <h2>{issued.secret ? 'Сохраните секрет сейчас' : 'Ключ уже выпущен'}</h2>
            <label>Машинный аккаунт<input readOnly value={issued.account}/></label>
            {issued.secret ? <>
                <label>Секрет<input readOnly value={issued.secret} autoComplete="off" spellCheck={false}/></label>
                <p className="muted">Секрет виден только сейчас. После закрытия раздела его нельзя получить снова.</p>
                <button disabled={busy} onClick={copySecret}>{copied ? 'Скопировано' : 'Скопировать секрет'}</button>
            </> : <p className="muted">
                Повторный запрос не возвращает секрет. Если вы его не сохранили, отзовите ключ и выпустите новый.
            </p>}
            <button onClick={hideSecret}>Закрыть данные ключа</button>
        </div>}
        <div className="table-wrap">
            <table>
                <caption>Ключи организации «{orgName}»</caption>
                <thead><tr><th>Интеграция</th><th>Доступ</th><th>Состояние</th><th>Действие</th></tr></thead>
                <tbody>{keys?.map(key => <tr key={key.id}>
                    <td><strong>{key.label}</strong><small className="product-key-account">{'product:' + key.id}</small></td>
                    <td>{key.scopes.join(', ')}</td>
                    <td>{keyState(key)}</td>
                    <td><button disabled={busy || !!key.revokedAt} onClick={() => void revoke(key.id)}>Отозвать</button></td>
                </tr>)}</tbody>
            </table>
            {!keys && <p className="muted" role="status">{remote ? 'Загружаем ключи…' : 'Подключаем доступ к ключам…'}</p>}
            {keys?.length == 0 && <p className="muted">Ключей пока нет. Выпустите первый для вашей интеграции.</p>}
        </div>
    </section>
}
