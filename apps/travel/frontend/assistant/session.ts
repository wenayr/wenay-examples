import {localStorageCache} from 'wenay-react2/persist'
import type {TravelChatQuery, TravelChatReply, TravelChatResult} from '../../src/assistant-contract.ts'
import {validDate} from '../directory-preferences.ts'

const storageKey = 'wenay.travel.assistant.v1'
const maxTurns = 6
export const maxMessage = 1200

type ConversationTurn = {question: string, answer: string, mode: TravelChatReply['mode'], answeredAt?: string}
export interface AssistantSession {
    turns: ConversationTurn[]
    context: Partial<TravelChatQuery>
    draft: string
    entry: string
    previousResult: TravelChatResult['kind'] | null
}

export function emptySession(context: Partial<TravelChatQuery> = {}, draft = '', entry = ''): AssistantSession {
    return {turns: [], context, draft: draft.slice(0, maxMessage), entry, previousResult: null}
}

function isTurn(value: unknown): value is ConversationTurn {
    return value !== null && typeof value === 'object'
        && (!('answeredAt' in value) || typeof value.answeredAt === 'string' && Number.isFinite(Date.parse(value.answeredAt)))
        && 'question' in value && typeof value.question === 'string' && value.question.length <= maxMessage
        && 'answer' in value && typeof value.answer === 'string' && value.answer.length <= 8000
        && 'mode' in value && (value.mode === 'local' || value.mode === 'openai')
}

function storedQuery(value: unknown): Partial<TravelChatQuery> {
    if (!value || typeof value !== 'object') return {}
    const current = value as Partial<TravelChatQuery>
    const clean: Partial<TravelChatQuery> = {}
    if (current.kind && ['packages', 'catalog', 'flights'].includes(current.kind)) clean.kind = current.kind
    if (typeof current.destination === 'string') clean.destination = current.destination.slice(0, 40)
    if (typeof current.phrase === 'string') clean.phrase = current.phrase.slice(0, 120)
    if (current.airportChoices && typeof current.airportChoices === 'object') {
        const choices: NonNullable<TravelChatQuery['airportChoices']> = {}
        for (const side of ['origin', 'destination'] as const) {
            const name = current.airportChoices[side]
            if (typeof name === 'string') choices[side] = name.slice(0, 120)
        }
        clean.airportChoices = choices
    }
    for (const key of ['firstDeparture', 'lastDeparture'] as const) if (validDate(current[key])) clean[key] = current[key]
    for (const key of ['nights', 'adults', 'minTotal', 'maxTotal', 'minStars'] as const) {
        if (Number.isSafeInteger(current[key])) clean[key] = current[key]
    }
    if (current.flight && typeof current.flight === 'object') {
        const flight: NonNullable<TravelChatQuery['flight']> = {}
        for (const key of ['origin', 'destination'] as const) {
            if (typeof current.flight[key] === 'string' && /^[A-Z]{3}$/.test(current.flight[key])) flight[key] = current.flight[key]
        }
        if (validDate(current.flight.departure)) flight.departure = current.flight.departure
        if (current.flight.returnDate === null || validDate(current.flight.returnDate)) flight.returnDate = current.flight.returnDate
        if (Number.isSafeInteger(current.flight.adults)) flight.adults = current.flight.adults
        if (typeof current.flight.checkedBag === 'boolean') flight.checkedBag = current.flight.checkedBag
        clean.flight = flight
    }
    return clean
}

export async function readSession(entry: string) {
    try {
        const data = await localStorageCache.get<AssistantSession>(storageKey)
        if (!data || !Array.isArray(data.turns)) return null
        if (entry && entry !== data.entry) return null
        const session = emptySession(storedQuery(data.context), typeof data.draft === 'string' ? data.draft : '', data.entry)
        session.turns = data.turns.slice(-maxTurns).filter(isTurn)
        if (['flights', 'catalog', 'packages'].includes(String(data.previousResult))) session.previousResult = data.previousResult
        return session
    } catch { /* The active conversation remains usable with browser storage disabled. */ }
    return null
}

export async function writeSession(value: AssistantSession) {
    try { await localStorageCache.set(storageKey, value) } catch { /* Disabled storage keeps the conversation in memory. */ }
}

export function addAnswer(state: AssistantSession, question: string, {message, mode, context, result}: TravelChatReply) {
    const turn: ConversationTurn = {question, answer: message, mode, answeredAt: new Date().toISOString()}
    return {...state, context, draft: '', turns: [...state.turns, turn].slice(-maxTurns), previousResult: result?.kind ?? null}
}
