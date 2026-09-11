import React, {useEffect, useState} from 'react'
import type {Block} from '../backend/model'
import type {PublishedPage} from '../backend/domain'
import {PrivateImage} from './media'
import {date, type Resources} from './contracts'

type ArticleProps = {title: string, blocks: Block[], orgId: string, resources?: Resources}

export function Article({title, blocks, orgId, resources}: ArticleProps) {
    // Внутри кабинета изображение читается через ресурс, в публичном выпуске — по адресу.
    function image(block: Block) {
        if (resources) {
            return <PrivateImage resources={resources} orgId={orgId} id={block.assetId} alt={block.text}/>
        }
        const source = '/api/content/public/' + encodeURIComponent(orgId)
            + '/images/' + encodeURIComponent(block.assetId)
        return <img src={source} alt={block.text}/>
    }

    function render(block: Block) {
        if (block.kind == 'heading') return <h2 key={block.id}>{block.text}</h2>
        if (block.kind == 'quote') return <blockquote key={block.id}>{block.text}</blockquote>
        if (block.kind == 'button') {
            return <p key={block.id}>
                <a className="article-link" href={block.href} target="_blank" rel="noreferrer">
                    {block.text} ↗
                </a>
            </p>
        }
        if (block.kind == 'image') {
            return <figure key={block.id}>
                {image(block)}
                <figcaption>{block.text}</figcaption>
            </figure>
        }
        return <p key={block.id}>{block.text}</p>
    }

    return <article className="article">
        <h1>{title}</h1>
        {blocks.map(render)}
    </article>
}

type JournalProps = {orgId: string, initialSlug?: string, revisionKey?: string}

type IndexItem = {id: string, slug: string, title: string, version: number}

export function PublicJournal({orgId, initialSlug = '', revisionKey = ''}: JournalProps) {
    const [slug, setSlug] = useState(initialSlug)
    const [reload, setReload] = useState(0)
    const [list, setList] = useState<{key: string, items: IndexItem[]} | null>(null)
    const [loaded, setLoaded] = useState<{key: string, page: PublishedPage} | null>(null)
    const [error, setError] = useState('')
    const key = orgId + ':' + slug + ':' + revisionKey + ':' + reload

    useEffect(function loadPublication() {
        const controller = new AbortController()
        setLoaded(null)
        setList(null)
        setError('')
        async function read() {
            const base = '/api/content/public/' + encodeURIComponent(orgId)
            const address = base + (slug ? '/' + encodeURIComponent(slug) : '')
            const response = await fetch(address, {signal: controller.signal, cache: 'no-store'})
            if (!response.ok) throw new Error('Материал снят с публикации или временно недоступен')
            const data = await response.json()
            if (controller.signal.aborted) return
            if (slug) setLoaded({key, page: data})
            else setList({key, items: data.pages})
        }
        void read().catch(function failed(reason) {
            if (controller.signal.aborted) return
            setError(reason instanceof Error ? reason.message : String(reason))
        })
        return () => controller.abort()
    }, [key])

    const failure = <section className="empty">
        <h1>Эта история пока недоступна</h1>
        <p role="alert">{error}</p>
        <button onClick={() => setSlug('')}>К другим историям</button>
    </section>

    const page = loaded?.key == key ? <>
        <p className="public-meta">
            РЕДАКЦИЯ · {date(loaded.page.publishedAt)} · ВЫПУСК {loaded.page.version}
        </p>
        <Article title={loaded.page.title} blocks={loaded.page.blocks} orgId={orgId}/>
    </> : <p className="empty">Открываем опубликованную историю…</p>

    let index = <p>Проверяем свежие публикации…</p>
    if (list?.key == key) {
        index = list.items.length ? <>{list.items.map(function entry(item, position) {
            return <button key={item.id} onClick={() => setSlug(item.slug)}>
                <span>{String(position + 1).padStart(2, '0')}</span>
                <h2>{item.title}</h2>
                <small>Читать историю →</small>
            </button>
        })}</> : <p>Новые истории скоро появятся здесь.</p>
    }

    const catalogue = <section className="journal-index">
        <p className="eyebrow">ВЫПУСКИ РЕДАКЦИИ</p>
        <h1>Есть что рассказать.</h1>
        <p>Истории, заметки и мысли нашей команды.</p>
        <div>{index}</div>
    </section>

    function home(event: React.MouseEvent) {
        event.preventDefault()
        setSlug('')
    }

    let body = catalogue
    if (error) body = failure
    else if (slug) body = page

    return <div className="public-journal">
        <header>
            <a href="#" onClick={home}>Folio<span>JOURNAL</span></a>
            <span>Хорошие истории остаются с нами.</span>
            <button onClick={() => setReload(value => value + 1)}>Обновить</button>
        </header>
        {body}
        <footer>Folio Journal · Написано людьми, для людей.</footer>
    </div>
}
