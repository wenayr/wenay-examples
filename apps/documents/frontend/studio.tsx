import React, {useEffect, useMemo, useRef, useState} from 'react'
import {useOwnedClient, useClientStore} from 'wenay-react2/react'
import type {AiRunStore} from 'wenay-common2/ai'
import type {DocumentWorkspace} from '../backend/domain'
import {useReplayView} from '../shared/react/replay-view'
import {useServiceAction} from '../shared/react/service-action'
import {
    type Commands, type Resources, type ProcessorRemote, type DocumentMetadata, type DocumentDetail,
    downloadFile, formatDate, statusLabels
} from './contracts'
import {VersionComparison} from './version-comparison'

const sample = 'Позиция,Количество,Цена,Поставщик\n'
    + 'Дизайн интерфейса,1,45000,Студия Север\n'
    + 'Подготовка иллюстраций,6,3500,Студия Север\n'
    + 'Проверка макетов,2,8000,Бюро Линия\n'
    + 'Экспорт материалов,1,5000,Студия Север'

const documentTabs = [
    {id: 'table', title: 'Результат проверки'},
    {id: 'original', title: 'Оригинал'},
    {id: 'history', title: 'История'},
    {id: 'compare', title: 'Сравнить версии'}
] as const

const accepted = '.csv,.txt,.pdf,text/csv, text/plain, application/pdf'

const documentQueues = [
    {id: 'uploaded', title: 'К обработке', hint: 'Запустить извлечение'},
    {id: 'processing', title: 'В обработке', hint: 'Дождаться результата'},
    {id: 'review', title: 'На проверке', hint: 'Сверить с оригиналом'},
    {id: 'attention', title: 'Требуют внимания', hint: 'Проверить причину'},
    {id: 'approved', title: 'Подтверждены', hint: 'Выгрузить данные'}
] as const

function documentQueue(document: DocumentMetadata) {
    if (document.status == 'failed' || document.status == 'uncertain') return 'attention'
    if (document.status == 'cancelled') return 'uploaded'
    return document.status
}

function nextStep(document: DocumentMetadata, canReview: boolean) {
    if (document.status == 'uncertain') return 'Сверьте результат перед повторным запуском'
    if (document.status == 'failed') return 'Проверьте причину ошибки обработки'
    if (document.status == 'review') return canReview ? 'Проверьте и подтвердите данные' : 'Дождитесь проверки команды'
    if (document.status == 'approved') return 'Подтверждённые данные готовы к выгрузке'
    if (document.status == 'processing') return 'Дождитесь завершения обработки'
    if (document.status == 'cancelled') return 'Проверьте документ после отмены обработки'
    return 'Запустите извлечение данных из оригинала'
}

function fileKind(name: string) {
    const lower = name.toLowerCase()
    if (lower.endsWith('.pdf')) return 'PDF'
    return lower.endsWith('.csv') ? 'CSV' : 'TXT'
}

type StudioProps = {
    value: DocumentWorkspace,
    org: DocumentWorkspace['organizations'][number],
    resources: Resources,
    commands: Commands,
    busy: boolean
}

export function Studio({value, org, resources, commands, busy}: StudioProps) {
    const owned = useOwnedClient({
        key: resources,
        create: () => ({...resources.open('processor'), ready: Promise.resolve()})
    })
    const status = useClientStore(useMemo(() => owned.client ? {store: owned.client.status} : null, [owned.client]))
    const remote = status.state?.phase == 'ready' ? owned.client?.current()?.remote : null
    const ai = useReplayView<AiRunStore>(remote?.ai.state ?? null, () => ({runs: {}, approvals: {}, inputs: {}}))
    const action = useServiceAction(remote)

    const [selected, setSelected] = useState('')
    const [query, setQuery] = useState('')
    const [queue, setQueue] = useState('all')
    const [dragging, setDragging] = useState(false)
    const [uploading, setUploading] = useState(false)
    const [uploadNotice, setUploadNotice] = useState('')
    const transfer = useRef<{remote: ProcessorRemote, uploadId: string, cancelled: boolean} | null>(null)
    const studioRef = useRef<HTMLElement>(null)

    const mine = value.documents.filter(item => item.orgId == org.id)
    const documents = mine.sort((a, b) => b.createdAt - a.createdAt)
    const needle = query.toLocaleLowerCase()
    const inQueue = documents.filter(item => queue == 'all' || documentQueue(item) == queue)
    const filtered = inQueue.filter(item => item.name.toLocaleLowerCase().includes(needle))
    const current = documents.find(item => item.id == selected) ?? filtered[0]
    const disabled = busy || action.busy || !remote || !ai.ready
    const canReview = org.role != 'uploader'
    const nextQueue = canReview
        ? ['attention', 'review', 'uploaded', 'processing', 'approved']
        : ['attention', 'uploaded', 'processing', 'review', 'approved']
    const queuedDocuments = nextQueue.map(id => documents.find(item => documentQueue(item) == id))
    const nextDocument = queuedDocuments.find(Boolean)

    function chooseQueue(id: string) {
        setQueue(id)
        setQuery('')
        const first = documents.find(item => id == 'all' || documentQueue(item) == id)
        setSelected(first?.id ?? '')
    }
    function openNext() {
        if (!nextDocument) return
        setQueue('all')
        setQuery('')
        setSelected(nextDocument.id)
        studioRef.current?.scrollIntoView({block: 'start'})
    }

    const scope = useRef({remote, orgId: org.id})
    scope.current = {remote, orgId: org.id}

    // Уход с экрана или смена организации прерывают начатую передачу файла.
    useEffect(function uploadLifetime() {
        return function abandon() {
            const pending = transfer.current
            if (!pending) return
            pending.cancelled = true
            if (!pending.uploadId) return
            void pending.remote.control.cancelUpload(pending.uploadId).catch(() => {})
        }
    }, [remote, org.id])

    function sameScope(active: {remote: ProcessorRemote | null | undefined, orgId: string}) {
        return scope.current.remote == active.remote && scope.current.orgId == active.orgId
    }

    async function sendFile(name: string, readBytes: () => Promise<Uint8Array>) {
        const active = scope.current
        if (!active.remote) return
        const pending = {remote: active.remote, uploadId: '', cancelled: false}
        transfer.current = pending
        setUploading(true)
        setUploadNotice('')
        await action.action(async function send() {
            try {
                pending.uploadId = (await pending.remote.control.beginUpload(active.orgId)).uploadId
                if (pending.cancelled) {
                    await pending.remote.control.cancelUpload(pending.uploadId)
                    if (sameScope(active)) setUploadNotice('Загрузка отменена')
                    return
                }
                const bytes = await readBytes()
                if (pending.cancelled || !sameScope(active)) {
                    await pending.remote.control.cancelUpload(pending.uploadId)
                    return
                }
                const result = await pending.remote.control.upload({
                    orgId: active.orgId,
                    name,
                    bytes,
                    uploadId: pending.uploadId
                })
                if (sameScope(active)) {
                    setSelected(result.id)
                    setUploadNotice('Файл сохранён')
                }
            } finally {
                if (pending.uploadId) {
                    void pending.remote.control.cancelUpload(pending.uploadId).catch(() => {})
                }
                if (transfer.current == pending) {
                    transfer.current = null
                    setUploading(false)
                }
            }
        })
    }

    async function upload(name: string, bytes: Uint8Array) {
        await sendFile(name, () => Promise.resolve(bytes))
    }
    async function cancelUpload() {
        const pending = transfer.current
        if (!pending) return
        pending.cancelled = true
        if (!pending.uploadId) {
            setUploadNotice('Отменяем загрузку…')
            return
        }
        try {
            const result = await pending.remote.control.cancelUpload(pending.uploadId)
            setUploadNotice(cancelNotice(result.status))
        } catch {
            setUploadNotice('Подключение прервано. Проверьте список документов')
        }
    }
    async function choose(file?: File) {
        if (!file || disabled) return
        await sendFile(file.name, async function readFile() {
            if (file.size > 512 * 1024) throw new Error('Выберите файл размером до 512 КиБ')
            return new Uint8Array(await file.arrayBuffer())
        })
    }
    function loadSample() {
        void upload('Смета — сентябрь.csv', new TextEncoder().encode(sample))
    }

    function over(event: React.DragEvent) {
        event.preventDefault()
        if (!disabled) setDragging(true)
    }
    function drop(event: React.DragEvent) {
        event.preventDefault()
        setDragging(false)
        void choose(event.dataTransfer.files[0])
    }
    function selectedFile(event: React.ChangeEvent<HTMLInputElement>) {
        void choose(event.target.files?.[0])
        event.currentTarget.value = ''
    }

    const uploadPanel = <div
        className={'upload-panel' + (dragging ? ' dragging' : '')}
        onDragOver={over}
        onDragLeave={() => setDragging(false)}
        onDrop={drop}
    >
        <span aria-hidden="true">↥</span>
        <div className="grow">
            <h3>{action.busy ? 'Загружаем документ…' : 'Добавить документ'}</h3>
            <p>Перетащите CSV, TXT или текстовый PDF. Размер файла — до 512 КиБ.</p>
        </div>
        <label>
            <span className="sr-only">Выбрать документ</span>
            <input
                aria-label="Выбрать CSV, TXT или PDF"
                type="file"
                accept={accepted}
                disabled={disabled}
                onChange={selectedFile}
            />
        </label>
        <button disabled={disabled} onClick={loadSample}>Загрузить пример</button>
    </div>

    const emptyList = <div className="empty">
        <span className="empty-symbol">▤</span>
        <h3>{query || queue != 'all' ? 'Документы не найдены' : 'Здесь будут ваши документы'}</h3>
        <p>{query || queue != 'all' ? 'Измените название или выберите другой этап.' : 'Загрузите файл или начните с примера сметы.'}</p>
        {query && <button onClick={() => setQuery('')}>Очистить поиск</button>}
        {queue != 'all' && <button onClick={() => chooseQueue('all')}>Все документы</button>}
    </div>

    const list = <aside className="documents-list">
        <div className="list-toolbar">
            <strong>{documentQueues.find(item => item.id == queue)?.title ?? 'Все документы'} <span className="muted">{filtered.length}</span></strong>
            <input
                placeholder="Найти документ…"
                aria-label="Поиск документов"
                value={query}
                onChange={event => setQuery(event.target.value)}
            />
        </div>
        <div className="file-list">
            {filtered.map(item => (
                <button
                    className={'file-card' + (current?.id == item.id ? ' selected' : '')}
                    key={item.id}
                    aria-pressed={current?.id == item.id}
                    onClick={() => setSelected(item.id)}
                >
                    <span className="file-icon">{fileKind(item.name)}</span>
                    <span className="file-card-copy">
                        <strong>{item.name}</strong>
                        <small>
                            {Math.max(1, Math.round(item.size / 1024))} КиБ · {formatDate(item.createdAt)}
                        </small>
                        <span className={'badge ' + item.status}>{statusLabels[item.status]}</span>
                    </span>
                </button>
            ))}
            {!filtered.length && emptyList}
        </div>
    </aside>

    const placeholder = <div className="empty">
        <span className="empty-symbol">▧</span>
        <h3>{current ? 'Подключаем документ…' : 'Оригинал и результат — рядом'}</h3>
        <p>Выберите документ, извлеките данные и проверьте таблицу перед экспортом.</p>
        {!current && (
            <button disabled={disabled} onClick={loadSample}>Попробовать на примере →</button>
        )}
    </div>

    const connectionError = action.error || ai.error || owned.error
    const connectionMessage = action.error
        || 'Подключение к обработке закрыто. Дождитесь восстановления доступа или войдите снова.'

    return <div className="page">
        <div className="page-heading">
            <div>
                <p className="eyebrow">ДОКУМЕНТЫ → ПРОВЕРЕННЫЕ ДАННЫЕ</p>
                <h1>Документы и проверка</h1>
                <p>Сверьте извлечённые данные с оригиналом, подтвердите версию и выгрузите результат.</p>
            </div>
            <span className="badge">CSV · TXT · PDF</span>
        </div>
        <section className="document-flow" aria-label="Этапы работы с документами">
            <div className="document-flow-heading">
                <div><h2>От загрузки к результату</h2><p>Выберите этап, чтобы открыть нужную очередь.</p></div>
                <button aria-pressed={queue == 'all'} onClick={() => chooseQueue('all')}>Все документы · {documents.length}</button>
            </div>
            <div className="document-pipeline">
                {documentQueues.map(item => <button
                    key={item.id} className={'pipeline-stage ' + item.id}
                    aria-pressed={queue == item.id} onClick={() => chooseQueue(item.id)}
                >
                    <span>{item.title}</span>
                    <strong>{documents.filter(document => documentQueue(document) == item.id).length}</strong>
                    <small>{item.hint}</small>
                </button>)}
            </div>
            {nextDocument ? <div className="document-next">
                <div><p className="eyebrow">СЛЕДУЮЩИЙ ШАГ</p><h3>{nextStep(nextDocument, canReview)}</h3></div>
                <div className="next-file"><strong>{nextDocument.name}</strong><small>Обновлён {formatDate(nextDocument.updatedAt)}</small></div>
                <button onClick={openNext}>Открыть документ →</button>
            </div> : <div className="document-start">
                <strong>Начните с исходного файла</strong>
                <p>Загрузите документ ниже или откройте пример сметы. После обработки здесь появится очередь проверки.</p>
            </div>}
        </section>
        {uploadPanel}
        {uploading && <button onClick={() => void cancelUpload()}>Отменить загрузку</button>}
        {uploadNotice && <p role="status" className="muted">{uploadNotice}</p>}
        {!!connectionError && <p className="inline-error" role="alert">{connectionMessage}</p>}
        <section className="studio" ref={studioRef}>
            {list}
            {current && remote ? <DocumentPane
                key={current.id}
                document={current}
                remote={remote}
                ai={ai.state}
                aiReady={ai.ready}
                canReview={canReview}
                commands={commands}
                busy={busy}
            /> : placeholder}
        </section>
        <p className="muted" style={{marginTop: 16}}>
            Обработка CSV, TXT и текстового слоя PDF. Для сканов нужен отдельный OCR,
            нейросеть и платные запросы не используются.
        </p>
    </div>
}

// Отмена могла опоздать: сервис честно говорит, на какой стадии застал запрос.
function cancelNotice(status: string) {
    if (status == 'cancelled') return 'Загрузка отменена'
    if (status == 'committing') return 'Файл уже сохраняется. Дождитесь результата'
    return 'Файл уже сохранён'
}

type PaneProps = {
    document: DocumentMetadata,
    remote: ProcessorRemote,
    ai: AiRunStore | null,
    aiReady: boolean,
    canReview: boolean,
    commands: Commands,
    busy: boolean
}

function DocumentPane({document, remote, ai, aiReady, canReview, commands, busy}: PaneProps) {
    const action = useServiceAction(remote)
    const [processor, setProcessor] = useState<'node' | 'python' | 'model'>('node')
    const [tab, setTab] = useState<'table' | 'original' | 'history' | 'compare'>('table')
    const [loaded, setLoaded] = useState<{key: string, remote: ProcessorRemote, value: DocumentDetail} | null>(null)
    const [error, setError] = useState('')

    const key = JSON.stringify([document.id, document.revision])
    const active = useRef({key, remote})
    active.current = {key, remote}

    useEffect(function loadDocument() {
        let current = true
        setError('')
        const request = remote.control.detail({
            orgId: document.orgId,
            id: document.id,
            revision: document.revision
        })
        void request.then(function loadedDetail(value) {
            if (current) setLoaded({key, remote, value})
        }, function failed(reason) {
            if (current) setError(reason instanceof Error ? reason.message : String(reason))
        })
        return () => {current = false}
    }, [key, remote])

    // После размонтирования скачанный файл отдавать некуда: ключ обнуляем.
    useEffect(function cancelDownloadsOnUnmount() {
        return () => {active.current = {key: '', remote}}
    }, [])

    const detail = loaded?.key == key && loaded.remote == remote ? loaded.value : null
    const mine = ai ? Object.values(ai.runs).filter(item => item.resourceIds.includes(document.id)) : []
    const run = mine.sort((a, b) => b.createdAt - a.createdAt)[0]
    const running = document.status == 'processing'
    const disabled = busy || action.busy || !aiReady

    async function process() {
        await action.action(() => remote.ai.createRun({
            requestId: crypto.randomUUID(),
            kind: 'extract',
            resourceIds: [document.id],
            input: {
                orgId: document.orgId,
                documentId: document.id,
                revision: document.revision,
                processor
            }
        }))
    }
    async function download(format?: 'csv' | 'json') {
        const request = active.current
        await action.action(async function receive() {
            const file = format
                ? await remote.control.export({
                    orgId: document.orgId,
                    id: document.id,
                    revision: document.revision,
                    format
                })
                : await remote.control.download({orgId: document.orgId, id: document.id})
            if (active.current.key == request.key && active.current.remote == request.remote) {
                downloadFile(file)
            }
        })
    }

    const reference = {orgId: document.orgId, id: document.id, revision: document.revision}

    const processing = <div className="processing-card">
        <p>{running ? 'Обработка документа' : 'Извлечь данные из оригинала'}</p>
        <div className="row">
            <select
                aria-label="Обработчик документа"
                value={processor}
                disabled={disabled || running}
                onChange={event => setProcessor(event.target.value as 'node' | 'python' | 'model')}
            >
                <option value="node">Основной обработчик · Node</option>
                <option value="python" disabled={!document.name.toLowerCase().endsWith('.csv')}>
                    CSV · Python
                </option>
                <option value="model">Извлечение полей · подключаемый адаптер</option>
            </select>
            <button className="primary" disabled={disabled || running} onClick={() => void process()}>
                {document.attempt ? 'Обработать заново' : 'Обработать документ'}
            </button>
            {running && run && (
                <button
                    disabled={disabled}
                    onClick={() => void action.action(() => remote.ai.cancelRun(run.id, 'Отменено пользователем'))}
                >
                    Отменить
                </button>
            )}
        </div>
        {running && <>
            <progress value={run?.progress ?? 0} max={1}/>
            <div className="run-caption">
                <span>{run?.message ?? 'Готовим файл…'}</span>
                <span>{Math.round((run?.progress ?? 0) * 100)}%</span>
            </div>
        </>}
    </div>

    const origins = detail?.provenance && <details className="field-origins">
        <summary>
            Источники полей · {detail.provenance.demo ? 'тестовый результат' : detail.provenance.provider}
            {' '}· исходник v{detail.provenance.sourceVersion}
        </summary>
        <p>Происхождение исходного извлечения. Ручные правки сравнивайте с приведённой цитатой.</p>
        {detail.provenance.fields.map(field => (
            <div key={field.row + ':' + field.column}>
                <strong>
                    Строка {field.row + 1}, {detail.table.headers[field.column]} ·{' '}
                    {field.page ? 'страница ' + field.page : 'строка источника ' + field.line}
                </strong>
                <blockquote>{field.quote}</blockquote>
            </div>
        ))}
    </details>

    const sourcePane = detail && (detail.sourceType == 'pdf' ? <div className="pdf-note">
        <span>PDF</span>
        <p>В таблице — текст с номерами страниц. Это извлечение текстового слоя, без OCR.</p>
        <button onClick={() => setTab('original')}>Открыть оригинал</button>
    </div> : <pre>{detail.originalText}</pre>)

    const noTable = <div className="empty">
        <span className="empty-symbol">▦</span>
        <h3>Таблица появится после обработки</h3>
        <p>Оригинал уже сохранён. Запустите обработчик, чтобы проверить данные.</p>
    </div>

    const review = detail && <div className="review-split">
        <aside className="source-view compare-source">
            <header>ОРИГИНАЛ ДЛЯ СВЕРКИ</header>
            {sourcePane}
        </aside>
        <ReviewTable
            key={key}
            detail={detail}
            document={document}
            commands={commands}
            disabled={disabled || !canReview || document.status != 'review'}
        />
    </div>

    const original = detail && <>
        {detail.sourceType == 'pdf' ? <PdfOriginal
            remote={remote}
            orgId={document.orgId}
            id={document.id}
            revision={document.revision}
        /> : <div className="source-view">
            <header>НЕИЗМЕНЯЕМЫЙ ОРИГИНАЛ · UTF-8</header>
            <pre>{detail.originalText}</pre>
        </div>}
        <button style={{marginTop: 13}} disabled={disabled} onClick={() => void download()}>
            Скачать исходный файл ↓
        </button>
    </>

    const history = detail && <div className="history">
        {detail.comments.map((comment, index) => (
            <div className="history-item" key={'comment-' + index}>
                <span>✎</span>
                <div>
                    <strong>Строка {comment.row + 1}: {comment.text}</strong>
                    <small>{comment.by} · {formatDate(comment.at)}</small>
                </div>
            </div>
        ))}
        {detail.approvals.map((approval, index) => (
            <div className="history-item" key={'approval-' + index}>
                <span>✓</span>
                <div>
                    <strong>Подтверждена версия {approval.revision}</strong>
                    <small>{approval.by} · {formatDate(approval.at)}</small>
                </div>
            </div>
        ))}
        {!detail.comments.length && !detail.approvals.length && (
            <p className="empty">Комментарии и подтверждения появятся здесь.</p>
        )}
    </div>

    const footer = <footer className="review-footer">
        <p>
            {canReview
                ? 'Проверьте строки перед подтверждением.'
                : 'После обработки проверяющий подтвердит результат.'}
            <br/>Каждое исправление создаёт новую версию.
        </p>
        <div className="row">
            {canReview && document.status == 'review' && (
                <button
                    className="primary"
                    disabled={disabled || !detail}
                    onClick={() => void commands.run('documentApprove', reference)}
                >
                    Подтвердить документ ✓
                </button>
            )}
            {canReview && document.status == 'approved' && (
                <button disabled={disabled} onClick={() => void commands.run('documentReopen', reference)}>
                    Вернуть на проверку
                </button>
            )}
            {document.status == 'approved' && <div className="export-menu">
                <button disabled={disabled} onClick={() => void download('csv')}>CSV ↓</button>
                <button disabled={disabled} onClick={() => void download('json')}>JSON ↓</button>
            </div>}
        </div>
    </footer>

    const management = <details className="document-management">
        <summary>Управление документом</summary>
        <p style={{margin: '10px 0'}}>Удалённый документ исчезнет из рабочего списка.</p>
        <button
            className="danger"
            disabled={disabled}
            onClick={() => void commands.run('documentDelete', reference)}
        >
            Удалить документ
        </button>
    </details>

    function navigateTabs(event: React.KeyboardEvent<HTMLDivElement>) {
        const at = documentTabs.findIndex(item => item.id == tab)
        let next = at
        if (event.key == 'ArrowRight') next = (at + 1) % documentTabs.length
        else if (event.key == 'ArrowLeft') next = (at + documentTabs.length - 1) % documentTabs.length
        else if (event.key == 'Home') next = 0
        else if (event.key == 'End') next = documentTabs.length - 1
        else return
        event.preventDefault()
        setTab(documentTabs[next].id)
        event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus()
    }

    return <div className="document-work">
        <header className="document-top">
            <div>
                <h2>{document.name}</h2>
                <small>
                    Версия {document.revision} · {document.rowCount} строк ·{' '}
                    {formatDate(document.updatedAt)}
                </small>
            </div>
            <span className={'badge ' + document.status}>{statusLabels[document.status]}</span>
        </header>
        <div className="document-tabs" role="tablist" aria-label="Содержимое документа" onKeyDown={navigateTabs}>
            {documentTabs.map(item => (
                <button
                    role="tab"
                    id={'document-tab-' + item.id}
                    aria-controls="document-panel"
                    aria-selected={tab == item.id}
                    tabIndex={tab == item.id ? 0 : -1}
                    key={item.id}
                    onClick={() => setTab(item.id)}
                >
                    {item.title}
                </button>
            ))}
        </div>
        <div className="document-body" id="document-panel" role="tabpanel" aria-labelledby={'document-tab-' + tab} tabIndex={0}>
            {document.status == 'approved' && (
                <div className="approval-summary">✓ Документ подтверждён. Данные готовы к экспорту.</div>
            )}
            {document.status == 'uncertain' && (
                <p className="document-alert">
                    Обработка прервалась. Проверьте результат перед новым запуском.
                    Автоматического повтора нет.
                </p>
            )}
            {document.status != 'approved' && processing}
            {(error || action.error || document.error) && (
                <p className="inline-error" role="alert">{error || action.error || document.error}</p>
            )}
            {processor == 'model' && (
                <p className="document-alert">
                    По умолчанию — тестовый TXT «Поле: значение», без OCR и языковой модели.
                    Источники полей появятся после обработки.
                </p>
            )}
            {origins}
            {!detail && !error && <p className="empty">Загружаем актуальную версию…</p>}
            {detail && tab == 'table' && (detail.table.headers.length ? review : noTable)}
            {detail && tab == 'original' && original}
            {detail && tab == 'compare' && (
                <VersionComparison detail={detail} document={document} remote={remote}/>
            )}
            {detail && tab == 'history' && history}
            {footer}
            {canReview && !running && management}
        </div>
    </div>
}

type PdfProps = {remote: ProcessorRemote, orgId: string, id: string, revision: number}

function PdfOriginal({remote, orgId, id, revision}: PdfProps) {
    const [preview, setPreview] = useState<{remote: ProcessorRemote, id: string, revision: number, url: string} | null>(null)
    const [error, setError] = useState('')

    useEffect(function readPdf() {
        let active = true
        let url = ''
        setError('')
        void remote.control.download({orgId, id}).then(function received(file) {
            if (!active) return
            url = URL.createObjectURL(new Blob([new Uint8Array(file.bytes)], {type: 'application/pdf'}))
            setPreview({remote, id, revision, url})
        }, function failed(reason) {
            if (active) setError(reason instanceof Error ? reason.message : String(reason))
        })
        return () => {
            active = false
            if (url) URL.revokeObjectURL(url)
        }
    }, [remote, orgId, id, revision])

    const same = preview?.remote == remote && preview.id == id && preview.revision == revision
    const url = same ? preview.url : ''
    if (error) return <p className="inline-error" role="alert">{error}</p>
    if (!url) return <p className="empty">Загружаем исходный PDF…</p>

    return <div className="source-view">
        <header>ИСХОДНЫЙ PDF · ТЕКСТОВЫЙ СЛОЙ</header>
        <object
            data={url}
            type="application/pdf"
            className="pdf-preview"
            aria-label="Предпросмотр исходного PDF"
        >
            <p>Браузер не поддерживает встроенный просмотр PDF.</p>
        </object>
        <p className="pdf-link">
            <a href={url} target="_blank" rel="noreferrer">Открыть PDF в отдельной вкладке ↗</a>
        </p>
    </div>
}

type ReviewProps = {
    detail: DocumentDetail,
    document: DocumentMetadata,
    commands: Commands,
    disabled: boolean
}

function ReviewTable({detail, document, commands, disabled}: ReviewProps) {
    const [editing, setEditing] = useState(-1)
    const [values, setValues] = useState<string[]>([])
    const [comment, setComment] = useState('')

    async function save(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault()
        const done = await commands.run('documentRow', {
            orgId: document.orgId,
            id: document.id,
            revision: document.revision,
            index: editing,
            values,
            comment
        })
        if (!done) return
        setEditing(-1)
        setComment('')
    }
    function edit(index: number, row: string[]) {
        setEditing(index)
        setValues([...row])
        setComment('')
    }
    function change(column: number, value: string) {
        setValues(values.map((other, index) => index == column ? value : other))
    }

    const note = <div className="review-note">
        <label>Комментарий к исправлению
            <input
                maxLength={1000}
                placeholder="Что изменили и почему"
                value={comment}
                onChange={event => setComment(event.target.value)}
                disabled={disabled}
            />
        </label>
        <button type="button" disabled={disabled} onClick={() => setEditing(-1)}>Отмена</button>
        <button className="primary" disabled={disabled || !comment.trim()}>Сохранить строку</button>
    </div>

    return <form onSubmit={save}>
        <div className="row" style={{marginBottom: 12}}>
            <h3 className="grow" style={{margin: 0}}>Извлечённые данные</h3>
            <small>{detail.table.rows.length} строк · {detail.table.headers.length} колонок</small>
        </div>
        <div className="table-scroll">
            <table className="data-table">
                <thead>
                    <tr>
                        <th>#</th>
                        {detail.table.headers.map((title, index) => <th key={index}>{title}</th>)}
                        <th><span className="sr-only">Действия</span></th>
                    </tr>
                </thead>
                <tbody>
                    {detail.table.rows.map((row, index) => (
                        <tr key={index}>
                            <td>{index + 1}</td>
                            {row.map((value, column) => (
                                <td key={column}>
                                    {editing == index ? <input
                                        aria-label={detail.table.headers[column] + ', строка ' + (index + 1)}
                                        maxLength={1000}
                                        value={values[column] ?? ''}
                                        disabled={disabled}
                                        onChange={event => change(column, event.target.value)}
                                    /> : value}
                                </td>
                            ))}
                            <td>
                                {editing != index && (
                                    <button
                                        type="button"
                                        aria-label={'Исправить строку ' + (index + 1)}
                                        disabled={disabled}
                                        onClick={() => edit(index, row)}
                                    >
                                        Изменить
                                    </button>
                                )}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
        {editing >= 0 && note}
    </form>
}
