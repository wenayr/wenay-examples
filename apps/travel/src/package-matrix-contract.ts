import type {PackageFare} from './package-contract.ts'
import type {SupplySource} from './supply-contract.ts'

export const packageMatrixCellLimit = 6

export const packageMatrixStatuses = {
    'in-budget': 'В бюджете',
    'outside-budget': 'Вне бюджета',
    empty: 'Туров нет',
    unknown: 'Не подтверждено',
    failed: 'Не удалось проверить'
} as const

export interface PackageMatrixRow {
    nights: number
    // Calendar dates including departure; this does not establish the return flight time.
    days: number
}

export interface PackageMatrixFare extends PackageFare, PackageMatrixRow {
    adults: number
    children: 0
    currency: 'EUR'
    priceBasis: 'party-total'
    room: string | null
    board: string | null
    sourceUrl: string
    checkedAt: string
}

export interface PackageMatrixCell extends PackageMatrixRow {
    departure: string
    status: keyof typeof packageMatrixStatuses
    lowest: PackageMatrixFare | null
    inBudget: PackageMatrixFare | null
    highest: PackageMatrixFare | null
    complete: boolean
    checkedAt: string | null
    retryAt?: string
    source: SupplySource
}

export interface PackageMatrix {
    hotelId: string
    departures: string[]
    rows: PackageMatrixRow[]
    adults: number
    currency: 'EUR'
    priceBasis: 'party-total'
    // Row-major order: ascending nights, then ascending departure date.
    cells: PackageMatrixCell[]
    source: SupplySource
}
