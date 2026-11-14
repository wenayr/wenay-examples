import type {TravelChatQuery} from '../src/assistant-contract.ts'
import type {SupplyDestination} from '../src/supply-contract.ts'
import {airportRoute} from './assistant-airports.ts'

const months = ['январ', 'феврал', 'март', 'апрел', 'ма[йяе]', 'июн', 'июл', 'август', 'сентябр', 'октябр', 'ноябр', 'декабр']
const monthPattern = months.join('|')
const placeAliases: Record<string, string> = {
    hurghada: 'хургад', sharm: 'шарм', rhodes: 'родос', phuket: 'пхукет', paphos: 'пафос', antalya: 'антал',
    mallorca: 'майорк', malaga: 'малаг', tenerife: 'тенериф|коста-адех', nice: 'ницц', dubai: 'дуба[ийяе]',
    bali: 'бали', tallinn: 'таллин', dublin: 'дублин', cork: 'корк', galway: 'голуэй',
}
const countryAliases: Record<string, string> = {
    'Египет': 'егип', 'Греция': 'грец', 'Таиланд': 'та[ий]ланд', 'Кипр': 'кипр', 'Турция': 'турци',
    'Испания': 'испан', 'Франция': 'франц', 'ОАЭ': 'оаэ|эмират', 'Индонезия': 'индонез', 'Ирландия': 'ирланд', 'Эстония': 'эстон',
}
const numberWords: Record<string, number> = {один: 1, два: 2, три: 3, четыре: 4, пять: 5, семь: 7, десять: 10, четырнадцать: 14}
const durationPattern = new RegExp(`(?:на\\s+)?(\\d{1,2}|${Object.keys(numberWords).join('|')})\\s*(ноч|дн|день|дней)`, 'u')
const dayMs = 86_400_000

function shift(today: string, days: number) {return new Date(Date.parse(today) + days * dayMs).toISOString().slice(0, 10)}
function iso(year: number, month: number, day: number) {return [year, String(month).padStart(2, '0'), String(day).padStart(2, '0')].join('-')}
function nextYear(month: number, today: string) {return Number(today.slice(0, 4)) + Number(month < Number(today.slice(5, 7)))}

function readDates(text: string, today: string) {
    const datedText = text.replace(/\d+(?:[ \u00a0]\d{3})*[.,]\d{1,2}\s*(?:€|евро|eur)/gu, '')
    const absolute = [...datedText.matchAll(/(?<!\d)(?:\d{4}-\d{2}-\d{2}|(\d{1,2})\.(\d{1,2})(?:\.(\d{4}))?)(?!\d)/g)].map(match => {
        if (!match[1]) return match[0]
        const month = Number(match[2])
        return iso(Number(match[3] ?? nextYear(month, today)), month, Number(match[1]))
    })
    if (absolute.length) return absolute
    const named = [...text.matchAll(new RegExp(`(?:(\\d{1,2})\\s*)?(${monthPattern})[а-яё]*(?:\\s+(20\\d{2}))?`, 'gu'))]
    if (named.length) {
        const dates = named.map(match => {
            const month = months.findIndex(pattern => new RegExp('^' + pattern).test(match[2])) + 1
            const year = Number(match[3] ?? nextYear(month, today))
            let day = /втор[а-яё]*\s+половин/.test(text) ? 15 : 1
            if (/кон(?:ца|ец|це)\s*$/.test(text.slice(0, match.index))) day = new Date(Date.UTC(year, month, 0)).getUTCDate()
            if (match[1]) day = Number(match[1])
            return {year, month, day, hasDay: Boolean(match[1])}
        })
        if (dates.length > 1) return dates.map(({year, month, day}) => iso(year, month, day))
        const [{year, month, day, hasDay}] = dates
        const range = text.slice(0, named[0].index).match(/(\d{1,2})\s*(?:[-–—]|по|до)\s*$/)
        if (range && hasDay) return [iso(year, month, Number(range[1])), iso(year, month, day)]
        const endDay = text.slice(named[0].index + named[0][0].length).match(/^\s*(?:по|до|[-–—])\s*(\d{1,2})(?![.\d])/u)
        if (endDay && hasDay) return [iso(year, month, day), iso(year, month, Number(endDay[1]))]
        if (hasDay) return [iso(year, month, day)]
        const last = /перв[а-яё]*\s+половин/.test(text) ? 15 : new Date(Date.UTC(year, month, 0)).getUTCDate()
        return [iso(year, month, day), iso(year, month, last)]
    }
    const after = text.match(/через\s+(\d{1,2})\s*(?:дн|ден)/)
    if (after) return [shift(today, Number(after[1]))]
    if (/послезавтра/.test(text)) return [shift(today, 2)]
    if (/завтра/.test(text)) return [shift(today, 1)]
    if (/через неделю/.test(text)) return [shift(today, 7)]
    if (/сегодня/.test(text)) return [today]
    return []
}

function readBudget(text: string, patch: Partial<TravelChatQuery>) {
    const amount = '(\\d+(?:[ \\u00a0]\\d{3})*(?:[.,]\\d{1,2})?)'
    const euros = (value: string) => Math.round(Number(value.replace(/\s/g, '').replace(',', '.')) * 100)
    const range = text.match(new RegExp(`от\\s+${amount}\\s*(?:€|евро|eur)?\\s*(?:до|[-–—])\\s*${amount}\\s*(?:€|евро|eur)`, 'u'))
    if (range) {
        patch.minTotal = euros(range[1])
        patch.maxTotal = euros(range[2])
        return
    }
    const quoted = text.match(new RegExp(`(от|до|бюджет(?:ом)?|не дороже|максимум)?\\s*${amount}\\s*(?:€|евро|eur)`, 'u'))
    const plain = text.match(new RegExp(`(?:бюджет(?:ом)?|дешевле|не дороже|до)\\s+${amount}(?:\\s*$|\\s+на (?:всех|двоих))`, 'u'))
    if (quoted) patch[quoted[1] === 'от' ? 'minTotal' : 'maxTotal'] = euros(quoted[2])
    else if (plain) patch.maxTotal = euros(plain[1])
}

type Interpretation = {patch: Partial<TravelChatQuery>, question?: string, clearDestination?: boolean}
export function interpretTravel(message: string, current: Partial<TravelChatQuery>, places: readonly SupplyDestination[], today: string): Interpretation {
    const text = message.toLowerCase().replaceAll('ё', 'е')
    const patch: Partial<TravelChatQuery> = {}
    const baseDate = current.kind === 'flights' ? current.flight?.departure : current.firstDeparture
    let dates = readDates(text, today)
    if (!dates.length && baseDate) {
        const range = text.match(/(?:с\s+)?(\d{1,2})\s*(?:по|[-–—])\s*(\d{1,2})(?:\s|$)/)
        const month = baseDate.slice(0, 7)
        if (range) dates = [range[1], range[2]].map(d => month + '-' + d.padStart(2, '0'))
        else if (/половин/.test(text)) {
            const end = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0)).getUTCDate()
            dates = /втор/.test(text) ? [month + '-15', month + '-' + end] : [month + '-01', month + '-15']
        }
    }
    const adults = text.match(/(\d+)\s*(?:взросл|человек|пассажир)/)
    if (adults) patch.adults = Number(adults[1])
    if (/на двоих|вдво[её]м|два взрослых/.test(text)) patch.adults = 2
    const duration = text.match(durationPattern)
    if (duration && !/через\s+$/.test(text.slice(0, duration.index))) {
        const length = Number(duration[1]) || numberWords[duration[1]]
        patch.nights = duration[2] === 'ноч' ? length : Math.max(1, length - 1)
    }
    if (/на неделю/.test(text)) patch.nights = 7
    const stars = text.match(/([0-5])\s*(?:\*|★|зв[её]зд)/)
    if (stars) patch.minStars = Number(stars[1])
    if (/\d\s*(?:₽|рубл|руб|usd|доллар|фунт|\$)/u.test(text)) return {patch, question: 'Бюджет поиска указывается в евро. Какую сумму использовать?'}
    readBudget(text, patch)
    if (/авиабилет|авиарейс|билет|перел[её]т|рейс|flights?|→|->|[a-z]{3}\s*[–—]\s*[a-z]{3}/i.test(text)) patch.kind = 'flights'
    else if (/пут[её]вк|пакет|\bтур\b|(?:^|\s)тур(?:ы|а|ом|\s|$)/u.test(text)) patch.kind = 'packages'
    else if (/только отел|каталог|справочник|без перелета|(?:найди|покажи|ищу)\s+(?:мне\s+)?(?:отел|гостиниц)/.test(text)) patch.kind = 'catalog'
    else if (/^(?:из\s+.+?\s+в\s+|(?:from\s+)?.+?\s+to\s+)|\p{L}\s*[–—]\s*\p{L}/iu.test(text)) patch.kind = 'flights'
    if ((patch.kind ?? current.kind) === 'flights') {
        const {flight, choices} = airportRoute(message, current)
        patch.airportChoices = choices
        if (dates[0]) flight[/обратно|возврат/.test(text) && dates.length === 1 ? 'returnDate' : 'departure'] = dates[0]
        if (dates[1]) flight.returnDate = dates[1]
        if (/в одну сторону|без обратного/.test(text)) flight.returnDate = null
        if (/без багажа|ручная кладь/.test(text)) flight.checkedBag = false
        else if (/багаж/.test(text)) flight.checkedBag = true
        if (patch.adults) flight.adults = patch.adults
        if (Object.keys(flight).length) patch.flight = flight
        return {patch}
    }
    if (dates.length) {
        patch.firstDeparture = dates[0]
        patch.lastDeparture = dates.at(-1)!
    }
    const resort = places.find(p => text.includes(p.id) || text.includes(p.name.toLowerCase()) ||
        (placeAliases[p.id] && new RegExp(placeAliases[p.id]).test(text)))
    if (resort) patch.destination = resort.id
    const phrase = message.match(/(?:отель|гостиниц[ау])\s+[«"]([^»"]{1,120})[»"]/iu)
    if (phrase) {
        patch.phrase = phrase[1]
        patch.kind = 'catalog'
    }
    if (!resort) {
        const country = places.find(p => countryAliases[p.country] && new RegExp(countryAliases[p.country]).test(text))?.country
        const choices = country ? places.filter(p => p.country === country) : []
        if (choices.length === 1) patch.destination = choices[0].id
        if (choices.length > 1 && !choices.some(p => p.id === current.destination)) {
            return {patch, question: `Какое направление выбрать? ${choices.map(p => p.name).join(' или ')}?`, clearDestination: true}
        }
    }
    return {patch}
}
