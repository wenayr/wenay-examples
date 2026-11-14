import type {PackageCalendar, PackageFare, PackageSummary} from '../src/package-contract.ts'

export function selectedPackageFare(calendar: PackageCalendar | undefined, selectedId: string) {
    const fares = calendar?.days.flatMap(day => day.inBudget ? [day.inBudget] : []) ?? []
    if (selectedId) return fares.find(fare => fare.id == selectedId)
    return fares.reduce<PackageFare | undefined>((best, fare) => !best || fare.total < best.total ? fare : best, undefined)
}

export function selectedPackageSummary(item: PackageSummary, selectedHotelId: string, fare: PackageFare | undefined) {
    if (item.hotelId != selectedHotelId || !fare) return item
    return {...item, best: fare, minTotal: fare.total, maxTotal: fare.total}
}
