import {useRef, useState, type FormEvent} from 'react'
import {initialAgencySettings, agencyDestinationNames, type AgencyProfile, type AgencySettings} from '../../src/agency-contract.ts'
import {Icon} from '../Icons.tsx'
import {useAgency} from './AgencyProvider.tsx'
import {AgencyBrandPreview, AgencySettingsFields, agencyFormSections, type tAgencyFormSection} from './SettingsFields.tsx'
import {AgencyLeads} from './AgencyLeads.tsx'
import './agency-workspace.css'

const workspaceTabs = {overview: 'Обзор', settings: 'Настройки', leads: 'Заявки'} as const
const workspaceIcons = {overview: 'compass', settings: 'settings', leads: 'people'} as const
type tWorkspaceTab = keyof typeof workspaceTabs
const formSteps = Object.keys(agencyFormSections) as tAgencyFormSection[]

function CreationWizard() {
    const {saving, control} = useAgency()
    const [step, setStep] = useState(0)
    const [value, setValue] = useState(initialAgencySettings)
    const section = formSteps[step]
    const content = agencyFormSections[section]
    let actionLabel = step < formSteps.length - 1 ? 'Продолжить' : 'Создать агентство'
    if (saving) actionLabel = 'Создаём кабинет…'
    async function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        if (step < formSteps.length - 1) {
            setStep(step + 1)
            return
        }
        await control.create(value)
    }
    return <div className="aw-onboarding"><header className="aw-welcome"><span className="aw-eyebrow">Своё дело, свои путешествия</span>
        <h1>Ваше агентство.<br/><em>Готово к первым клиентам.</em></h1>
        <p>Соберите рабочее пространство: ваш бренд, подбор путешествий, проверяемые отзывы и клиентские заявки.</p>
        <div className="aw-welcome-tags"><span><Icon name="compass" size={15}/>Свой стиль</span>
            <span><Icon name="map" size={15}/>Карта и цены</span><span><Icon name="people" size={15}/>Работа с клиентами</span></div></header>
        <div className="aw-setup-layout"><section className="aw-setup-card"><ol className="aw-steps" aria-label="Этапы создания агентства">
            {formSteps.map((key, index) => <li key={key} aria-current={step == index ? 'step' : undefined} data-complete={step > index || undefined}>
                <button type="button" disabled={index > step || saving} onClick={() => setStep(index)}><span>{index + 1}</span>
                    {agencyFormSections[key].label}</button></li>)}</ol>
            <form onSubmit={submit}><div className="aw-step-heading"><span><Icon name={content.icon} size={24}/></span>
                <div><h2>{content.label}</h2><p>{content.description}</p></div></div>
                <AgencySettingsFields value={value} onChange={setValue} section={section}/>
                <div className="aw-wizard-actions">{step > 0 && <button type="button" className="aw-secondary" disabled={saving}
                    onClick={() => setStep(step - 1)}>Назад</button>}<span>Шаг {step + 1} из {formSteps.length}</span>
                    <button className="aw-primary" disabled={saving}>{actionLabel}
                        {!saving && <Icon name="arrow" size={17}/>}</button></div>
                <p className="aw-legal-note">Создаётся кабинет в сервисе.
                    Юридическую регистрацию, договоры с поставщиками и право продажи оформляют отдельно.</p>
            </form></section><AgencyBrandPreview value={value}/></div>
    </div>
}

function AgencySettings({agency}: {agency: AgencyProfile}) {
    const {saving, control} = useAgency()
    const [draft, setDraft] = useState<AgencySettings>(agency)
    const [section, setSection] = useState<tAgencyFormSection>('brand')
    const [saved, setSaved] = useState(false)
    const saveStatus = useRef<HTMLSpanElement>(null)
    const changed = JSON.stringify(draft) != JSON.stringify(agency)
    let saveLabel = changed ? 'Есть несохранённые изменения' : 'Всё сохранено'
    if (saved) saveLabel = 'Изменения сохранены'
    function edit(value: AgencySettings) {
        setSaved(false)
        setDraft(value)
    }
    function reset() {
        setDraft(agency)
        setSaved(false)
    }
    async function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        const result = await control.save({...draft, revision: agency.revision})
        if (!result) return
        setDraft(result)
        setSaved(true)
        requestAnimationFrame(function focusSavedStatus() {
            if (document.activeElement == document.body) saveStatus.current?.focus({preventScroll: true})
        })
    }
    return <section><header className="aw-panel-heading"><div><span className="aw-eyebrow">Управление агентством</span><h2>Настройки</h2>
        <p>Изменения применятся к подбору и оформлению после сохранения.</p></div><span className="aw-revision">Версия {agency.revision}</span></header>
        <div className="aw-settings-layout"><form className="aw-settings-form" onSubmit={submit}><div className="aw-section-tabs" aria-label="Разделы настроек">
            {formSteps.map(key => <button type="button" key={key} aria-pressed={section == key} onClick={() => setSection(key)}>
                <Icon name={agencyFormSections[key].icon} size={17}/>{agencyFormSections[key].label}</button>)}</div>
            <AgencySettingsFields value={draft} onChange={edit} section={section} fixedSlug/>
            <div className="aw-save-bar"><span ref={saveStatus} role="status" tabIndex={-1}>{saveLabel}</span>
                <button type="button" className="aw-secondary" disabled={!changed || saving} onClick={reset}>Сбросить</button>
                <button className="aw-primary" disabled={!changed || saving}>{saving ? 'Сохраняем…' : 'Сохранить изменения'}</button></div>
        </form><AgencyBrandPreview value={draft}/></div>
    </section>
}

function AgencyOverview({agency, onTab}: {agency: AgencyProfile, onTab: (tab: tWorkspaceTab) => void}) {
    const {leads} = useAgency()
    const newLeads = leads.filter(lead => lead.status == 'new').length
    const contactReady = Boolean(agency.contact.email || agency.contact.phone)
    const searchReady = Boolean(agency.sources.length && agency.destinations.length)
    const tasks = [
        {ready: true, label: 'Стиль агентства настроен', detail: agency.name, action: 'Оформление', tab: 'settings'},
        {ready: contactReady, label: 'Контакты для клиентов', detail: 'Рабочая почта или телефон', action: 'Настроить', tab: 'settings'},
        {ready: searchReady, label: 'Подбор путешествий', detail: 'Регионы и реальный источник цен', action: 'Настроить', tab: 'settings'},
        {ready: leads.length > 0, label: 'Первый запрос клиента', detail: 'Сохраните пожелания и контакт', action: 'К заявкам', tab: 'leads'},
    ] as const satisfies readonly {ready: boolean, label: string, detail: string, action: string, tab: tWorkspaceTab}[]
    const completed = tasks.filter(task => task.ready).length
    return <section><div className="aw-overview-grid"><div className="aw-launch-card"><span className="aw-eyebrow">Хорошее начало</span>
        <h2>{'Собирайте путешествия,'}<br/><em>к которым хочется вернуться.</em></h2>
        <p>{agency.tagline || 'Всё для подбора, сравнения и разговора с клиентом уже рядом.'}</p>
        <div className="aw-launch-actions"><a className="aw-primary" href="#packages"><Icon name="map" size={17}/>Открыть подбор</a>
            <button className="aw-secondary" onClick={() => onTab('leads')}>Добавить запрос</button>
            <a className="aw-secondary" href={'/a/' + agency.slug}>Открыть витрину <Icon name="external" size={14}/></a></div>
        <div className="aw-overview-regions">{agency.destinations.map(id => <span key={id}>
            {agencyDestinationNames[id as keyof typeof agencyDestinationNames] ?? id}</span>)}</div></div>
        <div className="aw-quick-stats"><button type="button" onClick={() => onTab('leads')}><span><Icon name="people" size={19}/>Новые заявки</span>
            <strong>{newLeads}</strong><small>Ожидают первого контакта</small></button><button type="button" onClick={() => onTab('settings')}>
            <span><Icon name="compass" size={19}/>Источники в подборе</span><strong>{agency.sources.length}</strong>
            <small>{searchReady ? 'Поиск по вашим настройкам' : 'Подбор приостановлен настройками'}</small></button></div></div>
        <div className="aw-overview-bottom"><section className="aw-checklist"><header><div><span className="aw-eyebrow">Настройте под себя</span>
            <h2>Маршрут к первой продаже</h2></div><span>{completed} / {tasks.length}</span></header><progress value={completed} max={tasks.length}/>
            {tasks.map(task => <div className="aw-check-task" key={task.label}><span className={task.ready ? 'is-ready' : ''}>
                {task.ready ? '✓' : <Icon name="compass" size={16}/>}</span><div><strong>{task.label}</strong><small>{task.detail}</small></div>
                <button type="button" onClick={() => onTab(task.tab)}>{task.action}<Icon name="arrow" size={14}/></button></div>)}</section>
            <aside className="aw-resources"><span className="aw-eyebrow">Следующий шаг</span><h2>Из кабинета — в своё дело</h2>
                <p>Разберитесь с регистрацией, партнёрскими договорами и правилами работы с клиентом.</p>
                <a href="#guides?guide=agency">Как открыть агентство <Icon name="arrow" size={16}/></a>
                <a href="#guides?guide=b2b">Договоры с поставщиками <Icon name="arrow" size={16}/></a>
                <a href="#providers">Возможности интеграций <Icon name="arrow" size={16}/></a>
                <small>Цены и доступность подтверждаются у поставщика перед оформлением. Кабинет не бронирует и не принимает оплату.</small></aside></div>
    </section>
}

export function AgencyWorkspace() {
    const {session, loading, error, conflict, saving, control} = useAgency()
    const agency = session.agency
    const [tab, setTab] = useState<tWorkspaceTab>('overview')
    return <main className="travel-home agency-workspace">
        {error && <div className="aw-error" role="alert"><div><strong>{conflict ? 'Данные изменились в другом окне' : 'Не удалось выполнить действие'}</strong>
            <p>{error}</p>{conflict && <small>Обновите данные и повторите изменение. Несохранённый текст останется до обновления.</small>}</div>
            <button type="button" className="aw-secondary" disabled={saving} onClick={() => {void control.load()}}>Обновить данные</button></div>}
        {loading && <div className="aw-loading" role="status"><Icon name="compass" size={28}/><h1>Открываем ваше рабочее пространство…</h1></div>}
        {!loading && !session.authenticated && <section className="aw-access"><span className="aw-access-icon"><Icon name="compass" size={34}/></span>
            <span className="aw-eyebrow">Ваше агентство в Wenay Travel</span><h1>От идеи — к первым путешествиям</h1>
            <p>Войдите, чтобы создать кабинет, настроить свой бренд и работать с клиентскими заявками.</p>
            <a className="aw-primary" href="/signin-with-chatgpt">Войти и создать агентство <Icon name="arrow" size={17}/></a></section>}
        {!loading && session.authenticated && !session.storageAvailable && <section className="aw-access"><Icon name="settings" size={34}/>
            <h1>Готовим место для вашего агентства</h1><p>Серверное хранилище пока недоступно. Настройки и заявки смогут сохраняться после его подключения.</p>
            <button className="aw-primary" type="button" onClick={() => {void control.load()}}>Проверить снова</button></section>}
        {!loading && session.authenticated && session.storageAvailable && !agency && <CreationWizard/>}
        {!loading && session.authenticated && session.storageAvailable && agency && <><header className="aw-workspace-heading"><div>
            <span className="aw-eyebrow">Рабочее пространство агентства</span><h1>{agency.name}</h1>
            <p>{agency.tagline || 'Создавайте путешествия с вниманием к деталям.'}</p>
            </div><span className="aw-private"><Icon name="people" size={15}/>Кабинет владельца <small>{agency.slug}</small></span></header>
            <nav className="aw-tabs" aria-label="Кабинет агентства">{Object.entries(workspaceTabs).map(([key, label]) =>
                <button key={key} type="button" aria-current={tab == key ? 'page' : undefined} onClick={() => setTab(key as tWorkspaceTab)}>
                    <Icon name={workspaceIcons[key as tWorkspaceTab]} size={17}/>{label}</button>)}</nav>
            {tab == 'overview' && <AgencyOverview agency={agency} onTab={setTab}/>}
            {tab == 'settings' && <AgencySettings agency={agency}/>}
            {tab == 'leads' && <AgencyLeads/>}
            <p className="aw-bottom-note">Ваш кабинет сохранён на сервере.
                {'Короткое имя — идентификатор внутри сервиса; доступ определяется настройками сайта.'}</p></>}
    </main>
}
