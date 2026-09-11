import React, {useEffect, useMemo, useRef, useState} from 'react'
import {useOwnedClient, useClientStore} from 'wenay-react2/react'
import type {ConversationPage} from '../backend/conversation-resource'
import {Avatar, dateLabel, type SupportResources} from './contracts'
import {useServiceAction} from '../shared/react/service-action'

type HistoryProps = {
    resources: SupportResources,
    orgId: string,
    ticketId: string,
    firstId: string,
    count: number,
    name: (account: string) => string
}

export function ConversationHistory({resources, orgId, ticketId, firstId, count, name}: HistoryProps) {
    const owned = useOwnedClient({
        key: resources,
        create: () => ({...resources.open('conversation'), ready: Promise.resolve()})
    })
    const status = useClientStore(useMemo(() => owned.client ? {store: owned.client.status} : null, [owned.client]))
    const remote = status.state?.phase == 'ready' ? owned.client?.current()?.remote : null
    const action = useServiceAction(remote)

    const [query, setQuery] = useState('')
    const [appliedQuery, setAppliedQuery] = useState('')
    const [page, setPage] = useState<ConversationPage | null>(null)
    const [searching, setSearching] = useState(false)
    const current = useRef({mounted: true, remote})
    current.current.remote = remote

    useEffect(function mount() {
        current.current.mounted = true
        return () => {current.current.mounted = false}
    }, [])
    useEffect(function reset() {
        setPage(null)
        setSearching(false)
        setAppliedQuery('')
    }, [remote])

    // Дозагрузка продолжает уже применённый запрос, новая — начинается с поля ввода.
    function termOf(search: boolean, more: boolean) {
        if (!search) return ''
        return more ? appliedQuery : query
    }
    function cursorOf(search: boolean, more: boolean) {
        if (more) return page?.nextBeforeId ?? ''
        return search ? '' : firstId
    }

    async function load(search: boolean, more = false) {
        if (!remote) return
        const term = termOf(search, more)
        const beforeId = cursorOf(search, more)
        if (!more) setPage(null)
        await action.action(async function read() {
            const result = await remote.control.page({orgId, ticketId, beforeId, query: term, limit: 20})
            if (!current.current.mounted || current.current.remote != remote) return
            setPage(function merged(previous) {
                const earlier = more && previous ? [...result.messages, ...previous.messages] : result.messages
                return {...result, messages: earlier}
            })
            setSearching(search)
            setAppliedQuery(term)
        })
    }
    function submit(event: React.FormEvent) {
        event.preventDefault()
        void load(true)
    }
    function collapse() {
        setPage(null)
        setSearching(false)
    }

    const results = page && <>
        <p className="muted">
            {searching ? 'Результаты поиска: ' + page.total : 'Ранее в переписке'}
        </p>
        {page.nextBeforeId && (
            <button disabled={!remote || action.busy} onClick={() => void load(searching, true)}>
                Ещё предыдущие сообщения
            </button>
        )}
        {!page.messages.length && <p>Подходящих сообщений нет.</p>}
        {page.messages.map(message => (
            <article key={message.id} className={'message' + (message.private ? ' private-note' : '')}>
                <div className="message-meta">
                    <Avatar name={name(message.author)} small/>
                    <strong>{name(message.author)}</strong>
                    {message.private && <span>Заметка команде</span>}
                    <time>{dateLabel(message.at)}</time>
                </div>
                <p>{message.body}</p>
            </article>
        ))}
        <button onClick={collapse}>Свернуть историю</button>
    </>

    return <section className="history-panel" aria-label="Архив переписки">
        <form className="history-search" onSubmit={submit}>
            <label>Поиск в истории
                <input
                    value={query}
                    onChange={event => setQuery(event.target.value)}
                    maxLength={200}
                    placeholder="Слова из сообщения"
                />
            </label>
            <button disabled={!remote || action.busy || !query.trim()}>Найти в переписке</button>
        </form>
        {!page && count > 20 && (
            <button disabled={!remote || action.busy} onClick={() => void load(false)}>
                Показать предыдущие сообщения · {count - 20}
            </button>
        )}
        {action.error && <p role="alert">{action.error}</p>}
        {results}
    </section>
}
