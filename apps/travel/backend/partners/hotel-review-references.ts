import manifest from './tez-location-overrides.json' with {type: 'json'}

// These exact hotel-to-source identities were checked while correcting the map.
// Linking to the original page does not import or republish the source's review content.
const references = new Map(manifest.locations.flatMap(property => {
    const url = new URL(property.source)
    const officialReview = url.protocol == 'https:' && url.hostname == 'www.tripadvisor.com' && url.pathname.startsWith('/Hotel_Review-')
    if (!officialReview) return []
    return [['tez:' + property.id, {name: 'Tripadvisor', url: url.href, identityCheckedOn: property.checkedOn}] as const]
}))

export function hotelReviewReferences(hotelId: string) {
    const reference = references.get(hotelId)
    return reference ? [reference] : []
}
