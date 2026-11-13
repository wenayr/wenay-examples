import type {SearchCriteria, TourOffer} from '../src/search-tours.ts'

// === Направления и гостиницы демонстрационного каталога ===

interface Destination {
    name: string
    country: string
    airport: string
    latitude: number
    longitude: number
}

export const destinations = {
    hurghada: {name: 'Хургада', country: 'Египет', airport: 'HRG', latitude: 27.173, longitude: 33.832},
    phuket: {name: 'Пхукет', country: 'Таиланд', airport: 'HKT', latitude: 7.878, longitude: 98.288},
    paphos: {name: 'Пафос', country: 'Кипр', airport: 'PFO', latitude: 34.789, longitude: 32.408},
} as const satisfies Record<string, Destination>

export type DestinationId = keyof typeof destinations

interface HotelInfo {
    destinationId: DestinationId
    name: string
    area: string
    stars: number
    meal: string
    description: string
    features: readonly string[]
    latitude: number
    longitude: number
    outline: readonly (readonly [latitude: number, longitude: number])[]
}

// Names, grounds, facilities and fares are fixtures. The outlines are illustrative polygons in WGS84.
export const hotels = {
    palm: {
        destinationId: 'hurghada', name: 'Palm Bay', area: 'Эль-Мамша', stars: 5, meal: 'Всё включено',
        description: 'Утром можно выйти из сада прямо к воде, а вечером пройтись по набережной Эль-Мамши.',
        features: ['Песчаный пляж', 'Сад с бассейном'], latitude: 27.1614, longitude: 33.8267,
        outline: [[27.16195, 33.8262], [27.16185, 33.82755], [27.16092, 33.82723], [27.16086, 33.82608]],
    },
    marina: {
        destinationId: 'hurghada', name: 'Marina House', area: 'Марина', stars: 4, meal: 'Завтраки',
        description: 'Небольшой городской отель рядом с яхтенной мариной. На крыше — терраса для завтрака.',
        features: ['Терраса на крыше', 'Пешком до марины'], latitude: 27.2254, longitude: 33.8397,
        outline: [[27.2258, 33.83948], [27.2255, 33.84015], [27.225, 33.83986], [27.22526, 33.83924]],
    },
    dune: {
        destinationId: 'hurghada', name: 'Dune Beach', area: 'Южное побережье', stars: 4, meal: 'Полупансион',
        description: 'Малоэтажные корпуса вокруг внутреннего дворика. После купания можно отдохнуть в тени на террасе.',
        features: ['Первая линия', 'Семейные номера'], latitude: 27.0911, longitude: 33.8405,
        outline: [[27.09177, 33.83984], [27.09178, 33.84089], [27.091, 33.84126], [27.09053, 33.84055], [27.0908, 33.83991]],
    },
    coral: {
        destinationId: 'hurghada', name: 'Coral Garden', area: 'Саккала', stars: 5, meal: 'Всё включено',
        description: 'Номера выходят в тенистый сад. Между завтраком и прогулкой по городу удобно провести время у воды.',
        features: ['Сад у моря', 'Спа'], latitude: 27.1995, longitude: 33.8438,
        outline: [[27.2, 33.84325], [27.20015, 33.84413], [27.19947, 33.84443], [27.19888, 33.84388], [27.19925, 33.84329]],
    },
    kata: {
        destinationId: 'phuket', name: 'Sora Kata', area: 'Ката', stars: 4, meal: 'Завтраки',
        description: 'Небольшой отель у южного края бухты Ката. Завтрак подают в открытом павильоне с видом на сад.',
        features: ['Рядом с пляжем', 'Тропический сад'], latitude: 7.8143, longitude: 98.2996,
        outline: [[7.81469, 98.29913], [7.81478, 98.29994], [7.81427, 98.30011], [7.8139, 98.29983], [7.81396, 98.29923]],
    },
    karon: {
        destinationId: 'phuket', name: 'Karon Palm', area: 'Карон', stars: 5, meal: 'Полупансион',
        description: 'Семейные номера расположены вокруг бассейна, откуда аллея ведёт к дороге вдоль пляжа Карон.',
        features: ['Семейные номера', 'Бассейн'], latitude: 7.8404, longitude: 98.2952,
        outline: [[7.84096, 98.29481], [7.84092, 98.29577], [7.84008, 98.29569], [7.83984, 98.29508], [7.84013, 98.29473]],
    },
    kamala: {
        destinationId: 'phuket', name: 'Kamala Cove', area: 'Камала', stars: 5, meal: 'Завтраки',
        description: 'Тихий отель у бухты Камала. Большая веранда подходит для ужина на открытом воздухе.',
        features: ['Веранда', 'Бассейн в саду'], latitude: 7.9515, longitude: 98.2813,
        outline: [[7.95198, 98.28092], [7.95215, 98.28157], [7.95153, 98.2819], [7.95096, 98.28148], [7.95105, 98.28089]],
    },
    petra: {
        destinationId: 'paphos', name: 'Petra Harbour', area: 'Като-Пафос', stars: 4, meal: 'Завтраки',
        description: 'Городской отель для прогулок по гавани. На первом этаже — открытый дворик со столиками.',
        features: ['Пешком до гавани', 'Внутренний двор'], latitude: 34.7579, longitude: 32.4195,
        outline: [[34.75831, 32.41934], [34.75812, 32.41995], [34.7576, 32.41977], [34.75749, 32.41933], [34.75791, 32.41907]],
    },
    chloraka: {
        destinationId: 'paphos', name: 'Chloraka Bay', area: 'Хлорака', stars: 5, meal: 'Полупансион',
        description: 'Корпуса стоят в саду у побережья Хлораки. С дорожки вдоль моря открывается вид на закат.',
        features: ['Сад у моря', 'Панорамная терраса'], latitude: 34.8047, longitude: 32.3969,
        outline: [[34.80528, 32.39662], [34.80513, 32.39743], [34.80423, 32.39736], [34.80409, 32.39658], [34.80471, 32.39632]],
    },
} as const satisfies Record<string, HotelInfo>

export type HotelId = keyof typeof hotels

// === Тарифы за группу: отель × дата вылета × доступные варианты ===

type tJanuaryDay = '15' | '16' | '17' | '18' | '19' | '20' | '21' | '22' | '23' | '24' | '25' | '26' | '27' | '28' | '29' | '30' | '31'
type DailyPrices = Partial<Record<tJanuaryDay, readonly number[]>>

// Each number is an independent, complete package in whole euros for the same party.
const januaryRates = {
    palm: {
        '15': [1970], '16': [1860], '17': [1810], '18': [1750], '19': [1490, 1880, 2130], '20': [1690], '21': [1770],
        '22': [1850], '24': [1990], '26': [1860], '28': [1810], '29': [1910], '30': [2130], '31': [2250],
    },
    marina: {
        '16': [1730], '17': [1670], '19': [1750], '20': [1710], '21': [1650], '22': [1590], '23': [1530, 1760],
        '24': [1450], '25': [1490], '26': [1550], '28': [1640], '30': [1590], '31': [1540],
    },
    dune: {
        '15': [1860], '16': [1780], '18': [1840], '19': [1920], '20': [1840], '21': [1740], '23': [1630],
        '24': [1690], '25': [1760, 2070], '27': [1850], '28': [1930], '30': [1840], '31': [1850],
    },
    coral: {
        '15': [2640], '17': [2510], '19': [2420], '21': [2340], '22': [2210, 2460], '24': [2290], '26': [2160],
        '28': [2370], '29': [2310], '31': [2550],
    },
    kata: {
        '15': [3260], '16': [3150], '17': [3030], '19': [2860, 3420], '20': [2990], '21': [2940], '23': [2780],
        '24': [2700], '25': [2790], '26': [2920], '28': [3070], '29': [3120], '31': [3240],
    },
    karon: {
        '15': [3820], '16': [3650], '18': [3490], '19': [3550], '21': [3360], '22': [3290], '23': [3160, 3670],
        '25': [3380], '26': [3440], '28': [3610], '30': [3780], '31': [3870],
    },
    kamala: {
        '16': [4150], '18': [3940], '19': [3880], '21': [3770], '23': [3650, 3990], '25': [3580], '27': [3760],
        '28': [3820], '30': [3980], '31': [4090],
    },
    petra: {
        '15': [1590], '16': [1520], '17': [1480], '19': [1410, 1690], '20': [1380], '22': [1340], '23': [1380],
        '25': [1460], '26': [1430], '28': [1510], '30': [1590], '31': [1630],
    },
    chloraka: {
        '15': [2350], '17': [2190], '18': [2140], '20': [2060], '21': [1970], '23': [1880, 2210], '24': [1940],
        '26': [2010], '28': [2140], '29': [2180], '31': [2290],
    },
} as const satisfies Record<HotelId, DailyPrices>

export const defaultSearch = {
    origin: 'TLL', destinationId: 'hurghada', firstDeparture: '2027-01-15', lastDeparture: '2027-01-31',
    tripDays: 10, travelers: 2, currency: 'EUR', minTotal: 0, maxTotal: 3800 * 100,
} satisfies SearchCriteria & {destinationId: DestinationId}

function buildOffers(hotelId: HotelId, rates: DailyPrices): TourOffer<HotelId>[] {
    const destinationId = hotels[hotelId].destinationId
    return Object.entries(rates).flatMap(([day, prices]) => prices.map((price, index) => ({
        id: hotelId + '-' + day + '-' + index, hotelId, destinationId, origin: defaultSearch.origin,
        departure: '2027-01-' + day, tripDays: defaultSearch.tripDays, travelers: defaultSearch.travelers,
        currency: defaultSearch.currency, total: price * 100, available: true,
    } satisfies TourOffer<HotelId>)))
}

export const demoOffers = (Object.keys(hotels) as HotelId[]).flatMap(id => buildOffers(id, januaryRates[id]))
