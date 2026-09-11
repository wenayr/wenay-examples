import React, {useMemo, useRef, useState} from 'react'
import {useOwnedClient, useClientStore} from 'wenay-react2/react'
import type {MeteringWorkspace} from '../backend/domain'
import {useServiceAction} from '../shared/react/service-action'
import {date, type Commands, type Resources, type KeyCredentials} from './contracts'

export function Keys({value, org, resources, commands, busy, onUse}: {value: MeteringWorkspace, org: MeteringWorkspace['organizations'][number], resources: Resources, commands: Commands, busy: boolean, onUse: (key: KeyCredentials) => void}) {
    const owner = org.role == 'owner'
    const resource = useOwnedClient({key: resources, enabled: owner, create: () => ({...resources.open('keys'), ready: Promise.resolve()})})
    const status = useClientStore(useMemo(() => resource.client ? {store: resource.client.status} : null, [resource.client]))
    const remote = status.state?.phase == 'ready' ? resource.client?.current()?.remote : null
    const action = useServiceAction(remote)
    const [creating, setCreating] = useState(false)
    const [created, setCreated] = useState<{id: string, account: string, secret: string | null, expiresAt: number} | null>(null)
    const attempt = useRef<{signature: string, id: string} | null>(null)
    const live = useRef({orgId: org.id, remote})
    live.current = {orgId: org.id, remote}
    const keys = value.keys.filter(key => key.orgId == org.id).slice().sort((a, b) => b.createdAt - a.createdAt)

    async function issue(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault()
        const form = new FormData(event.currentTarget)
        const scopes = form.getAll('scopes').map(String) as ('usage:read' | 'usage:write')[]
        const input = {orgId: org.id, label: String(form.get('label')), scopes, days: Number(form.get('days'))}
        const signature = JSON.stringify(input)
        if (attempt.current?.signature != signature) attempt.current = {signature, id: crypto.randomUUID()}
        const requestId = attempt.current.id
        const requestRemote = remote
        setCreated(null)
        await action.action(async function create() {
            if (!requestRemote) throw new Error('Подключение к выпуску ключей ещё не готово')
            const result = await requestRemote.control.issue({requestId, ...input})
            if (live.current.orgId != input.orgId || live.current.remote != requestRemote) return
            setCreated(result)
            setCreating(false)
            attempt.current = null
        })
    }

    return <><div className="page-heading"><div><p className="eyebrow">ТОЛЬКО НУЖНЫЕ ПРАВА</p><h1>Ключи доступа</h1><p>Отдельные ключи для интеграций. Понятные права и срок действия.</p></div>{owner && <button className="primary" disabled={busy || !remote} onClick={() => setCreating(!creating)}>{creating ? 'Закрыть форму' : '+ Создать ключ'}</button>}</div>
        {!owner && <p className="notice">Аудитор видит историю и параметры ключей. Создание и отзыв доступны владельцу.</p>}
        {(action.error || status.error || resource.error) && <p className="notice warning" role="alert">{action.error || 'Подключение к ключам недоступно. Повторите вход.'}</p>}
        {creating && owner && <form className="panel key-form" onSubmit={issue}><div className="panel-heading"><div><h2>Новый ключ</h2><p>Секрет будет показан только после создания.</p></div></div><label>Название<input name="label" required maxLength={100} placeholder="Например, обработка документов"/></label><fieldset><legend>Разрешения</legend><label className="check-label"><input type="checkbox" name="scopes" value="usage:read" defaultChecked/><span><strong>Чтение расхода</strong><small>Просмотр использования API своей организации</small></span></label><label className="check-label"><input type="checkbox" name="scopes" value="usage:write" defaultChecked/><span><strong>Учёт операций</strong><small>Запись, резерв, подтверждение и освобождение единиц</small></span></label></fieldset><label>Срок действия<select name="days" defaultValue="30"><option value="1">1 день</option><option value="7">7 дней</option><option value="30">30 дней</option><option value="90">90 дней</option></select></label><button className="primary" disabled={busy || action.busy || !remote}>{action.busy ? 'Создаём…' : 'Создать ключ'}</button></form>}
        {created && owner && <section className="secret-panel"><div className="panel-heading"><div><h2>{created.secret ? 'Сохраните секрет сейчас' : 'Этот ключ уже был создан'}</h2><p>{created.secret ? 'При следующем открытии секрет не будет доступен.' : 'Повторный запрос не раскрывает секрет. Если он потерян, отзовите ключ и создайте новый.'}</p></div><button onClick={() => setCreated(null)} aria-label="Скрыть созданный ключ">×</button></div><label>Аккаунт ключа<input readOnly value={created.account} onFocus={event => event.currentTarget.select()}/></label>{created.secret && <label>Секрет<input readOnly value={created.secret} autoComplete="off" spellCheck={false} onFocus={event => event.currentTarget.select()}/></label>}<div className="button-row"><small>Действует до {date(created.expiresAt)}</small>{created.secret && <button className="primary" onClick={function useCreated() {onUse({orgId: org.id, id: created.id, secret: created.secret!}); setCreated(null)}}>Проверить в API-клиенте →</button>}</div></section>}
        <section className="panel keys-panel"><div className="panel-heading"><div><h2>Ключи организации</h2><p>Секреты не хранятся в этом представлении.</p></div><span className="soft-badge">{keys.length} ключей</span></div>{keys.length ? <div className="table-scroll"><table><thead><tr><th>Название и аккаунт</th><th>Разрешения</th><th>Состояние</th><th>Действует до</th><th/></tr></thead><tbody>{keys.map(key => <tr key={key.id}><td><strong>{key.label}</strong><code>{'key:' + key.id}</code></td><td><div className="scope-tags">{key.scopes.map(scope => <span key={scope}>{scope == 'usage:read' ? 'Чтение' : 'Учёт'}</span>)}</div></td><td><span className={'status ' + (key.revokedAt ? 'released' : key.expiresAt <= Date.now() ? 'unknown' : 'committed')}>{key.revokedAt ? 'Отозван' : key.expiresAt <= Date.now() ? 'Истёк' : 'Активен'}</span></td><td>{date(key.expiresAt)}</td><td>{owner && !key.revokedAt && <button disabled={busy} onClick={() => commands.run('keyRevoke', {orgId: org.id, id: key.id})}>Отозвать</button>}</td></tr>)}</tbody></table></div> : <div className="empty"><span>⚿</span><h3>Доступ начинается с ключа</h3><p>Создайте первый ключ для чтения расхода и записи операций.</p></div>}</section><p className="footnote">Отзыв ключа проверяется при последующих командах, в том числе у уже подключённого клиента. Секреты не сохраняются в браузерное хранилище.</p>
    </>
}
