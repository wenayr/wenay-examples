import React, {useMemo, useRef, useState} from 'react'
import {useClientStore, useOwnedClient} from 'wenay-react2/react'
import type {MeteringWorkspace} from './contracts'
import {useServiceAction} from '../shared/react/service-action'
import {date, type Commands, type Resources} from './contracts'

type WebhooksProps = {
    value: MeteringWorkspace,
    org: MeteringWorkspace['organizations'][number],
    commands: Commands,
    resources: Resources,
    busy: boolean
}

const deliveryTitles = {
    pending: 'Ожидает',
    sending: 'Отправляется',
    delivered: 'Доставлено',
    failed: 'Не доставлено'
} as const

// Доставленное — успех, не доставленное — неопределённость, остальное ещё в работе.
function deliveryClass(status: keyof typeof deliveryTitles) {
    if (status == 'delivered') return 'committed'
    if (status == 'failed') return 'unknown'
    return 'reserved'
}

export function Webhooks({value, org, commands, resources, busy}: WebhooksProps) {
    const owner = org.role == 'owner'
    const owned = useOwnedClient({
        key: resources,
        enabled: owner,
        create: () => ({...resources.open('billing'), ready: Promise.resolve()})
    })
    const status = useClientStore(useMemo(() => owned.client ? {store: owned.client.status} : null, [owned.client]))
    const remote = status.state?.phase == 'ready' ? owned.client?.current()?.remote : null
    const action = useServiceAction(remote)
    const [secret, setSecret] = useState<{id: string, secret: string | null} | null>(null)
    const attempt = useRef<{url: string, id: string} | null>(null)
    const live = useRef(remote)
    live.current = remote
    const endpoints = value.webhooks.filter(endpoint => endpoint.orgId == org.id)
    const forOrg = value.deliveries.filter(delivery => delivery.orgId == org.id)
    const deliveries = forOrg.slice().reverse()
    const subscription = value.subscriptions.find(item => item.orgId == org.id)

    async function createEndpoint(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault()
        const url = String(new FormData(event.currentTarget).get('url')).trim()
        if (attempt.current?.url != url) attempt.current = {url, id: crypto.randomUUID()}
        const requestId = attempt.current.id
        const connection = remote
        setSecret(null)
        await action.action(async function create() {
            if (!connection) throw new Error('Подключение к интеграциям ещё не готово')
            const created = await connection.control.createEndpoint({requestId, orgId: org.id, url})
            if (live.current != connection) return
            setSecret(created)
            attempt.current = null
        })
    }

    const lostSecret = 'Повторный запрос не раскрывает секрет.'
        + ' При его потере отключите получателя и создайте нового.'

    const created = secret && <div className="endpoint-secret">
        <strong>{secret.secret ? 'Секрет показан один раз' : 'Получатель уже создан'}</strong>
        {secret.secret ? <label>Секрет подписи
            <input readOnly value={secret.secret} onFocus={event => event.currentTarget.select()}/>
        </label> : <p>{lostSecret}</p>}
        <button type="button" onClick={() => setSecret(null)}>Скрыть</button>
    </div>

    const form = <form className="panel endpoint-form" onSubmit={createEndpoint}>
        <div className="panel-heading">
            <div>
                <h2>Новый получатель</h2>
                <p>Сохраните секрет для проверки подписи на стороне получателя.</p>
            </div>
        </div>
        <label>URL обработчика
            <input
                type="url"
                name="url"
                placeholder="https://example.com/webhooks/usage"
                required
                maxLength={2000}
            />
        </label>
        <button className="primary" disabled={busy || action.busy || !remote}>
            {action.busy ? 'Создаём…' : 'Добавить получателя'}
        </button>
        {action.error && <p role="alert" className="inline-error">{action.error}</p>}
        {created}
    </form>

    const noEndpoints = <div className="empty">
        <span>↗</span>
        <h3>Получателей пока нет</h3>
        <p>
            {owner
                ? 'Добавьте разрешённый адрес, чтобы получать события.'
                : 'Настроить получателя может владелец организации.'}
        </p>
    </div>

    const endpointList = endpoints.map(endpoint => (
        <article key={endpoint.id}>
            <div>
                <strong>{endpoint.url}</strong>
                <small>{date(endpoint.createdAt)}</small>
            </div>
            <span className={'status ' + (endpoint.enabled ? 'committed' : 'released')}>
                {endpoint.enabled ? 'Включён' : 'Отключён'}
            </span>
            {owner && (
                <button
                    disabled={busy}
                    onClick={() => commands.run('webhookEnable', {
                        orgId: org.id,
                        id: endpoint.id,
                        enabled: !endpoint.enabled
                    })}
                >
                    {endpoint.enabled ? 'Отключить' : 'Включить'}
                </button>
            )}
        </article>
    ))

    const deliveryList = deliveries.map(delivery => (
        <details className="delivery" key={delivery.id}>
            <summary>
                <span>
                    <strong>{delivery.type}</strong>
                    <small>{delivery.id}</small>
                </span>
                <span className={'status ' + deliveryClass(delivery.status)}>
                    {deliveryTitles[delivery.status]}
                </span>
                <span>{delivery.attempts.length} попыток</span>
            </summary>
            <div className="delivery-detail">
                <p>
                    Получатель: {endpoints.find(item => item.id == delivery.endpointId)?.url
                        ?? delivery.endpointId}
                </p>
                {delivery.attempts.map(attempt => (
                    <div key={attempt.number}>
                        <strong>Попытка {attempt.number}</strong>
                        <time>{date(attempt.at)}</time>
                        <span>{attempt.httpStatus ? 'HTTP ' + attempt.httpStatus : 'Нет HTTP-ответа'}</span>
                        {attempt.error && <p>{attempt.error}</p>}
                    </div>
                ))}
                {owner && delivery.status == 'failed' && (
                    <button
                        disabled={busy}
                        onClick={() => commands.run('webhookRetry', {orgId: org.id, id: delivery.id})}
                    >
                        Повторить доставку
                    </button>
                )}
            </div>
        </details>
    ))

    const noDeliveries = <div className="empty">
        <h3>События ещё не отправлялись</h3>
        <p>Настройте получателя и выполните разрешённую операцию сервиса.</p>
    </div>

    return <>
        <div className="page-heading">
            <div>
                <p className="eyebrow">СОБЫТИЯ ДЛЯ ВАШИХ СЕРВИСОВ</p>
                <h1>Интеграции и webhooks</h1>
                <p>Подписанные уведомления, история попыток и явный повтор.</p>
            </div>
            <span className="soft-badge">Без реальных платежей</span>
        </div>
        <div className="notice">
            Адрес получателя должен быть разрешён оператором сервиса.
            Без настройки получателей уведомления никуда не отправляются.
        </div>
        {subscription && <section className="panel subscription-panel">
            <div>
                <p className="eyebrow">ТЕСТОВАЯ ПОДПИСКА</p>
                <h2>{subscription.plan == 'team' ? 'Команда' : 'Старт'}</h2>
                <p>
                    {subscription.status == 'active' ? 'Активна' : 'Отменена'} ·
                    версия {subscription.version}
                </p>
            </div>
            <small>
                Обновлено {date(subscription.updatedAt)}<br/>
                Состояние тестового провайдера, без списания денег.
            </small>
        </section>}
        <div className="webhook-layout">
            {owner && form}
            <section className="panel endpoint-list">
                <div className="panel-heading">
                    <div>
                        <h2>Получатели</h2>
                        <p>{endpoints.length} настроенных адресов</p>
                    </div>
                </div>
                {endpoints.length ? endpointList : noEndpoints}
            </section>
        </div>
        <section className="panel deliveries-panel">
            <div className="panel-heading">
                <div>
                    <h2>Доставка событий</h2>
                    <p>
                        Повторы используют существующее событие.
                        Получатель должен учитывать его идентификатор.
                    </p>
                </div>
                <span className="soft-badge">{deliveries.length} доставок</span>
            </div>
            {deliveries.length ? deliveryList : noDeliveries}
        </section>

    </>
}
