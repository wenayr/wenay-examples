import React, {useEffect, useMemo, useRef, useState} from 'react'
import {useOwnedClient, useClientStore} from 'wenay-react2/react'
import type {SupportResources} from './contracts'
import type {PublishedArticle, PublishedIndex} from '../backend/published-contract'
import {useServiceAction} from '../shared/react/service-action'

export function ContentKnowledge({resources, orgId, disabled}: {resources: SupportResources, orgId: string, disabled: boolean}) {
    const owned = useOwnedClient({key: resources, create: () => ({...resources.open('content'), ready: Promise.resolve()})})
    const status = useClientStore(useMemo(() => owned.client ? {store: owned.client.status} : null, [owned.client]))
    const remote = status.state?.phase == 'ready' ? owned.client?.current()?.remote : null
    const action = useServiceAction(remote)
    const [items, setItems] = useState<PublishedIndex[] | null>(null), [article, setArticle] = useState<PublishedArticle | null>(null), [configured, setConfigured] = useState<boolean | null>(null)
    const [readAt, setReadAt] = useState(0)
    const guard = useRef({orgId, remote, mounted: true, request: 0})
    guard.current.orgId = orgId; guard.current.remote = remote
    useEffect(function mounted() {guard.current.mounted = true; return () => {guard.current.mounted = false}}, [])
    useEffect(function clear() {guard.current.request++; setItems(null); setArticle(null); setConfigured(null)}, [orgId, remote])
    function capture() {const request = ++guard.current.request; return () => guard.current.mounted && guard.current.request == request && guard.current.orgId == orgId && guard.current.remote == remote}
    async function refresh() {
        const current = capture(); setArticle(null); setItems(null)
        await action.action(async function list() {const value = await remote!.control.list(orgId); if (current()) {setConfigured(value.configured); setItems(value.articles)}})
    }
    async function read(slug: string) {
        const current = capture(); setArticle(null)
        await action.action(async function open() {const value = await remote!.control.read({orgId, slug}); if (current()) {setArticle(value); setReadAt(Date.now())}})
    }
    return <section className="content-knowledge"><div className="section-heading"><div><p className="eyebrow">ИЗ КОНТЕНТ-СТУДИИ</p><h2>Проверенные публикации</h2><p>Опубликованные материалы редакции, доступные только для чтения.</p></div><button disabled={disabled || !remote || action.busy} onClick={() => void refresh()}>{action.busy ? 'Загружаем…' : 'Обновить публикации'}</button></div>
        {action.error && <p className="inline-warning" role="alert">{action.error}</p>}
        {configured == false ? <p className="muted">Для этой команды контент-студия пока не подключена.</p> : items == null ? <p className="muted">Обновите список, чтобы получить текущие опубликованные версии.</p> : <div className="knowledge-layout"><div className="article-grid">{items.map(item => <button key={item.id} className={'article-card' + (article?.id == item.id ? ' active' : '')} disabled={disabled || !remote || action.busy} onClick={() => void read(item.slug)}><span className="article-status published">Опубликовано · v{item.version}</span><h3>{item.title}</h3><small>Открыть актуальную публикацию →</small></button>)}{!items.length && <p className="muted">Редакция ещё не опубликовала материалы.</p>}</div>
            {article && <article className="article-reader"><p className="eyebrow">РЕДАКЦИЯ · ВЕРСИЯ {article.version}</p><h2>{article.title}</h2>{article.blocks.map(block => block.kind == 'heading' ? <h3 key={block.id}>{block.text}</h3> : block.kind == 'quote' ? <blockquote key={block.id}>{block.text}</blockquote> : block.kind == 'button' ? <p key={block.id}><a href={block.href} target="_blank" rel="noreferrer">{block.text} ↗</a></p> : block.kind == 'image' ? <p key={block.id} className="muted">Иллюстрация: {block.text}</p> : <p key={block.id}>{block.text}</p>)}<small>Прочитано {new Date(readAt).toLocaleTimeString('ru-RU')}. При изменении публикации откройте её заново.</small></article>}
        </div>}
    </section>
}
