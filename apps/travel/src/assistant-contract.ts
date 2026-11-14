import type {FlightQuery, FlightSearch} from './flight-contract.ts'
import type {PackageSummary} from './package-contract.ts'
import type {SupplyHotel, SupplySource} from './supply-contract.ts'
import type {ProviderSearch} from './provider-contract.ts'

export interface TravelChatQuery {
    kind?: 'catalog' | 'packages' | 'flights'
    destination: string
    firstDeparture: string
    lastDeparture: string
    nights: number
    adults: number
    minTotal: number
    maxTotal: number
    minStars: number
    phrase?: string
    flight?: Partial<FlightQuery>
    airportChoices?: {origin?: string, destination?: string}
}

export type TravelChatResult =
    | {kind: 'packages', items: PackageSummary[], total: number, source: SupplySource}
    | {kind: 'catalog', items: Pick<SupplyHotel, 'id' | 'name' | 'locality'>[], total: number}
    | {kind: 'flights', query: FlightQuery, search?: FlightSearch, providerSearch?: ProviderSearch}

export interface TravelChatRequest {message: string, context?: Partial<TravelChatQuery>}
export interface TravelChatReply {
    message: string
    mode: 'openai' | 'local'
    context: Partial<TravelChatQuery>
    result: TravelChatResult | null
    airportOptions?: {side: 'origin' | 'destination', query: string}
}
