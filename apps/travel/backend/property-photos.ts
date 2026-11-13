import type {SupplyHotel, SupplyPhoto} from '../src/supply-contract.ts'
import images from './property-photo-manifest.json' with {type: 'json'}

// Only a provider's explicit Wikidata entity link establishes a match across feeds.
const photoByEntity = new Map(Object.entries(images satisfies Record<string, SupplyPhoto>))

export function findPropertyPhoto(hotel: Pick<SupplyHotel, 'id' | 'wikidataId'>): SupplyPhoto | null {
    const id = hotel.wikidataId ?? (hotel.id.startsWith('wikidata:') ? hotel.id.slice('wikidata:'.length) : null)
    return id ? photoByEntity.get(id) ?? null : null
}
