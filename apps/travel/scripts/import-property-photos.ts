import {readFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import {resolve} from 'node:path'
import {parseArgs} from 'node:util'
import {placeDestinations, readPlaceSnapshot} from '../backend/places/index.mjs'
import {commonsTitle, isWikidataKey, type CommonsCandidate} from '../backend/photos/commons.ts'
import {runPhotoImport, type ImportTarget} from '../backend/photos/import-photos.ts'

const {values} = parseArgs({options: {
    'dry-run': {type: 'boolean'}, all: {type: 'boolean'}, force: {type: 'boolean'}, help: {type: 'boolean'},
    limit: {type: 'string'}, key: {type: 'string'}, destination: {type: 'string'}, candidates: {type: 'string'}, manifest: {type: 'string'},
}})
if (values.help) {
    console.log('npm run photos:import -- [--dry-run] [--all | --limit N] [--destination ID] [--key QID|osm:TYPE:ID]')
    console.log('                      [--force] [--manifest PATH] [--candidates FILE]')
    console.log('Без параметров проверяются до 20 очередных объектов. Успешные результаты повторно проверяются через 14 дней.')
    process.exit(0)
}

const limit = values.all ? undefined : Number(values.limit ?? 20)
const validLimit = limit == null || (Number.isSafeInteger(limit) && limit > 0)
if (!validLimit || (values.all && values.limit)) throw new Error('Invalid --limit or --all')
const baseManifest = fileURLToPath(new URL('../backend/property-photo-manifest.json', import.meta.url))
const manifestPath = resolve(values.manifest ?? process.env.TRAVEL_PHOTO_MANIFEST ?? baseManifest)
const exclusions = JSON.parse(await readFile(new URL('../backend/property-photo-exclusions.json', import.meta.url), 'utf8'))
const regions = placeDestinations.filter(region => !values.destination || region.id == values.destination)
if (!regions.length) throw new Error('Unknown destination')
const targetByKey = new Map<string, ImportTarget>()
const known = new Map<string, string>()

function target(key: string) {
    if (!targetByKey.has(key)) targetByKey.set(key, {key, links: []})
    return targetByKey.get(key)!
}

for (const region of regions) {
    for (const source of region.sourceIds) {
        for (const hotel of readPlaceSnapshot(region.id, source).records) {
            const key = hotel.wikidataId || hotel.id
            known.set(hotel.id, key)
            known.set(key, key)
            if (isWikidataKey(key)) target(key)
            const title = hotel.commonsFile && commonsTitle(hotel.commonsFile)
            if (title) target(key).links.push({hotelKey: key, title, matchedBy: 'osm:wikimedia_commons', evidenceUrl: hotel.sourceUrl})
        }
    }
}
const seeds = [fileURLToPath(new URL('../backend/photos/commons-links.json', import.meta.url))]
if (values.candidates) seeds.push(resolve(values.candidates))
for (const seed of new Set(seeds)) {
    const links: CommonsCandidate[] = JSON.parse(await readFile(seed, 'utf8'))
    for (const link of links) {
        const key = known.get(link.hotelKey)
        if (!key) continue
        const title = commonsTitle(link.title)
        const source = URL.parse(link.evidenceUrl)
        const valid = title && source?.protocol == 'https:' && link.matchedBy
        if (!valid) throw new Error('Invalid exact association: ' + key)
        target(key).links.push({...link, title, hotelKey: key})
    }
}
const targets = [...targetByKey.values()].filter(t => !values.key || t.key == known.get(values.key)).sort((a, b) => a.key.localeCompare(b.key))
if (values.key && !targets.length) throw new Error('Hotel has no supported ID or confirmed image associated with it')
const checkpointPath = manifestPath == baseManifest ? fileURLToPath(new URL('../data/photos-import.sqlite', import.meta.url)) : manifestPath + '.sqlite'
const summary = await runPhotoImport({
    targets, manifestPath, checkpointPath, exclusions, limit, force: values.force, dryRun: values['dry-run'],
    onProgress: (count, changed) => console.error('Проверено объектов:', count, 'Изменений:', changed),
})
console.log(JSON.stringify({dryRun: !!values['dry-run'], ...summary}))
