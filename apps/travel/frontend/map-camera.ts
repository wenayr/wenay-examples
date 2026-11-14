import type {tMapCamera} from './DirectoryMap.tsx'
import type {TravelRoute} from './navigation.ts'

export function cameraForRoute(route: TravelRoute): tMapCamera | null {
    const latitude = Number(route.query.get('mapLat'))
    const longitude = Number(route.query.get('mapLon'))
    const zoom = Number(route.query.get('mapZoom'))
    const finite = [latitude, longitude, zoom].every(Number.isFinite)
    const positioned = Math.abs(latitude) <= 85 && Math.abs(longitude) <= 180 && zoom >= 2 && zoom <= 18
    return finite && positioned ? {latitude, longitude, zoom} : null
}
