import React, {useState, useEffect, useRef} from 'react'
import {useReorder} from 'wenay-react2/react'
import {Overlay} from 'wenay-react2/ui'
import type {Field, Answers} from '../backend/model'
import {useServiceAction} from '../shared/react/service-action'
import {
    useFormResource, kinds, date,
    type Resources, type Commands, type Organization, type FormRow, type Detail
} from './contracts'
import {Questions} from './questions'

function blankField(): Field {
    return {
        id: 'q' + crypto.randomUUID().replaceAll('-', '').slice(0, 12),
        label: 'Новый вопрос',
        kind: 'text',
        required: false,
        choices: [],
        min: 0,
        max: 200,
        whenField: '',
        whenEquals: ''
    }
}

// Пределы по умолчанию зависят от типа ответа.
function kindDefaults(kind: Field['kind']) {
    if (kind == 'choice') return {choices: ['Первый вариант', 'Второй вариант'], min: 0, max: 200}
    if (kind == 'number') return {choices: [], min: 1, max: 10}
    return {choices: [], min: 0, max: kind == 'longtext' ? 2000 : 200}
}

function optionLabel(value: string) {
    if (value == 'true') return 'Да'
    return value == 'false' ? 'Нет' : value
}

type EditorProps = {
    resources: Resources,
    commands: Commands,
    org: Organization,
    row: FormRow | null,
    created: (id: string) => void
}

export function FormEditor({resources, commands, org, row, created}: EditorProps) {
    const remote = useFormResource(resources, 'editor')
    const action = useServiceAction(remote)
    const [detail, setDetail] = useState<{remote: typeof remote, value: Detail} | null>(null)
    const [link, setLink] = useState<{version: number, token: string} | null>(null)
    const [publishOpen, setPublishOpen] = useState(false)
    const [notice, setNotice] = useState('')
    const publication = useRef<{revision: number, requestId: string} | null>(null)

    useEffect(function loadDetail() {
        let active = true
        setDetail(null)
        if (!remote || !row) return
        void action.action(async function read() {
            const value = await remote.control.detail({orgId: org.id, id: row.id})
            if (active) setDetail({remote, value})
        })
        return () => {active = false}
    }, [remote, row?.id, row?.revision, org.id])

    const fresh = detail && detail.remote == remote
    const matching = fresh && detail.value.id == row?.id && detail.value.revision == row?.revision
    const value = matching ? detail.value : null
    const editable = org.role != 'analyst'

    // Повтор публикации того же черновика идёт с тем же requestId и не создаёт вторую версию.
    async function publish() {
        if (!remote || !row) return
        const repeat = publication.current?.revision == row.revision
        const identity = repeat
            ? publication.current!
            : {revision: row.revision, requestId: crypto.randomUUID()}
        publication.current = identity
        await action.action(async function send() {
            const result = await remote.control.publish({orgId: org.id, id: row.id, ...identity})
            if (result.token) setLink({version: result.version, token: result.token})
            else setNotice('Эта версия уже опубликована. Ссылка выдаётся один раз,'
                + ' создайте новую публикацию, если ссылка потеряна.')
            setPublishOpen(false)
        })
    }

    const live = link && row?.enabled && row.publishedVersion == link.version
    const publicUrl = live ? location.origin + '/#respond=' + encodeURIComponent(link!.token) : ''
    const embedCode = '<iframe src="' + publicUrl + '" title="Опрос" width="100%" height="720"></iframe>'

    const publicationPanel = publicUrl && <section className="publication">
        <div>
            <strong>Версия {link!.version} готова к ответам</strong>
            <p>Сохраните ссылку. Новая публикация или закрытие формы отменит прежнюю ссылку.</p>
        </div>
        <a className="button primary" href={publicUrl} target="_blank" rel="noreferrer">
            Открыть публичную форму ↗
        </a>
        <label>Ссылка для участников
            <input aria-label="Ссылка для участников" readOnly value={publicUrl}/>
        </label>
        <details>
            <summary>Встроить на свой сайт</summary>
            <p>
                Разрешённые сайты задаются владельцем сервера.
                Для текущего сайта встраивание уже разрешено.
            </p>
            <textarea aria-label="Код встраивания" readOnly value={embedCode}/>
            <iframe className="embed-preview" title="Пример встроенного опроса" src={publicUrl} loading="lazy"/>
        </details>
    </section>

    const versions = row && value && <section className="version-panel">
        <header>
            <div>
                <h2>Публикации</h2>
                <p>
                    Сохранённый черновик увидите только вы.
                    Для участников создаётся отдельная неизменяемая версия.
                </p>
            </div>
            {editable && (
                <button
                    className="primary"
                    disabled={action.busy || commands.busy}
                    onClick={() => setPublishOpen(true)}
                >
                    Опубликовать сохранённую версию
                </button>
            )}
        </header>
        {value.versions.length ? <div className="versions">
            {value.versions.slice().reverse().map(version => (
                <article key={version.version}>
                    <strong>v{version.version} · {version.title}</strong>
                    <span>{version.fields.length} вопросов · {date(version.publishedAt)}</span>
                    <small>
                        {row.enabled && row.publishedVersion == version.version
                            ? 'Принимает ответы'
                            : 'Архив публикации'}
                    </small>
                </article>
            ))}
        </div> : <p>Пока ни одной публикации.</p>}
        {editable && row.enabled && (
            <button
                className="danger"
                disabled={commands.busy}
                onClick={() => void commands.run('formDisable', {
                    orgId: org.id,
                    id: row.id,
                    revision: row.revision
                })}
            >
                Закрыть публичную ссылку
            </button>
        )}
    </section>

    const confirm = publishOpen && <Overlay
        ariaLabel="Публикация опроса"
        scrimClassName="scrim"
        outsideClassName="modal"
        onEscape={() => setPublishOpen(false)}
    >
        <button className="close" aria-label="Закрыть подтверждение" onClick={() => setPublishOpen(false)}>
            ×
        </button>
        <span className="eyebrow">ГОТОВО К РАЗГОВОРУ</span>
        <h2>Опубликовать опрос?</h2>
        <p>
            Будет опубликован сохранённый черновик.
            Все прежние ссылки перестанут принимать ответы,
            их ответы останутся привязаны к прежней версии.
        </p>
        <div className="actions">
            <button className="primary" disabled={action.busy} onClick={() => void publish()}>
                Да, создать новую ссылку
            </button>
            <button onClick={() => setPublishOpen(false)}>Пока не публиковать</button>
        </div>
    </Overlay>

    return <>
        {action.error && <p role="alert" className="error">{action.error}</p>}
        {notice && <p role="status" className="notice">{notice}</p>}
        {publicationPanel}
        {row && !value ? <p className="muted">Открываем свежую версию…</p> : <EditorForm
            key={value?.id + ':' + value?.revision}
            detail={value}
            org={org}
            commands={commands}
            created={created}
            editable={editable}
        />}
        {versions}
        {confirm}
    </>
}

type FormProps = {
    detail: Detail | null,
    org: Organization,
    commands: Commands,
    created: (id: string) => void,
    editable: boolean
}

function EditorForm({detail, org, commands, created, editable}: FormProps) {
    const [fields, setFields] = useState<Field[]>(() => detail?.fields ?? [blankField()])
    const [title, setTitle] = useState(detail?.title ?? 'Новый разговор')
    const [description, setDescription] = useState(detail?.description ?? 'Расскажите, что для вас важно.')
    const [retention, setRetention] = useState(detail?.retentionDays ?? 30)
    const [selected, setSelected] = useState(fields[0]?.id ?? '')
    const [answers, setAnswers] = useState<Answers>({})
    const [saved, setSaved] = useState('')

    const reorder = useReorder({
        order: fields.map(field => field.id),
        preview: 'measure',
        canDrag: () => editable && !commands.busy,
        commit: order => setFields(previous => order.map(id => previous.find(field => field.id == id)!))
    })
    const current = fields.find(field => field.id == selected)

    function update(patch: Partial<Field>) {
        setFields(previous => previous.map(function patched(field) {
            return field.id == selected ? {...field, ...patch} : field
        }))
        setSaved('')
    }
    async function save(event: React.FormEvent) {
        event.preventDefault()
        let result
        try {
            result = await commands.execute('formSave', {
                orgId: org.id,
                id: detail?.id ?? '',
                revision: detail?.revision ?? 0,
                title,
                description,
                fields,
                retentionDays: retention
            })
        } catch {
            return
        }
        if (!result || !('id' in result)) return
        setSaved('Черновик сохранён')
        created(result.id)
    }
    function addField() {
        const field = blankField()
        setFields([...fields, field])
        setSelected(field.id)
    }
    // Удалённый вопрос мог быть условием для другого: такое условие снимаем.
    function removeField(field: Field) {
        const rest = fields.filter(item => item.id != field.id)
        setFields(rest.map(function unlinked(item) {
            return item.whenField == field.id ? {...item, whenField: '', whenEquals: ''} : item
        }))
        if (selected == field.id) setSelected(rest[0].id)
    }
    function changeKind(kind: Field['kind']) {
        update({kind, ...kindDefaults(kind)})
    }
    function changeCondition(id: string) {
        const parent = fields.find(field => field.id == id)
        update({
            whenField: parent?.id ?? '',
            whenEquals: parent?.kind == 'boolean' ? 'true' : parent?.choices[0] ?? ''
        })
    }

    const conditionOptions = fields.filter(function usable(field) {
        return field.id != current?.id && ['boolean', 'choice'].includes(field.kind)
    })
    const parent = fields.find(field => field.id == current?.whenField)
    const parentValues = parent?.kind == 'boolean' ? ['true', 'false'] : parent?.choices ?? []

    const list = <div className="field-list" ref={reorder.listRef}>
        {fields.map(function row(field, index) {
            const item = reorder.item(field.id)
            return <div
                key={field.id}
                className={'field-row ' + (selected == field.id ? 'selected' : '')}
                style={item.style}
            >
                <button
                    {...item.handleProps}
                    aria-label={'Переместить вопрос ' + field.label}
                    className="grip"
                >
                    ⠿
                </button>
                <button type="button" className="field-select" onClick={() => setSelected(field.id)}>
                    <small>{index + 1}</small>
                    <span>
                        {field.label}
                        <em>{kinds[field.kind]}{field.whenField ? ' · По условию' : ''}</em>
                    </span>
                </button>
                <button
                    type="button"
                    aria-label={'Удалить вопрос ' + field.label}
                    disabled={fields.length == 1}
                    onClick={() => removeField(field)}
                >
                    ×
                </button>
            </div>
        })}
    </div>

    const settings = current && <section className="field-settings">
        <h3>Настройки вопроса</h3>
        <label>Текст вопроса
            <input
                value={current.label}
                onChange={event => update({label: event.target.value})}
                required
                maxLength={160}
            />
        </label>
        <label>Тип ответа
            <select value={current.kind} onChange={event => changeKind(event.target.value as Field['kind'])}>
                {Object.entries(kinds).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select>
        </label>
        {current.kind == 'choice' && <label>Варианты, каждый с новой строки
            <textarea
                value={current.choices.join('\n')}
                onChange={event => update({choices: event.target.value.split('\n')})}
                rows={3}
            />
        </label>}
        {['text', 'longtext', 'number'].includes(current.kind) && <div className="two">
            <label>{current.kind == 'number' ? 'Минимум' : 'Минимум символов'}
                <input
                    type="number"
                    value={current.min}
                    onChange={event => update({min: Number(event.target.value)})}
                />
            </label>
            <label>{current.kind == 'number' ? 'Максимум' : 'Максимум символов'}
                <input
                    type="number"
                    value={current.max}
                    onChange={event => update({max: Number(event.target.value)})}
                />
            </label>
        </div>}
        <label className="check">
            <input
                type="checkbox"
                checked={current.required}
                onChange={event => update({required: event.target.checked})}
            />
            Обязательный ответ
        </label>
        <label>Когда показывать
            <select value={current.whenField} onChange={event => changeCondition(event.target.value)}>
                <option value="">Всегда</option>
                {conditionOptions.map(field => (
                    <option key={field.id} value={field.id}>Если «{field.label}»</option>
                ))}
            </select>
        </label>
        {current.whenField && <label>Ответ равен
            <select
                value={current.whenEquals}
                onChange={event => update({whenEquals: event.target.value})}
            >
                {parentValues.map(value => (
                    <option key={value} value={value}>{optionLabel(value)}</option>
                ))}
            </select>
        </label>}
    </section>

    return <div className="editor-layout">
        <form className="editor-work" onSubmit={save}>
            <div className="editor-heading">
                <span className="eyebrow">МАСТЕРСКАЯ ВОПРОСОВ</span>
                <span className="chip">{editable ? 'Черновик' : 'Просмотр'}</span>
            </div>
            <fieldset disabled={!editable || commands.busy}>
                <label>Название опроса
                    <input
                        className="title-input"
                        value={title}
                        onChange={event => setTitle(event.target.value)}
                        required
                        maxLength={160}
                    />
                </label>
                <label>Короткое вступление
                    <textarea
                        value={description}
                        onChange={event => setDescription(event.target.value)}
                        maxLength={2000}
                        rows={2}
                    />
                </label>
                <div className="question-toolbar">
                    <h2>Вопросы <small>{fields.length}/20</small></h2>
                    <button type="button" disabled={fields.length >= 20} onClick={addField}>
                        + Добавить вопрос
                    </button>
                </div>
                <p className="reorder-help">
                    Переносите за ручку или нажмите пробел, стрелки и Enter. Escape отменяет перенос.
                </p>
                {list}
                {settings}
                <label>Сколько дней хранить новые ответы
                    <input
                        type="number"
                        min={1}
                        max={365}
                        value={retention}
                        onChange={event => setRetention(Number(event.target.value))}
                    />
                </label>
                <p className="muted">
                    Каждый ответ получает срок при отправке. Просроченные ответы удаляются автоматически.
                </p>
                {editable && <button className="primary save-button">Сохранить черновик</button>}
                {saved && <p role="status">{saved}</p>}
            </fieldset>
        </form>
        <section className="preview">
            <div className="preview-label">◉ ГЛАЗАМИ УЧАСТНИКА <span>Предпросмотр</span></div>
            <div className="form-paper">
                <span className="petal">✳</span>
                <h2>{title}</h2>
                <p>{description}</p>
                <Questions fields={fields} answers={answers} change={setAnswers}/>
                <button disabled>Отправить ответ</button>
                <small>Предпросмотр не отправляет и не сохраняет ответы.</small>
            </div>
        </section>
    </div>
}
