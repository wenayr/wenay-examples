import type {TravelChatQuery, TravelChatReply} from '../src/assistant-contract.ts'
import {findAirports} from './flights/airports.ts'

type Side = 'origin' | 'destination'
type Names = Partial<Record<Side, string>>
const sides = ['origin', 'destination'] as const
const aliases: Record<string, string> = {
    TLL: 'таллин', RIX: 'риг[ауеи]', HEL: 'хельсинки', HRG: 'хургад', SSH: 'шарм', RHO: 'родос',
    HKT: 'пхукет', AYT: 'антал', DUB: 'дублин',
}
const localNames: Record<string, string> = {париж: 'Paris', дуба: 'Dubai', лондон: 'London'}
const stop = /(?:\d{4}-\d{2}-\d{2}|\d{1,2}[./]\d{1,2}|\d+\s+(?:янв|фев|мар|апр|мая|июн|июл|авг|сен|окт|ноя|дек)|(?:^|\s)(?:на\s|завтра|послезавтра|сегодня|через\s|с\s+багаж|без\s+багаж|обратно|туда-обратно|tomorrow|today|on\s+\d|for\s+\d))/iu

function name(text: string) {
    return text.split(stop)[0].replace(/^(?:(?:найди|покажи|хочу|авиа)?билет\S*|авиарейс\S*|рейс\S*|перел[её]т\S*|flights?|аэропорт\S*|штат\S*)\s+/giu, '')
        .replace(/^[\s,;:]+|[\s,;:.?!]+$/g, '').trim().slice(0, 100)
}
function readNames(message: string, choices: Names): Names {
    const route = message.trim().replace(/^(?:(?:найди|покажи|ищу|нужны|хочу)\s+)?(?:авиабилет\S*|билет\S*|авиарейс\S*|рейс\S*|перел[её]т\S*|flights?)\s*/iu, '')
    const arrow = route.match(/^(.+?)\s*(?:→|->|[–—]|\s-\s)\s*(.+)$/u)
    const pair = arrow ?? route.match(/^(?:из\s+|from\s+)?(.+?)\s+(?:в|до|to)\s+(.+)$/iu)
    if (pair) return {origin: name(pair[1].replace(/^(?:из|from)\s+/iu, '')), destination: name(pair[2])}
    const from = route.match(/^(?:из|from)\s+(.+)$/iu)
    if (from) return {origin: name(from[1])}
    const to = route.match(/^(?:в|до|to)\s+(.+)$/iu)
    if (to) return {destination: name(to[1])}
    const codes = route.match(/^([a-z]{3})[\s/-]+([a-z]{3})(?=$|[\s,])/i)
    if (codes) return {origin: codes[1], destination: codes[2]}
    const pending = sides.find(side => choices[side] !== undefined)
    const point = name(route)
    if (point && (pending || /^[a-z]{3}$/i.test(point))) return {[pending ?? 'destination']: point}
    if (point && route !== message.trim()) return {destination: point}
    return {}
}
function codeFor(input: string) {
    const code = input.match(/^(?:[A-Za-z]{3})$|\(([A-Za-z]{3})\)/)
    if (code) return {code: (code[1] || code[0]).toUpperCase()}
    const query = input.toLocaleLowerCase('ru-RU')
    const english = Object.entries(localNames).find(([stem]) => query.startsWith(stem))?.[1]
    const airports = findAirports(english ?? query, 5)
    const matches = airports.filter(a => !/\bheliport\b/i.test(a.name))
    if (matches.length === 1) return {code: matches[0].iata}
    if (!matches.length) {
        const known = Object.entries(aliases).find(([, pattern]) => new RegExp('^' + pattern, 'u').test(query))
        if (known) return {code: known[0]}
    }
    return {matches}
}
export function airportRoute(message: string, current: Partial<TravelChatQuery>) {
    const choices = {...current.airportChoices}
    const names = readNames(message, choices)
    const flight: NonNullable<TravelChatQuery['flight']> = {}
    for (const side of sides) {
        if (!names[side]) continue
        const result = codeFor(names[side]!)
        if (result.code) {
            flight[side] = result.code
            delete choices[side]
        }
        else choices[side] = names[side]
    }
    return {flight, choices}
}
export function airportQuestion(choices?: Names): Pick<TravelChatReply, 'message' | 'airportOptions'> | undefined {
    const side = sides.find(side => choices?.[side])
    if (!side || !choices?.[side]) return
    const query = choices[side]!
    const {matches = []} = codeFor(query)
    const action = side === 'origin' ? 'вылета' : 'прилёта'
    const options = matches.slice(0, 4).map(a => `${a.iata} (${a.name})`).join(', ')
    const detail = options || 'Введите название города или трёхбуквенный код IATA.'
    return {message: `Уточните аэропорт ${action} для «${query}». ${detail}`, airportOptions: {side, query}}
}
