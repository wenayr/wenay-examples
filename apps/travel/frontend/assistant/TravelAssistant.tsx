import {useEffect, useRef, useState, type FormEvent} from 'react'
import type {TravelChatQuery, TravelChatReply, TravelChatRequest} from '../../src/assistant-contract.ts'
import type {FlightQuery} from '../../src/flight-contract.ts'
import type {SupplyDestination} from '../../src/supply-contract.ts'
import {packageMaxTotal} from '../../src/package-contract.ts'
import {Icon} from '../Icons.tsx'
import {directoryUrl, useDirectoryQuery} from '../directory-query.ts'
import {shiftDate, validDate} from '../directory-preferences.ts'
import {photo} from '../presentation.ts'
import {costText, dateText, Options, type AssistantSearch} from './Options.tsx'
import {ChoiceOfAirport} from './ChoiceOfAirport.tsx'
import {addAnswer, emptySession, maxMessage, readSession, writeSession, type AssistantSession} from './session.ts'
import './assistant.css'

export type {AssistantSearch} from './Options.tsx'

interface AssistantProps {
    initialMessage?: string
    initialContext?: Partial<TravelChatQuery>
    onApply: (action: AssistantSearch) => void
}

const modes = {packages: 'Пакетный тур', catalog: 'Отели', flights: 'Авиабилеты'} as const
const services = {local: 'Локальный подбор', openai: 'Подбор с OpenAI'} as const satisfies Record<TravelChatReply['mode'], string>
const answerTime = new Intl.DateTimeFormat('ru-RU', {day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'})

function summary(query: Partial<TravelChatQuery>, places: SupplyDestination[]) {
    const details: [string, string][] = []
    if (query.kind && Object.hasOwn(modes, query.kind)) details.push(['Ищем', modes[query.kind]])
    if (query.kind === 'flights') {
        const {origin, destination, departure, returnDate, adults, checkedBag} = query.flight ?? {}
        const from = query.airportChoices?.origin || origin
        const to = query.airportChoices?.destination || destination
        if (from || to) details.push(['Маршрут', [from, to].map(part => part || '…').join(' → ')])
        if (departure) details.push(['Туда', dateText(departure)])
        if (returnDate) details.push(['Обратно', dateText(returnDate)])
        if (adults) details.push(['Взрослых', String(adults)])
        if (checkedBag) details.push(['Багаж', 'Сдаваемый багаж'])
        return details
    }
    if (query.destination) details.push(['Куда', places.find(p => p.id === query.destination)?.name || query.destination])
    if (query.kind === 'catalog' && query.phrase) details.push(['Отель', query.phrase])
    if (query.firstDeparture) {
        const last = query.lastDeparture && query.lastDeparture !== query.firstDeparture && query.kind !== 'catalog'
            ? ' — ' + dateText(query.lastDeparture) : ''
        details.push([query.kind === 'catalog' ? 'Заезд' : 'Вылет', dateText(query.firstDeparture) + last])
    }
    if (query.nights) details.push(['Ночей', String(query.nights)])
    if (query.adults) details.push(['Взрослых', String(query.adults)])
    if (query.kind === 'catalog') return details
    const min = query.minTotal ? 'от ' + costText(query.minTotal) : ''
    const max = query.maxTotal != null && query.maxTotal < packageMaxTotal ? 'до ' + costText(query.maxTotal) : ''
    if (min || max) details.push(['Бюджет группы', [min, max].filter(Boolean).join(' ')])
    if (query.minStars) details.push(['Категория отеля', 'от ' + query.minStars + ' ★'])
    return details
}

function starterPrompts() {
    const day = shiftDate(new Date().toISOString().slice(0, 10), 21)
    return [
        {label: 'Тур на двоих', text: 'Тур в Хургаду с ' + day + ' по ' + shiftDate(day, 6) + ' на 7 ночей, 2 взрослых, до 2500 евро.'},
        {label: 'Отели на Пхукете', text: 'Покажи каталог отелей на Пхукете.'},
        {label: 'Перелёт из Техаса', text: 'Авиабилеты из Техаса в Токио ' + day + ', в одну сторону, 1 взрослый.'},
    ]
}

function unresolvedAirport(query: Partial<TravelChatQuery>): TravelChatReply['airportOptions'] {
    if (query.kind !== 'flights') return
    for (const side of ['origin', 'destination'] as const) {
        const name = query.airportChoices?.[side]
        if (name) return {side, query: name}
    }
    for (const side of ['origin', 'destination'] as const) {
        if (!query.flight?.[side]) return {side, query: ''}
    }
}

function savedSearch(session: AssistantSession): AssistantSearch | undefined {
    const kind = session.previousResult
    if (kind === 'catalog' || kind === 'packages') return {kind, query: session.context}
    const flight = session.context.flight
    if (kind !== 'flights') return
    if (!flight?.origin || !flight.destination || !validDate(flight.departure)) return
    const query: FlightQuery = {origin: flight.origin, destination: flight.destination, departure: flight.departure,
        returnDate: flight.returnDate ?? null, adults: flight.adults ?? 1, checkedBag: flight.checkedBag ?? false}
    return {kind, query}
}

async function requestReply(body: TravelChatRequest, signal: AbortSignal): Promise<TravelChatReply> {
    let response: Response
    try {
        response = await fetch(import.meta.env.BASE_URL + 'api/travel/chat', {
            method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(body), signal,
        })
    } catch {
        throw new Error('Связаться с помощником не удалось. Проверьте соединение и повторите запрос.')
    }
    const reply = await response.json().catch(() => null)
    if (!response.ok) throw new Error(typeof reply?.error === 'string' ? reply.error : 'Сервис подбора временно недоступен.')
    if (!reply || typeof reply.message !== 'string' || !Object.hasOwn(services, reply.mode)) {
        throw new Error('Помощник вернул неполный ответ. Повторите запрос.')
    }
    return reply as TravelChatReply
}

export function TravelAssistant({initialMessage = '', initialContext, onApply}: AssistantProps) {
    const [session, setSession] = useState<AssistantSession | null>(null)
    const [reply, setReply] = useState<TravelChatReply | null>(null)
    const [pending, setPending] = useState('')
    const [error, setError] = useState('')
    const active = useRef<AbortController | null>(null)
    const composer = useRef<HTMLTextAreaElement>(null)
    const latest = useRef<HTMLDivElement>(null)
    const places = useDirectoryQuery<{destinations: SupplyDestination[]}>(directoryUrl('destinations'))
    const entry = initialMessage || initialContext ? JSON.stringify([initialMessage, initialContext]) : ''
    useEffect(() => {
        let current = true
        setSession(null)
        void readSession(entry).then(value => { if (current) setSession(value ?? emptySession(initialContext, initialMessage, entry)) })
        setReply(null)
        setPending('')
        setError('')
        return () => {
            current = false
            active.current?.abort()
            active.current = null
        }
    }, [entry])
    useEffect(() => { if (session) void writeSession(session) }, [session])
    useEffect(() => { if (reply) latest.current?.scrollIntoView({block: 'nearest'}) }, [reply])

    function setDraft(text: string) {
        setSession(old => old && {...old, draft: text})
        setError('')
    }
    async function submit(question: string) {
        const message = question.trim()
        if (!session || active.current) return
        if (!message || message.length > maxMessage) return
        const controller = new AbortController()
        active.current = controller
        setPending(message)
        setError('')
        const timeout = setTimeout(() => controller.abort('timeout'), 60_000)
        try {
            const answer = await requestReply({message, context: session.context}, controller.signal)
            if (controller.signal.aborted) return
            setReply(answer)
            setSession(old => old && addAnswer(old, message, answer))
        } catch (problem) {
            if (active.current === controller) setError(controller.signal.reason === 'timeout' ? 'Ответ занял слишком много времени. Запрос можно повторить.'
                : problem instanceof Error ? problem.message : 'Не удалось получить ответ.')
        } finally {
            clearTimeout(timeout)
            if (active.current === controller) {
                active.current = null
                setPending('')
            }
        }
    }
    function startOver() {
        setSession(emptySession({}, '', entry))
        setReply(null)
        setError('')
        composer.current?.focus()
    }
    function send(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        void submit(session?.draft || '')
    }
    const criteria = summary(session?.context || {}, places.data?.destinations ?? [])
    const restoreAction = !reply && session ? savedSearch(session) : undefined
    const airportOptions = reply?.airportOptions ?? unresolvedAirport(session?.context ?? {})
    return <main className="travel-home assistant-home">
        <header className="assistant-heading"><h1>Помощник по поездке</h1>
            <p>Подберите тур, найдите отель на карте или проверьте перелёт. Даты и бюджет можно уточнить в разговоре.</p></header>
        <div className="assistant-layout">
            <section className="assistant-dialogue" aria-label="Диалог о поездке">
                {session?.turns.length ? <>
                    <div className="assistant-toolbar"><span>Ваш диалог</span><button type="button" disabled={!!pending} onClick={startOver}>Начать заново</button></div>
                    <div className="assistant-history">
                        {session.turns.map((turn, index) => <div className="assistant-turn" key={index}
                            ref={index === session.turns.length - 1 ? latest : undefined}>
                            <div className="assistant-question"><span>Вы</span><p>{turn.question}</p></div>
                            <div className="assistant-answer"><span><Icon name="compass" size={15}/>{services[turn.mode]}
                                {turn.answeredAt && <time dateTime={turn.answeredAt}>{answerTime.format(new Date(turn.answeredAt))}</time>}
                            </span><p>{turn.answer}</p></div>
                        </div>)}
                    </div>
                    {airportOptions && <ChoiceOfAirport key={airportOptions.side + ':' + airportOptions.query}
                        options={airportOptions} busy={!!pending} onChoose={code => {
                            const direction = airportOptions.side === 'origin' ? 'из ' : 'в '
                            void submit(direction + code)
                        }}/>}
                    {reply?.result && <Options result={reply.result} query={reply.context} onApply={onApply}/>}
                    {restoreAction && <button type="button" className="assistant-refresh" onClick={() => onApply(restoreAction)}>
                        Открыть поиск с сохранёнными условиями <Icon name="arrow" size={14}/></button>}
                </> : <div className="assistant-intro">
                    <span className="assistant-symbol"><Icon name="compass" size={26}/></span>
                    <h2>Какую поездку планируете?</h2>
                    <p>Начните со своего запроса или возьмите пример и измените его под себя.</p>
                    <div className="assistant-prompts">{starterPrompts().map(item => <button key={item.label} type="button" disabled={!session || !!pending}
                        onClick={() => {
                            setDraft(item.text)
                            composer.current?.focus()
                        }}>{item.label} <Icon name="arrow" size={14}/></button>)}</div>
                </div>}
                <form className="assistant-compose" onSubmit={send}>
                    <label htmlFor="travel-assistant-message">{session?.turns.length ? 'Уточнить пожелания' : 'Ваш запрос'}</label>
                    <textarea id="travel-assistant-message" ref={composer} rows={3} maxLength={maxMessage}
                        value={session?.draft || ''} disabled={!session || !!pending} placeholder="Куда, когда и с кем вы хотите поехать?"
                        onChange={event => setDraft(event.target.value)} onKeyDown={event => {
                            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) event.currentTarget.form?.requestSubmit()
                        }}/>
                    <div className="assistant-send-row"><span role="status">{pending ? 'Подбираем варианты…' : ''}</span>
                        <button type="submit" className="assistant-primary" disabled={!session?.draft.trim() || !!pending}>
                            Отправить <Icon name="arrow" size={16}/></button></div>
                    {error && <p className="assistant-error" role="alert">{error}</p>}
                </form>
            </section>
            <aside className="assistant-itinerary" aria-label="Параметры поездки">
                <h2>Параметры поездки</h2>
                {!!criteria.length && <dl>{criteria.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>}
                {!criteria.length && <><p>Здесь появятся направление, даты и другие условия вашего запроса.</p>
                    <figure><img src={photo('hurghada')} alt="Макади-Бей на побережье Красного моря"/>
                        <figcaption><span>Макади-Бей, Египет</span><a href={import.meta.env.BASE_URL + 'images/credits.html'}>Фото</a></figcaption></figure></>}
                {criteria.length > 0 && <button type="button" className="assistant-edit" disabled={!!pending} onClick={() => {
                    composer.current?.focus()
                    composer.current?.scrollIntoView({block: 'nearest'})
                }}>Изменить в диалоге <Icon name="arrow" size={14}/></button>}
            </aside>
        </div>
    </main>
}
