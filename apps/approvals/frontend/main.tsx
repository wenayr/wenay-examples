import React, {useState, useRef} from 'react'
import {createRoot} from 'react-dom/client'
import {Overlay} from 'wenay-react2/ui'
import type {ServiceClient} from 'wenay-common2/service/client'
import type {ApprovalDefinition} from '../backend/runtime'
import type {ApprovalWorkspace} from '../backend/domain'
import type {Answers, Request, tStatus} from '../backend/model'
import {useServiceSession} from '../shared/react/service-session'
import {ServiceView} from '../shared/react/service-view'
import {useServiceAction} from '../shared/react/service-action'
import {Questions, cleanAnswers} from './questions'
import './style.css'

type Commands = ServiceClient<ApprovalDefinition>['commands']
type tDecision = 'approved' | 'changes' | 'rejected'
type tMemberRole = 'none' | 'owner' | 'reviewer' | 'requester'

const statuses: Record<tStatus, string> = {
    draft: 'Черновик',
    pending: 'На рассмотрении',
    changes: 'Нужны уточнения',
    approved: 'Согласовано',
    rejected: 'Отказано',
    withdrawn: 'Отозвано'
}
const roles = {
    owner: 'Владелец',
    reviewer: 'Проверяющий',
    requester: 'Сотрудник',
    requester2: 'Другой сотрудник',
    outsider: 'Другая команда'
}
const initial: ApprovalWorkspace = {me: null, organizations: [], requests: [], people: [], fields: []}

// Один ключ намерения на одно содержательное действие пользователя: повтор
// той же кнопки не создаёт второй эффект, изменение данных даёт новый ключ.
function useIntent() {
    const intent = useRef({signature: '', key: ''})
    return function keyFor(signature: string) {
        if (intent.current.signature != signature) intent.current = {signature, key: crypto.randomUUID()}
        return intent.current.key
    }
}

function App() {
    const connection = useServiceSession<ApprovalDefinition>({url: location.origin, storageKey: 'accord-session'})
    const action = useServiceAction(connection.token)
    const [account, setAccount] = useState('requester')

    async function login(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault()
        const data = new FormData(event.currentTarget)
        await action.action(async function send() {
            const credentials = {account: data.get('account'), password: data.get('password')}
            const response = await fetch('/api/approvals/login', {
                method: 'POST',
                headers: {'content-type': 'application/json'},
                body: JSON.stringify({args: [credentials]})
            })
            const body = await response.json()
            if (!response.ok || !body.ok) throw new Error(body.error?.message ?? 'Не удалось войти')
            connection.setToken(body.value.token)
        })
    }

    const problem = action.error || connection.error
    const notice = problem ? <p className="error" role="alert">{problem}</p> : null
    if (!connection.token) {
        return <>
            {notice}
            <main className="login">
                <section>
                    <a className="brand">accord<span>ХОРОШИЕ РЕШЕНИЯ ВМЕСТЕ</span></a>
                    <h1>Меньше ожидания.<br/>Больше ясности.</h1>
                    <p>Заявка, уточнение, решение.<br/>Один понятный путь для всей команды.</p>
                    <div className="steps">
                        <i>01 Поделиться планом</i>
                        <i>02 Обсудить детали</i>
                        <i>03 Договориться</i>
                    </div>
                </section>
                <section className="paper">
                    <p className="eyebrow">ВАША КОМАНДА</p>
                    <h2>Продолжим с хорошей идеи</h2>
                    <form onSubmit={login} key={account}>
                        <label>Аккаунт
                            <input name="account" defaultValue={account} autoComplete="username" required/>
                        </label>
                        <label>Пароль
                            <input name="password" type="password" defaultValue={account + '-pass'} autoComplete="current-password" required/>
                        </label>
                        <button className="primary" disabled={action.busy}>Войти →</button>
                    </form>
                    <div className="presets">
                        {Object.entries(roles).map(([key, label]) => (
                            <button key={key} onClick={() => setAccount(key)} aria-pressed={account == key}>{label}</button>
                        ))}
                    </div>
                    <small>Тестовые аккаунты: пароль = аккаунт + «-pass».</small>
                </section>
            </main>
        </>
    }
    const ready = connection.session && connection.me?.views.includes('workspace')
    if (!ready) {
        return <>
            {notice}
            <main className="paper">
                <h1>Нет доступных заявок</h1>
                <p>Подключаемся или доступ к команде изменился.</p>
                <button onClick={() => connection.setToken('')}>Вернуться ко входу</button>
            </main>
        </>
    }
    return <>
        {notice}
        <ServiceView initial={initial} remote={connection.session!.views.workspace}>
            {value => (
                <Workspace value={value} commands={connection.session!.commands} logout={() => connection.setToken('')}/>
            )}
        </ServiceView>
    </>
}

type WorkspaceProps = {value: ApprovalWorkspace, commands: Commands, logout: () => void}

function Workspace({value, commands, logout}: WorkspaceProps) {
    const [orgId, setOrgId] = useState('')
    const [selected, setSelected] = useState('')
    const [creating, setCreating] = useState(false)
    const [filter, setFilter] = useState('all')
    const [team, setTeam] = useState(false)
    const action = useServiceAction(commands)

    const org = value.organizations.find(item => item.id == orgId) ?? value.organizations[0]
    const requests = value.requests.filter(item => item.orgId == org?.id)
    const rows = requests.filter(item => filter == 'all' || item.status == filter)
    const row = rows.find(item => item.id == selected) ?? rows[0]
    const counted = (status: tStatus) => requests.filter(item => item.status == status).length

    function switchOrganization(event: React.ChangeEvent<HTMLSelectElement>) {
        setOrgId(event.target.value)
        setSelected('')
        setCreating(false)
        setTeam(false)
    }
    function startDraft() {
        setCreating(true)
        setSelected('')
    }
    function openRequest(id: string) {
        setSelected(id)
        setCreating(false)
    }
    function changeRole(account: string, role: tMemberRole) {
        void action.action(() => commands.memberRole(crypto.randomUUID(), {
            orgId: org.id, revision: org.revision, account, role
        }))
    }

    const header = <header>
        <a className="brand">accord</a>
        <select aria-label="Организация" value={org?.id ?? ''} onChange={switchOrganization}>
            {value.organizations.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
        <span>{value.me?.name} · {org ? roles[org.role] : ''}</span>
        {org?.role == 'owner' && <button onClick={() => setTeam(!team)}>{team ? 'К заявкам' : 'Команда'}</button>}
        <button onClick={logout}>Выйти</button>
    </header>

    if (!org) {
        return <>
            {header}
            <main className="paper"><h1>Доступ к команде закрыт</h1></main>
        </>
    }
    if (team && org.role == 'owner') {
        return <>
            {header}
            <main key={org.id + org.role} className="workspace">
                <section className="paper">
                    <h1>Кому доверить решение</h1>
                    <p>Сотрудник видит свои заявки. Проверяющий рассматривает заявки команды. Даже владелец не согласовывает свои.</p>
                    {value.people.filter(person => person.orgId == org.id).map(person => (
                        <label key={person.account}>{person.account}
                            <select
                                aria-label={'Роль ' + person.account}
                                value={person.role}
                                onChange={event => changeRole(person.account, event.target.value as tMemberRole)}
                            >
                                <option value="none">Отозвать доступ</option>
                                <option value="owner">Владелец</option>
                                <option value="reviewer">Проверяющий</option>
                                <option value="requester">Сотрудник</option>
                            </select>
                        </label>
                    ))}
                    {action.error && <p role="alert">{action.error}</p>}
                </section>
            </main>
        </>
    }

    let detail = <section className="paper empty">
        <h2>Хорошая идея заслуживает ответа</h2>
        <p>Создайте заявку и объясните, зачем она команде.</p>
    </section>
    if (creating) {
        function saved(id: string) {
            setSelected(id)
            setFilter('all')
            setCreating(false)
        }
        detail = <RequestForm key="new" fields={value.fields} orgId={org.id} row={null} commands={commands} saved={saved}/>
    } else if (row) {
        detail = <RequestPanel key={row.id + ':' + row.revision + ':' + org.role} row={row} value={value} commands={commands}/>
    }

    const lead = org.role == 'requester'
        ? 'Все ваши запросы и ответы команды — рядом.'
        : 'Рассмотрите отправленные версии. Черновик не заменяет принятое решение.'
    return <>
        {header}
        <main key={org.id + org.role} className="workspace">
            <div className="intro">
                <div>
                    <p className="eyebrow">ОТ ПЛАНА К РЕШЕНИЮ</p>
                    <h1>Давайте договоримся</h1>
                    <p>{lead}</p>
                </div>
                <button className="primary" onClick={startDraft}>+ Новая заявка</button>
            </div>
            <div className="metrics">
                <span><strong>{counted('pending')}</strong> ждут решения</span>
                <span><strong>{counted('approved')}</strong> согласовано</span>
                <span><strong>{counted('changes')}</strong> нужно уточнить</span>
            </div>
            <div className="split">
                <aside>
                    <label>Показать
                        <select value={filter} onChange={event => setFilter(event.target.value)}>
                            <option value="all">Все заявки</option>
                            {Object.entries(statuses).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                        </select>
                    </label>
                    {rows.map(item => (
                        <button
                            className={'request-card ' + (!creating && item.id == row?.id ? 'selected' : '')}
                            key={item.id}
                            onClick={() => openRequest(item.id)}
                        >
                            <small className={'status ' + item.status}>{statuses[item.status]}</small>
                            <strong>{item.title}</strong>
                            <span>{Number(item.answers.amount ?? 0).toLocaleString('ru-RU')} ₽ · {item.author}</span>
                        </button>
                    ))}
                    {rows.length == 0 && <p>Здесь пока спокойно.</p>}
                </aside>
                {detail}
            </div>
        </main>
    </>
}

type FormProps = {
    fields: ApprovalWorkspace['fields'],
    orgId: string,
    row: Request | null,
    commands: Commands,
    saved: (id: string) => void
}

function RequestForm({fields, orgId, row, commands, saved}: FormProps) {
    const [title, setTitle] = useState(row?.title ?? '')
    const [answers, setAnswers] = useState<Answers>(row?.answers ?? {})
    const action = useServiceAction(commands)
    const intent = useIntent()

    async function save(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault()
        const input = {
            orgId, id: row?.id ?? '', revision: row?.revision ?? 0, title,
            answersJson: JSON.stringify(cleanAnswers(fields, answers))
        }
        await action.action(async function send() {
            const receipt = await commands.requestSave(crypto.randomUUID(), {...input, key: intent(JSON.stringify(input))})
            saved(receipt.id)
        })
    }

    return <section className="paper">
        <p className="eyebrow">ВАШ ПЛАН</p>
        <h2>{row ? 'Уточните детали' : 'Новая заявка'}</h2>
        <p>Сначала сохраните. Отправка на рассмотрение — отдельный шаг.</p>
        <form onSubmit={save}>
            <label>Коротко о запросе
                <input value={title} required maxLength={160} onChange={event => setTitle(event.target.value)}/>
            </label>
            <Questions fields={fields} answers={answers} change={setAnswers} disabled={action.busy}/>
            <button className="primary" disabled={action.busy}>Сохранить черновик</button>
        </form>
        {action.error && <p className="error" role="alert">{action.error}</p>}
    </section>
}

type PanelProps = {row: Request, value: ApprovalWorkspace, commands: Commands}

function RequestPanel({row, value, commands}: PanelProps) {
    const own = row.author == value.me?.account
    const role = value.organizations.find(org => org.id == row.orgId)!.role
    const editable = own && ['draft', 'changes', 'withdrawn'].includes(row.status)
    const [version, setVersion] = useState(row.versions.length)
    const [body, setBody] = useState('')
    const [confirm, setConfirm] = useState<tDecision | null>(null)
    const action = useServiceAction(commands)
    const intent = useIntent()

    const current = row.versions.find(item => item.version == version)
    const input = {orgId: row.orgId, id: row.id, revision: row.revision}
    const reviewing = !own && role != 'requester' && row.status == 'pending' && version == row.versions.length

    async function send() {
        await action.action(() => commands.requestSubmit(crypto.randomUUID(), {...input, key: intent('submit' + JSON.stringify(input))}))
    }
    async function withdraw() {
        await action.action(() => commands.requestWithdraw(crypto.randomUUID(), {...input, key: intent('withdraw' + JSON.stringify(input))}))
    }
    async function decide() {
        if (!confirm) return
        const decision = {...input, version, decision: confirm, body}
        await action.action(async function apply() {
            await commands.requestDecide(crypto.randomUUID(), {...decision, key: intent(JSON.stringify(decision))})
            setConfirm(null)
        })
    }

    const questions = {approved: 'Согласовать заявку?', changes: 'Вернуть на уточнение?', rejected: 'Отказать по заявке?'}
    return <div className="request-detail">
        <section className="paper">
            <div className="detail-top">
                <span className={'status ' + row.status}>{statuses[row.status]}</span>
                <small>{row.author} · редакция {row.revision}</small>
            </div>
            <h2>{row.title}</h2>
            {own && row.status == 'pending' && (
                <button onClick={() => void withdraw()} disabled={action.busy}>Отозвать с рассмотрения</button>
            )}
            {editable && (
                <button className="primary" onClick={() => void send()} disabled={action.busy}>Отправить сохранённую версию →</button>
            )}
            {own && role != 'requester' && <p>Решение по вашей заявке принимает другой проверяющий.</p>}
        </section>
        {editable && <RequestForm fields={value.fields} orgId={row.orgId} row={row} commands={commands} saved={() => {}}/>}
        {current && <section className="paper">
            <label>Отправленная версия
                <select value={version} onChange={event => setVersion(Number(event.target.value))}>
                    {row.versions.map(item => (
                        <option key={item.version} value={item.version}>
                            Версия {item.version} · {new Date(item.at).toLocaleString('ru-RU')}
                        </option>
                    ))}
                </select>
            </label>
            <h2>{current.title}</h2>
            <Questions fields={current.fields} answers={current.answers} change={() => {}} disabled/>
            {reviewing && <>
                <label>Комментарий к решению
                    <textarea value={body} maxLength={2000} onChange={event => setBody(event.target.value)}/>
                </label>
                <div className="decision-buttons">
                    <button className="primary" onClick={() => setConfirm('approved')}>Согласовать</button>
                    <button onClick={() => setConfirm('changes')}>Вернуть на уточнение</button>
                    <button onClick={() => setConfirm('rejected')}>Отказать</button>
                </div>
            </>}
        </section>}
        {row.history.length > 0 && <section className="paper history">
            <h2>Как пришли к решению</h2>
            {row.history.slice().reverse().map((event, index) => (
                <article key={index}>
                    <strong>{event.kind == 'submitted' ? 'Отправлено' : statuses[event.kind]} · версия {event.version}</strong>
                    <span>{event.actor} · {new Date(event.at).toLocaleString('ru-RU')}</span>
                    {event.body && <p>{event.body}</p>}
                </article>
            ))}
        </section>}
        {action.error && <p className="error" role="alert">{action.error}</p>}
        {confirm && <Overlay
            ariaLabel="Подтвердить решение"
            outsideClassName="modal"
            scrimClassName="scrim"
            onEscape={() => setConfirm(null)}
        >
            <button aria-label="Закрыть подтверждение" onClick={() => setConfirm(null)}>×</button>
            <h2>{questions[confirm]}</h2>
            <p>Решение будет относиться только к отправленной версии {version}. Автор увидит ваш комментарий.</p>
            {body && <blockquote>{body}</blockquote>}
            <button className="primary" disabled={action.busy} onClick={() => void decide()}>Подтвердить решение</button>
            {action.error && <p role="alert">{action.error}</p>}
        </Overlay>}
    </div>
}

createRoot(document.getElementById('root')!).render(<App/>)
