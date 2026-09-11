import React, {useState} from 'react'
import {createRoot} from 'react-dom/client'
import type {DocumentDefinition} from '../backend/runtime'
import type {DocumentWorkspace} from '../backend/domain'
import {ServiceView} from '../shared/react/service-view'
import {useServiceSession} from '../shared/react/service-session'
import {useCommandAction} from '../shared/react/command-action'
import {useServiceAction} from '../shared/react/service-action'
import {Studio} from './studio'
import {type Commands, type Resources, formatDate, roleLabels} from './contracts'
import './style.css'

const initial: DocumentWorkspace = {account: {account: '', name: ''}, organizations: [], people: [], documents: [], audit: []}
const tabs = [{id: 'documents', label: 'Документы', icon: '▤'}, {id: 'team', label: 'Команда', icon: '◉'}, {id: 'history', label: 'История', icon: '◷'}] as const

function App() {
    const connection = useServiceSession<DocumentDefinition>({url: location.origin, storageKey: 'papertrail-token'})
    const action = useServiceAction(connection.token)
    const commands = useCommandAction(connection.session?.commands)
    const [preset, setPreset] = useState('owner')
    async function login(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault()
        const form = new FormData(event.currentTarget)
        await action.action(async function authenticate() {
            const response = await fetch('/api/documents/login', {method: 'POST', headers: {'content-type': 'application/json'},
                body: JSON.stringify({args: [{account: form.get('account'), password: form.get('password')}]})})
            const body = await response.json()
            if (!response.ok || !body.ok) throw new Error(body.error?.message ?? 'Не удалось войти')
            connection.setToken(body.value.token)
        })
    }
    const error = connection.error || action.error || commands.error
    return <>
        {error && <div className="error-banner" role="alert">{error}<button aria-label="Закрыть сообщение" onClick={function dismiss() {connection.dismissError(); action.clearError(); commands.clearError()}}>×</button></div>}
        {!connection.token ? <main className="login"><section className="login-story"><div className="brand"><span className="brand-mark">▱</span>papertrail</div><div><p className="eyebrow">ОТ ФАЙЛА К РЕШЕНИЮ</p><h1>Данные, которым<br/>можно доверять.</h1><p>Загрузите документ. Проверьте результат рядом с оригиналом. Передайте дальше подтверждённую версию.</p><div className="paper-visual" aria-hidden="true"><span/><div className="paper-grid">{Array.from({length: 15}, (_, i) => <i key={i}/>)}</div></div></div><footer className="login-footer">КАЖДОЕ ИЗМЕНЕНИЕ ОСТАЁТСЯ В ИСТОРИИ</footer></section><section className="login-form"><p className="eyebrow">СТУДИЯ ДОКУМЕНТОВ</p><h2>Продолжим работу</h2><p className="muted">Ваши файлы, команда и история проверки.</p><form key={preset} className="stack" onSubmit={login}><label>Аккаунт<input name="account" autoComplete="username" required defaultValue={preset}/></label><label>Пароль<input name="password" type="password" autoComplete="current-password" required defaultValue={preset + '-pass'}/></label><button className="primary" disabled={action.busy}>{action.busy ? 'Входим…' : 'Открыть студию →'}</button></form><div className="presets"><p className="muted">Посмотреть рабочее место</p><div className="row">{Object.entries({owner: 'Владелец', reviewer: 'Проверяющий', customer: 'Заказчик', outsider: 'Другая команда'}).map(([id, label]) => <button key={id} aria-pressed={preset == id} onClick={() => setPreset(id)}>{label}</button>)}</div><small>Демонстрационные аккаунты. Пароль — имя аккаунта + «-pass».</small></div></section></main> :
            connection.session && connection.me?.views.includes('workspace') ? <ServiceView remote={connection.session.views.workspace} initial={initial}>{value => <Workspace key={value.account.account} value={value} resources={connection.session!.resources} commands={commands} connected={connection.connected} logout={() => connection.setToken('')}/>}</ServiceView> :
                <main className="loading"><h1>Открываем студию…</h1><p className="muted">Проверяем доступ к рабочему пространству.</p><button onClick={() => connection.setToken('')}>Вернуться ко входу</button></main>}
    </>
}

function Workspace({value, resources, commands, connected, logout}: {value: DocumentWorkspace, resources: Resources, commands: Commands, connected: boolean, logout: () => void}) {
    const [scope, setScope] = useState(value.organizations[0]?.id ?? '')
    const [section, setSection] = useState<typeof tabs[number]['id']>('documents')
    const organization = value.organizations.find(item => item.id == scope) ?? value.organizations[0]
    const busy = !connected || commands.busy
    return <div className="app"><aside className="sidebar"><a href="#documents" className="brand" onClick={() => setSection('documents')}><span className="brand-mark">▱</span>papertrail</a><label className="org-select"><span>РАБОЧЕЕ ПРОСТРАНСТВО</span><select value={organization?.id ?? ''} aria-label="Организация" onChange={event => setScope(event.target.value)}>{value.organizations.map(org => <option key={org.id} value={org.id}>{org.name}</option>)}{!organization && <option value="">Нет доступа</option>}</select></label><nav aria-label="Разделы студии">{tabs.filter(tab => tab.id != 'history' || organization?.role != 'uploader').map(tab => <button key={tab.id} className={section == tab.id ? 'selected' : ''} aria-current={section == tab.id ? 'page' : undefined} onClick={() => setSection(tab.id)}><span aria-hidden="true">{tab.icon}</span>{tab.label}</button>)}</nav><div className="sidebar-note"><strong>Сначала проверка.</strong><p>Оригинал сохраняется отдельно. Исправления и подтверждения остаются в истории документа.</p></div><div className="account"><span className="avatar">{value.account.name.slice(0, 1)}</span><div><strong>{value.account.name.split(' · ')[0]}</strong><small>{organization ? roleLabels[organization.role] : 'Аккаунт'}</small></div><button aria-label="Выйти" title="Выйти" onClick={logout}>↪</button></div></aside><main className="workspace"><header className="topbar"><span className="breadcrumbs">Студия <span aria-hidden="true"> / </span><b>{tabs.find(tab => tab.id == section)?.label}</b></span><div className="row"><span className={'connection' + (connected ? '' : ' offline')} role="status"><i/>{connected ? 'Все изменения синхронизируются' : 'Восстанавливаем соединение…'}</span><button className="mobile-logout" onClick={logout}>Выйти</button></div></header>{!connected && <p className="notice">Изменения станут доступны после восстановления связи.</p>}
        {!organization ? <div className="empty"><h1>Доступ к команде закрыт</h1><p>Обратитесь к владельцу рабочего пространства.</p><button onClick={logout}>Сменить аккаунт</button></div> : <React.Fragment key={organization.id + ':' + section}>
            {section == 'documents' && <Studio value={value} org={organization} resources={resources} commands={commands} busy={busy}/>}
            {section == 'team' && <div className="page"><div className="page-heading"><div><p className="eyebrow">ЛЮДИ И ДОСТУП</p><h1>Команда студии</h1><p>Владелец управляет доступом. Проверяющий подтверждает данные.</p></div></div><div className="team-panel"><table className="data-table"><thead><tr><th>Участник</th><th>Роль</th></tr></thead><tbody>{value.people.filter(person => person.orgId == organization.id).map(person => <tr key={person.account}><td style={{fontSize: 12, color: '#425875'}}>{person.name}</td><td>{organization.role == 'owner' ? <select className="role-picker" aria-label={'Роль ' + person.name} value={person.role} disabled={busy} onChange={event => void commands.run('memberRole', {orgId: organization.id, account: person.account, role: event.target.value as 'owner' | 'reviewer' | 'uploader' | 'revoked'})}>{Object.entries(roleLabels).map(([id, label]) => <option key={id} value={id}>{label}</option>)}<option value="revoked">Закрыть доступ</option></select> : roleLabels[person.role]}</td></tr>)}</tbody></table></div></div>}
            {section == 'history' && organization.role != 'uploader' && <div className="page"><div className="page-heading"><div><p className="eyebrow">ПРОЗРАЧНАЯ РАБОТА</p><h1>История действий</h1><p>Кто загрузил, изменил и подтвердил документы.</p></div></div><div className="team-panel history">{[...value.audit].filter(item => item.orgId == organization.id).reverse().map((item, index) => <div className="history-item" key={index}><span>◷</span><div><strong>{actionLabel(item.action)}</strong><small>{value.people.find(person => person.account == item.actor)?.name ?? item.actor} · {formatDate(item.at)}</small></div></div>)}{!value.audit.some(item => item.orgId == organization.id) && <p className="empty">Здесь появятся действия с документами.</p>}</div></div>}
        </React.Fragment>}
    </main></div>
}

function actionLabel(value: string) {
    const known: Record<string, string> = {'document.upload': 'Документ загружен', 'document.row': 'Строка исправлена', 'document.approve': 'Документ подтверждён', 'document.reopen': 'Документ возвращён на проверку', 'document.delete': 'Документ удалён', 'document.extract': 'Данные извлечены'}
    return known[value] ?? (value.includes('member') ? 'Права участника изменены' : value.includes('complete') ? 'Обработка завершена' : value.includes('start') ? 'Обработка запущена' : value.includes('fail') ? 'Обработка не завершена' : value.includes('cancel') ? 'Обработка отменена' : 'Документ обновлён')
}

createRoot(document.getElementById('root')!).render(<App/> )
