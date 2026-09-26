import React, {useEffect, useMemo, useRef, useState} from 'react'
import {useClientStore, useOwnedClient} from 'wenay-react2/react'
import {useServiceAction} from '../shared/react/service-action'
import {formatDate, type Resources} from './contracts'

type Props = {resources: Resources, orgId: string, orgName: string}
declare const keyResources: Resources
type Resource = ReturnType<typeof keyResources.open<'productKeys'>>
type Current = NonNullable<ReturnType<Resource['current']>>
type Remote = Current['remote']
type Issue = Parameters<Remote['control']['issue']>[0]
type Issued = Awaited<ReturnType<Remote['control']['issue']>>
type Listed = Awaited<ReturnType<Remote['control']['list']>>

export function ProductKeys(props: Props) {
    const [open, setOpen] = useState(false)
    return <details className="document-keys" onToggle={event => setOpen(event.currentTarget.open)}>
        <summary>Машинные ключи · {props.orgName}</summary>
        {open && <OwnedKeys {...props}/>}
    </details>
}

function OwnedKeys({resources, orgId, orgName}: Props) {
    const owned = useOwnedClient({key: resources, create: () => ({...resources.open('productKeys'), ready: Promise.resolve()})})
    const status = useClientStore(useMemo(() => owned.client ? {store: owned.client.status} : null, [owned.client]))
    const current = status.state?.phase == 'ready' ? owned.client?.current() : null
    if (!current) return <p role="status">{status.state?.error?.message ?? 'Подключаем доступ к ключам…'}</p>
    return <KeysPanel key={current.generation} remote={current.remote} orgId={orgId} orgName={orgName}
        actual={() => owned.client?.current()?.remote == current.remote && owned.client.current()?.generation == current.generation}/>
}

function KeysPanel({remote, orgId, orgName, actual}: {
    remote: Remote, orgId: string, orgName: string, actual: () => boolean
}) {
    const action = useServiceAction(remote)
    const alive = useRef(true)
    const pending = useRef<Issue | null>(null)
    const [ticket, setTicket] = useState<Issue | null>(null)
    const [keys, setKeys] = useState<Listed | null>(null)
    const [issued, setIssued] = useState<Issued | null>(null)
    const [copied, setCopied] = useState(false)
    const [label, setLabel] = useState('')
    const [days, setDays] = useState(30)
    function active() {return alive.current && actual()}

    useEffect(function enterScope() {
        alive.current = true
        void refresh()
        return function leaveScope() {
            alive.current = false
            pending.current = null
        }
    }, [remote, orgId])

    async function load() {
        const list = await remote.control.list({orgId})
        if (!active()) return
        setKeys(list)
        setIssued(previous => {
            const key = list.find(item => item.id == previous?.id)
            return key && !key.revokedAt && key.expiresAt > Date.now() ? previous : null
        })
    }
    async function refresh() {await action.action(load)}

    async function issue(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault()
        if (action.busy || !active()) return
        const input = pending.current ?? Object.freeze({requestId: crypto.randomUUID(), orgId,
            label: label.trim(), days, scopes: ['documents:extract'] as Issue['scopes']})
        Object.freeze(input.scopes)
        pending.current = input
        setTicket(input)
        setIssued(null)
        setCopied(false)
        await action.action(async function issueKey() {
            const result = await remote.control.issue(input)
            if (!active()) return
            pending.current = null
            setTicket(null)
            setIssued(result)
            await load()
        })
    }
    async function revoke(id: string) {
        if (action.busy || !active()) return
        await action.action(async function revokeKey() {
            await remote.control.revoke({orgId, id})
            if (!active()) return
            if (issued?.id == id) setIssued(null)
            await load()
        })
    }
    async function copySecret() {
        if (!issued?.secret || action.busy || !active()) return
        const secret = issued.secret
        await action.action(async function copy() {
            await navigator.clipboard.writeText(secret)
            if (active()) setCopied(true)
        })
    }
    function cancelRetry() {
        pending.current = null
        setTicket(null)
        action.clearError()
    }
    function hideSecret() {
        setIssued(null)
        setCopied(false)
    }
    function keyState(key: Listed[number]) {
        if (key.revokedAt) return 'Отозван ' + formatDate(key.revokedAt)
        if (key.expiresAt <= Date.now()) return 'Срок истёк'
        return 'До ' + formatDate(key.expiresAt)
    }

    return <div className="document-keys-body">
        <p>Ключ разрешает только обработку документов организации «{orgName}». Проверка, утверждение и команда недоступны.</p>
        <form className="document-keys-form" onSubmit={issue}>
            <label>Название интеграции<input required maxLength={100} value={label} disabled={action.busy || !!ticket}
                onChange={event => setLabel(event.target.value)} placeholder="Например, учётная система"/></label>
            <label>Срок действия, дней<input type="number" required min={1} max={90} step={1} value={days}
                disabled={action.busy || !!ticket} onChange={event => setDays(Number(event.target.value))}/></label>
            <label>Право доступа<select disabled value="documents:extract"><option>documents:extract</option></select></label>
            <div className="row">
                <button className="primary" disabled={action.busy}>{ticket ? 'Повторить выпуск' : 'Выпустить ключ'}</button>
                {ticket && <button type="button" disabled={action.busy} onClick={cancelRetry}>Отменить повтор</button>}
            </div>
        </form>
        {action.error && <p className="document-alert" role="alert">{action.error}</p>}
        {ticket && !action.busy && <p className="notice">
            Результат выпуска не подтверждён. Повтор использует те же параметры и requestId, без создания второго ключа.
            После отмены сначала обновите список: ключ мог быть выпущен. Если секрет потерян, отзовите его и выпустите новый.
        </p>}
        {issued && <section className="document-key-secret" role="status">
            <h3>{issued.secret ? 'Сохраните секрет сейчас' : 'Ключ уже выпущен'}</h3>
            <label>Машинный аккаунт<input readOnly value={issued.account}/></label>
            {issued.secret ? <>
                <label>Секрет<input readOnly value={issued.secret} autoComplete="off" spellCheck={false}/></label>
                <p>Секрет показывается один раз. После закрытия раздела или смены доступа его нельзя восстановить.</p>
                <button disabled={action.busy} onClick={copySecret}>{copied ? 'Скопировано' : 'Скопировать секрет'}</button>
            </> : <p>Повтор не возвращает секрет. Если вы его не сохранили, отзовите ключ ниже и выпустите новый.</p>}
            <button onClick={hideSecret}>Скрыть данные ключа</button>
        </section>}
        <div className="row"><h3 className="grow">Ключи организации</h3>
            <button disabled={action.busy} onClick={refresh}>Обновить список</button></div>
        <p className="muted">Список читается с сервера при открытии, после изменения и по кнопке обновления.</p>
        {!keys && <p role="status">{action.error ? 'Список недоступен. Повторите обновление.' : 'Загружаем ключи…'}</p>}
        {keys?.length == 0 && <p>Ключей пока нет. Выпустите первый для вашей интеграции.</p>}
        <ul className="document-key-list">{keys?.map(key => <li key={key.id}>
            <div><strong>{key.label}</strong><small>{'product:' + key.id}</small>
                <small>{key.scopes.join(', ')} · {keyState(key)}</small></div>
            <button disabled={action.busy || !!key.revokedAt} onClick={() => void revoke(key.id)}>Отозвать</button>
        </li>)}</ul>
    </div>
}
