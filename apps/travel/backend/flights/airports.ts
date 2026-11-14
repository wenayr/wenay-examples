import {readFileSync} from 'node:fs'
import {gunzipSync} from 'node:zlib'
import type {FlightAirport} from '../../src/airport-contract.ts'

type AirportRow = [string, string, string, string, string, string, string, number, string]
const aliases = new Map(Object.entries({
    техас: 'texas', техаса: 'texas', техасе: 'texas', техасу: 'texas', токио: 'tokyo', япония: 'japan', японии: 'japan',
    даллас: 'dallas', далласа: 'dallas', далласе: 'dallas', остин: 'austin', остина: 'austin', остине: 'austin',
    хьюстон: 'houston', хьюстона: 'houston', хьюстоне: 'houston', сша: 'united states', дубай: 'dubai', дубая: 'dubai',
    таллинн: 'tallinn', таллин: 'tallinn', таллина: 'tallinn', таллинна: 'tallinn', таллине: 'tallinn', таллинне: 'tallinn',
    лондон: 'london', лондона: 'london', париж: 'paris', парижа: 'paris', рим: 'rome', рима: 'rome',
    берлин: 'berlin', москва: 'moscow', москвы: 'moscow', стамбул: 'istanbul', бангкок: 'bangkok',
    пхукет: 'phuket', хургада: 'hurghada', хургаду: 'hurghada', хельсинки: 'helsinki', рига: 'riga', риги: 'riga',
    'даллас форт уэрт': 'dallas fort worth', 'нью йорк': 'new york', 'лос анджелес': 'los angeles', 'сан франциско': 'san francisco',
}))
const latin: Record<string, string> = {
    а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'e',ж:'zh',з:'z',и:'i',й:'y',к:'k',л:'l',м:'m',н:'n',
    о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',х:'kh',ц:'ts',ч:'ch',ш:'sh',щ:'shch',ъ:'',ы:'y',ь:'',
    э:'e',ю:'yu',я:'ya',
}
function normalize(value: string) {
    return value.toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}
function terms(value: string) {
    const normalized = normalize(value)
    const translated = aliases.get(normalized) ?? normalized.split(' ').map(word => aliases.get(word) ?? word).join(' ')
    return translated.replace(/[а-яё]/g, letter => latin[letter] ?? letter).split(' ').filter(Boolean)
}

// Editorial ordering within a region or metropolitan area; only actual scheduled airports get this preference.
const hubs = new Set('DFW IAH HND HKG LHR CDG AMS JFK LAX ORD SFO ATL MIA LGA EWR BOS DCA IAD NRT FRA SIN DXB PEK PVG ICN SYD MEL YYZ YVR MEX GRU MAD BCN FCO MXP BER DUB IST SVO LED BKK HKT HEL TLL RIX VIE ZRH'.split(' '))
const texasCities = new Set('AUS HOU DAL SAT'.split(' '))

function loadIndex() {
    const compressed = readFileSync(new URL('./airports.json.gz', import.meta.url))
    const {airports} = JSON.parse(gunzipSync(compressed).toString('utf8')) as {airports: AirportRow[]}
    const rows: FlightAirport[] = []
    const priority: number[] = []
    const postings = new Map<string, Map<number, number>>()
    const codes = new Map<string, number>()
    const russian = new Intl.DisplayNames('ru', {type: 'region', fallback: 'none'})
    function add(text: string, row: number, weight: number) {
        for (const word of normalize(text).split(' ')) {
            for (let length = 1; length <= word.length; length++) {
                const prefix = word.slice(0, length)
                const previous = postings.get(prefix)
                const score = weight + (length == word.length ? 4 : 0)
                if (!previous) postings.set(prefix, new Map([[row, score]]))
                else if ((previous.get(row) ?? 0) < score) previous.set(row, score)
            }
        }
    }
    for (const [iata, name, city, region, country, regionCode, countryCode, service, keywords] of airports) {
        const row = rows.length
        rows.push({iata, name, city, region, country, countryCode})
        priority.push(service * 10 + (service >= 8 ? hubs.has(iata) ? 5 : texasCities.has(iata) ? 2 : 0 : 0))
        codes.set(iata, row)
        add(iata, row, 8)
        add(city, row, 7)
        add(name, row, 6)
        add(region, row, 4)
        add(regionCode.split('-')[1] ?? '', row, 3)
        add(country + ' ' + countryCode, row, 3)
        add(russian.of(countryCode) ?? '', row, 3)
        add(keywords, row, 2)
    }
    return {rows, priority, postings, codes}
}

let index: ReturnType<typeof loadIndex> | undefined
export function airportByCode(code: string) {
    const {rows, codes} = index ??= loadIndex()
    const row = codes.get(code.trim().toUpperCase())
    return row === undefined ? undefined : rows[row]
}

export function findAirports(query: string, limit = 8): FlightAirport[] {
    const phrase = query.trim()
    if (!phrase || phrase.length > 120 || !Number.isFinite(limit) || limit < 1) return []
    const {rows, priority, postings, codes} = index ??= loadIndex()
    const raw = normalize(phrase).split(' ')
    const words = terms(phrase)
    const lists = words.map((word, i) => {
        const translated = postings.get(word)
        const native = raw.length == words.length ? postings.get(raw[i]) : undefined
        if (!translated || translated == native) return translated ?? native
        if (!native) return translated
        const all = new Map(translated)
        for (const [row, score] of native) all.set(row, Math.max(score, all.get(row) ?? 0))
        return all
    })
    if (!lists.length || lists.some(list => !list)) return []
    const existing = (lists as Map<number, number>[]).sort((a, b) => a.size - b.size)
    const exact = codes.get(phrase.toUpperCase())
    const matches: {row: number, score: number}[] = []
    for (const [row] of existing[0]) {
        if (!existing.every(list => list.has(row))) continue
        const weight = existing.reduce((total, list) => total + list.get(row)!, 0)
        matches.push({row, score: (exact === row ? 10000 : 0) + priority[row] + weight})
    }
    matches.sort((a, b) => b.score - a.score || rows[a.row].iata.localeCompare(rows[b.row].iata))
    return matches.slice(0, Math.min(50, Math.floor(limit))).map(match => rows[match.row])
}
