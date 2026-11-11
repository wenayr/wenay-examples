import React, {useState} from 'react'
import type {CrmWorkspace} from '../backend/domain'
import type {Company, Contact} from '../backend/model'
import {roles, type Organization, type Commands} from './contracts'

type DirectoryProps = {
    kind: 'contacts' | 'companies',
    value: CrmWorkspace,
    org: Organization,
    commands: Commands,
    busy: boolean
}

export function Directory({kind, value, org, commands, busy}: DirectoryProps) {
    const [editing, setEditing] = useState<Company | Contact | null | undefined>()
    const [query, setQuery] = useState('')
    const [archived, setArchived] = useState(false)

    const needle = query.toLocaleLowerCase()
    const records = value[kind].filter(function matching(item) {
        if (item.orgId != org.id || item.archived != archived) return false
        return item.name.toLocaleLowerCase().includes(needle)
    })
    const companies = value.companies.filter(item => item.orgId == org.id && !item.archived)

    async function save(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault()
        const form = new FormData(event.currentTarget)
        const reference = {
            orgId: org.id,
            id: editing?.id ?? '',
            revision: editing?.revision ?? 0,
            name: String(form.get('name'))
        }
        let ok = false
        if (kind == 'companies') {
            ok = await commands.run('companySave', {...reference, domain: String(form.get('domain'))})
        } else {
            ok = await commands.run('contactSave', {
                ...reference,
                companyId: String(form.get('companyId')),
                email: String(form.get('email')),
                phone: String(form.get('phone'))
            })
        }
        if (ok) setEditing(undefined)
    }

    const companyFields = <label>Домен
        <input
            name="domain"
            defaultValue={editing && 'domain' in editing ? editing.domain : ''}
            maxLength={160}
        />
    </label>

    const contactFields = <>
        <label>Компания
            <select
                name="companyId"
                defaultValue={editing && 'companyId' in editing ? editing.companyId : undefined}
            >
                {companies.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
        </label>
        <div className="form-row">
            <label>Email
                <input
                    name="email"
                    type="email"
                    defaultValue={editing && 'email' in editing ? editing.email : ''}
                    maxLength={180}
                />
            </label>
            <label>Телефон
                <input
                    name="phone"
                    defaultValue={editing && 'phone' in editing ? editing.phone : ''}
                    maxLength={60}
                />
            </label>
        </div>
    </>

    const form = <form className="directory-form" onSubmit={save}>
        <header>
            <h2>{editing ? 'Изменить запись' : 'Новая запись'}</h2>
            <button type="button" onClick={() => setEditing(undefined)}>×</button>
        </header>
        <fieldset disabled={busy}>
            <label>Название или имя
                <input name="name" defaultValue={editing?.name} required maxLength={160}/>
            </label>
            {kind == 'companies' ? companyFields : contactFields}
            <button className="primary">Сохранить запись</button>
        </fieldset>
    </form>

    function card(item: Company | Contact) {
        const company = value.companies.find(value => 'companyId' in item && value.id == item.companyId)
        return <article key={item.id}>
            <span className="directory-icon">{kind == 'companies' ? '▦' : '◉'}</span>
            <h2>{item.name}</h2>
            <p>{'domain' in item ? item.domain : company?.name}</p>
            {'email' in item && <p>{item.email}<br/>{item.phone}</p>}
            <footer>
                <button disabled={busy || archived} onClick={() => setEditing({...item})}>Изменить</button>
                <button
                    disabled={busy}
                    onClick={() => void commands.run('archiveRecord', {
                        orgId: org.id,
                        kind: kind == 'companies' ? 'company' : 'contact',
                        id: item.id,
                        revision: item.revision,
                        archived: !archived
                    })}
                >
                    {archived ? 'Восстановить' : 'В архив'}
                </button>
            </footer>
        </article>
    }

    return <>
        <div className="page-title">
            <div>
                <p className="eyebrow">ЛЮДИ И КОМПАНИИ</p>
                <h1>{kind == 'contacts' ? 'Контакты клиентов' : 'Компании'}</h1>
                <p>Поддерживайте актуальные данные клиентов. Предложения и история общения хранятся в сделках.</p>
            </div>
            <button className="primary" disabled={busy} onClick={() => setEditing(null)}>
                + {kind == 'contacts' ? 'Контакт' : 'Компания'}
            </button>
        </div>
        <div className="toolbar">
            <input
                aria-label="Поиск записей"
                placeholder="Поиск по имени…"
                value={query}
                onChange={event => setQuery(event.target.value)}
            />
            <label className="inline">
                <input
                    type="checkbox"
                    checked={archived}
                    onChange={event => setArchived(event.target.checked)}
                />
                Архив
            </label>
        </div>
        {editing !== undefined && form}
        <div className="directory-grid">{records.map(card)}</div>
        {!records.length && <div className="empty">
            <h2>{query || archived ? 'Записи не найдены' : 'Записей пока нет'}</h2>
            <p>Добавьте контакт или компанию либо измените условия поиска.</p>
            {(query || archived) && <button onClick={function resetFilters() {
                setQuery('')
                setArchived(false)
            }}>Сбросить поиск и фильтры</button>}
        </div>}
    </>
}

type TeamProps = {value: CrmWorkspace, org: Organization, commands: Commands, busy: boolean}

export function Team({value, org, commands, busy}: TeamProps) {
    const manage = org.role == 'owner' || org.role == 'lead'
    const people = value.people.filter(item => item.orgId == org.id)

    function createOrg(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault()
        const name = String(new FormData(event.currentTarget).get('name'))
        void commands.run('orgCreate', {name})
    }
    function setRole(account: string, value: string) {
        void commands.run('memberRole', {
            orgId: org.id,
            revision: org.revision,
            account,
            role: value as keyof typeof roles | 'none'
        })
    }

    return <>
        <div className="page-title">
            <div>
                <p className="eyebrow">УЧАСТНИКИ И ПРАВА ДОСТУПА</p>
                <h1>Команда Orbit</h1>
                <p>Роли действуют внутри выбранной организации.</p>
            </div>
        </div>
        <div className="team-list">
            {people.map(item => (
                <article key={item.account}>
                    <span className="avatar">{item.name.slice(0, 1)}</span>
                    <div>
                        <strong>{item.name}</strong>
                        <small>{item.account}</small>
                    </div>
                    {manage ? <select
                        aria-label={'Роль ' + item.account}
                        value={item.role}
                        disabled={busy}
                        onChange={event => setRole(item.account, event.target.value)}
                    >
                        {Object.entries(roles).map(([id, label]) => (
                            <option key={id} value={id}>{label}</option>
                        ))}
                        <option value="none">Закрыть доступ</option>
                    </select> : <span>{roles[item.role]}</span>}
                </article>
            ))}
        </div>
        <form className="directory-form" onSubmit={createOrg}>
            <h2>Новое рабочее пространство</h2>
            <p>Отдельные контакты, сделки и права доступа.</p>
            <label>Название организации
                <input name="name" required maxLength={100}/>
            </label>
            <button disabled={busy}>Создать организацию</button>
        </form>
    </>
}
