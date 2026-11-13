interface OrderEntry {
    name: string
    id: string
}

const nameOrder = new Intl.Collator('ru', {sensitivity: 'base', numeric: true})

export function compareEntries(a: OrderEntry, b: OrderEntry) {
    return nameOrder.compare(a.name, b.name) || a.id.localeCompare(b.id)
}

export interface DuplicateCandidate {
    key: number
    id: string
    title: string
    entity: string | null
    lat: number
    lon: number
}

function close(a: DuplicateCandidate, b: DuplicateCandidate) {
    const longitudeWidth = Math.cos((a.lat + b.lat) * Math.PI / 360)
    return Math.hypot(a.lat - b.lat, (a.lon - b.lon) * longitudeWidth) * 111_200 < 175
}

// Input is in stable provider/observation order, with photographed properties first.
// Same-name proximity is intentionally not transitive; only compare with surviving neighbours.
export function survivors(candidates: readonly DuplicateCandidate[]) {
    const names = new Map<string, DuplicateCandidate[]>()
    const ids = new Set<string>()
    const entities = new Set<string>()
    const kept = new Set<number>()
    for (const row of candidates) {
        if (ids.has(row.id) || (row.entity && entities.has(row.entity))) continue
        ids.add(row.id)
        const group = names.get(row.title) ?? []
        if (group.some(other => close(other, row))) continue
        group.push(row)
        names.set(row.title, group)
        if (row.entity) entities.add(row.entity)
        kept.add(row.key)
    }
    return kept
}
