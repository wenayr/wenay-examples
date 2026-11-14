import {useState} from 'react'
import type {ProviderAvailability, tProviderKind} from '../src/provider-contract.ts'
import {providerKinds} from '../src/provider-contract.ts'
import {safeHref} from './DirectoryCard.tsx'
import {directoryUrl, useDirectoryQuery} from './directory-query.ts'
import {providerKindNames, providerStatusNames} from './provider-client.ts'
import {providerTime} from './ProviderResults.tsx'
import {travelHash, type TravelRoute} from './navigation.ts'
import './providers.css'
import './agency.css'

const environmentNames = {production: 'Production', sandbox: 'Тестовая среда', both: 'Тестовая и production'} as const
const onboardingNames = {
    'self-service': 'Самостоятельная заявка', 'partner-contract': 'Партнёрский договор', paused: 'Приём заявок приостановлен', closed: 'Доступ закрыт',
} as const

function ProviderCard({item}: {item: ProviderAvailability}) {
    const [copied, setCopied] = useState(false)
    async function copyFields() {
        const fields = [...item.requiredEnv, ...(item.optionalEnv ?? [])].map(name => name + '=').join('\n')
        try {
            await navigator.clipboard.writeText(fields)
            setCopied(true)
        } catch {
            setCopied(false)
        }
    }
    const last = item.lastResult
    return <article className="provider-availability"><div className="provider-availability-head"><div>
        <h2>{item.name}</h2><p>{item.kinds.map(kind => providerKindNames[kind]).join(' · ')}</p></div>
        <span className={'provider-status provider-status-' + item.status}>
            {item.enabled ? providerStatusNames[item.status] : 'Отключён на сервере'}</span></div>
        <p>{item.description}</p>
        <dl className="provider-activation-facts"><div><dt>Доступ</dt><dd>{item.access == 'public' ? 'Публичный источник' : 'По условиям поставщика'}</dd></div>
            {item.environment && <div><dt>Среда</dt><dd>{environmentNames[item.environment]}</dd></div>}
            {item.onboarding && <div><dt>Подключение</dt><dd>{onboardingNames[item.onboarding]}</dd></div>}
            <div><dt>Конфигурация</dt><dd>{item.configured ? 'Обязательные параметры заданы' : 'Нужны параметры доступа'}</dd></div>
            <div><dt>Режим работы</dt><dd>{item.activeEnvironment == 'sandbox' ? 'Тестовая среда' : 'Production'}</dd></div>
        </dl>
        {last && <p className="provider-last-result">Последняя проверка · {providerStatusNames[last.status]}
            {last.checkedAt && ' · ' + providerTime(last.checkedAt)}{' · предложений ' + last.offerCount}. {last.description}</p>}
        <details><summary>Порядок подключения и параметры</summary><p>{item.activation}</p>
            {item.requiredEnv.length > 0 && <><h3>Обязательные серверные параметры</h3><ul className="provider-env-list">
                {item.requiredEnv.map(name => <li key={name}><code>{name}</code>
                    <span>{item.missingEnv.includes(name) ? 'Не задан' : 'Задан'}</span></li>)}</ul></>}
            {!!item.optionalEnv?.length && <p>Дополнительные параметры · {item.optionalEnv.map(name => <code key={name}>{name} </code>)}</p>}
            {item.requiredEnv.length > 0 && <button type="button" onClick={() => { void copyFields() }}>
                {copied ? 'Названия скопированы' : 'Скопировать названия переменных'}</button>}
            <p className="provider-field-list">Поля запроса · {item.queryFields.map(name => <code key={name}>{name} </code>)}</p>
        </details>
        <div className="provider-card-links"><a href={safeHref(item.website)} target="_blank" rel="noopener noreferrer">Сайт поставщика ↗</a>
            <a href={safeHref(item.docsUrl)} target="_blank" rel="noopener noreferrer">Документация ↗</a>
            <a href={travelHash(item.kinds.includes('deals') ? 'deals' : 'prices', undefined, {kind: item.kinds[0], providers: item.id})}>
                Перейти к поиску →</a></div>
    </article>
}

export function ProviderDashboard({route}: {route?: TravelRoute} = {}) {
    const providers = useDirectoryQuery<{
        items: ProviderAvailability[], summary: {total: number, public: number, configured: number, requiresAccess: number},
    }>(directoryUrl('providers'))
    const [phrase, setPhrase] = useState(route?.query.get('search') ?? '')
    const [kind, setKind] = useState<tProviderKind | 'all'>('all')
    const [configured, setConfigured] = useState(false)
    const term = phrase.trim().toLocaleLowerCase('ru')
    const items = providers.data?.items ?? []
    const visible = items.filter(item => {
        if (kind != 'all' && !item.kinds.includes(kind)) return false
        if (configured && !item.configured) return false
        return [item.name, item.description, item.id].join(' ').toLocaleLowerCase('ru').includes(term)
    })
    return <main className="travel-home provider-dashboard"><header className="agency-heading">
        <p>Для агентства</p><h1>Источники и подключение</h1>
        <span>Проверьте возможности, условия доступа и ответ каждого поставщика.</span>
        <div><a href={travelHash('guides', undefined, {guide: 'agency'})}>Открыть агентство в Эстонии →</a>
            <a href={travelHash('guides', undefined, {guide: 'b2b'})}>Согласовать B2B-подключение →</a>
            <a href={travelHash('guides', undefined, {guide: 'providers'})}>Настроить интеграции →</a></div>
    </header>
        {providers.data && <div className="provider-readiness">
            <p><strong>{providers.data.summary.total}</strong><span>Источников в реестре</span></p>
            <p><strong>{providers.data.summary.public}</strong><span>Публичных источников</span></p>
            <p><strong>{providers.data.summary.configured}</strong><span>С заданными параметрами</span></p>
            <p><strong>{providers.data.summary.requiresAccess}</strong><span>Ожидают доступа</span></p>
        </div>}
        <div className="provider-dashboard-filters"><label>Найти источник<input type="search" value={phrase}
            placeholder="Название или продукт" onChange={event => setPhrase(event.target.value)}/></label>
            <label>Что искать<select value={kind} onChange={event => setKind(event.target.value as tProviderKind | 'all')}>
                <option value="all">Все продукты</option>{providerKinds.map(value =>
                    <option key={value} value={value}>{providerKindNames[value]}</option>)}</select></label>
            <label className="provider-checkbox"><input type="checkbox" checked={configured}
                onChange={event => setConfigured(event.target.checked)}/> Только с заданными параметрами</label>
            <button type="button" onClick={providers.retry}>Обновить статусы</button></div>
        {providers.error && <p role="status">{providers.error} <button onClick={providers.retry}>Повторить</button></p>}
        {!providers.data && !providers.error && <p role="status">Проверяем реестр источников…</p>}
        {providers.data && <p className="provider-results-note" role="status">Найдено {visible.length} из {items.length}.
            Результат проверки конкретной поездки появится после поиска.</p>}
        <div className="provider-availability-grid">{visible.map(item => <ProviderCard key={item.id} item={item}/>)}</div>
    </main>
}
