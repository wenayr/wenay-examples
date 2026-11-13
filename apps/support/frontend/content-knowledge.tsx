import React, {useEffect, useMemo, useRef, useState} from 'react'
import {useOwnedClient, useClientStore} from 'wenay-react2/react'
import type {SupportResources} from './contracts'
import type {PublishedArticle, PublishedIndex, PublishedBlock} from '../backend/published-contract'
import {useServiceAction} from '../shared/react/service-action'

type KnowledgeProps = {resources: SupportResources, orgId: string, disabled: boolean}

export function ContentKnowledge({resources, orgId, disabled}: KnowledgeProps) {
    const owned = useOwnedClient({
        key: resources,
        create: () => ({...resources.open('content'), ready: Promise.resolve()})
    })
    const status = useClientStore(useMemo(() => owned.client ? {store: owned.client.status} : null, [owned.client]))
    const remote = status.state?.phase == 'ready' ? owned.client?.current()?.remote : null
    const action = useServiceAction(remote)

    const [items, setItems] = useState<PublishedIndex[] | null>(null)
    const [article, setArticle] = useState<PublishedArticle | null>(null)
    const [configured, setConfigured] = useState<boolean | null>(null)
    const [readAt, setReadAt] = useState(0)

    const guard = useRef({orgId, remote, mounted: true, request: 0})
    guard.current.orgId = orgId
    guard.current.remote = remote

    useEffect(function mounted() {
        guard.current.mounted = true
        return () => {guard.current.mounted = false}
    }, [])
    useEffect(function clear() {
        guard.current.request++
        setItems(null)
        setArticle(null)
        setConfigured(null)
    }, [orgId, remote])

    // Каждый запрос получает номер: ответ применяется, только если он всё ещё последний.
    function capture() {
        const request = ++guard.current.request
        return function actual() {
            if (!guard.current.mounted || guard.current.request != request) return false
            return guard.current.orgId == orgId && guard.current.remote == remote
        }
    }

    async function refresh() {
        const current = capture()
        setArticle(null)
        setItems(null)
        await action.action(async function list() {
            const value = await remote!.control.list(orgId)
            if (!current()) return
            setConfigured(value.configured)
            setItems(value.articles)
        })
    }
    async function read(slug: string) {
        const current = capture()
        setArticle(null)
        await action.action(async function open() {
            const value = await remote!.control.read({orgId, slug})
            if (!current()) return
            setArticle(value)
            setReadAt(Date.now())
        })
    }

    function block(value: PublishedBlock) {
        if (value.kind == 'heading') return <h3 key={value.id}>{value.text}</h3>
        if (value.kind == 'quote') return <blockquote key={value.id}>{value.text}</blockquote>
        if (value.kind == 'button') {
            return <p key={value.id}>
                <a href={value.href} target="_blank" rel="noreferrer">{value.text} ↗</a>
            </p>
        }
        if (value.kind == 'image') {
            return <p key={value.id} className="muted">Иллюстрация: {value.text}</p>
        }
        return <p key={value.id}>{value.text}</p>
    }

    const reader = article && <article className="article-reader">
        <p className="eyebrow">РЕДАКЦИЯ · ВЕРСИЯ {article.version}</p>
        <h2>{article.title}</h2>
        {article.blocks.map(block)}
        <small>
            Прочитано {new Date(readAt).toLocaleTimeString('ru-RU')}.
            При изменении публикации откройте её заново.
        </small>
    </article>

    const catalogue = items && <div className="knowledge-layout">
        <div className="article-grid">
            {items.map(item => (
                <button
                    key={item.id}
                    className={'article-card' + (article?.id == item.id ? ' active' : '')}
                    disabled={disabled || !remote || action.busy}
                    onClick={() => void read(item.slug)}
                >
                    <span className="article-status published">Опубликовано · v{item.version}</span>
                    <h3>{item.title}</h3>
                    <small>Открыть актуальную публикацию →</small>
                </button>
            ))}
            {!items.length && <p className="muted">Редакция ещё не опубликовала материалы.</p>}
        </div>
        {reader}
    </div>

    const hint = <p className="muted">Обновите список, чтобы получить текущие опубликованные версии.</p>
    const missing = <p className="muted">Для этой команды контент-студия пока не подключена.</p>

    let body: React.ReactNode = hint
    if (configured == false) body = missing
    else if (items) body = catalogue

    return <section className="content-knowledge">
        <div className="section-heading">
            <div>
                <p className="eyebrow">ИЗ КОНТЕНТ-СТУДИИ</p>
                <h2>Проверенные публикации</h2>
                <p>Опубликованные материалы редакции, доступные только для чтения.</p>
            </div>
            <button disabled={disabled || !remote || action.busy} onClick={() => void refresh()}>
                {action.busy ? 'Загружаем…' : 'Обновить публикации'}
            </button>
        </div>
        {action.error && <p className="inline-warning" role="alert">{action.error}</p>}
        {body}
    </section>
}
