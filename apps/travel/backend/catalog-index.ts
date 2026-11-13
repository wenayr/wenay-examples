import {DatabaseSync, type SQLInputValue} from 'node:sqlite'
import type {SupplyHotel} from '../src/supply-contract.ts'
import type {PlaceDataset, PlaceQuery, PlaceRegion} from './catalog.ts'
import {compareEntries, survivors, type DuplicateCandidate} from './catalog-index-model.ts'
import {searchPhrase} from './catalog-text.ts'

type PhotoLookup = (hotel: SupplyHotel) => SupplyHotel['photo']
type Bindings = SQLInputValue[]
interface ChangeSet { upsert?: readonly SupplyHotel[], remove?: readonly string[] }
interface StoredIdentity extends DuplicateCandidate {
    source: string
    named: string
    text: string
    rank: number
    photoFlag: number
    priority: number
    ordinal: number
    visible: number
    sourceVisible: number
    collision: number
}
interface OrderEntry {name: string, id: string, key: number, rank: number}

const rankGap = 1_048_576
const schema = `
CREATE TABLE IF NOT EXISTS places (
 key INTEGER PRIMARY KEY, region TEXT NOT NULL, source TEXT NOT NULL, id TEXT NOT NULL, entity TEXT,
 named TEXT NOT NULL, title TEXT NOT NULL, text TEXT NOT NULL, lat REAL NOT NULL, lon REAL NOT NULL,
 photoFlag INTEGER NOT NULL, priority INTEGER NOT NULL, ordinal INTEGER NOT NULL, rank REAL NOT NULL,
 collision INTEGER NOT NULL DEFAULT 0, visible INTEGER NOT NULL DEFAULT 1, sourceVisible INTEGER NOT NULL DEFAULT 1,
 UNIQUE(region,source,id));
CREATE TABLE IF NOT EXISTS payload (key INTEGER PRIMARY KEY, raw TEXT NOT NULL, picture TEXT);
CREATE TABLE IF NOT EXISTS feeds (region TEXT, source TEXT, fetchedAt TEXT, generation TEXT, PRIMARY KEY(region,source));
CREATE TABLE IF NOT EXISTS revisions (region TEXT PRIMARY KEY, value INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS totals (region TEXT, source TEXT, n INTEGER NOT NULL, PRIMARY KEY(region,source));
CREATE INDEX IF NOT EXISTS source_ordinal ON places(region,source,ordinal);
CREATE INDEX IF NOT EXISTS hotel_rank ON places(region,rank);
CREATE INDEX IF NOT EXISTS hotel_page ON places(region,photoFlag DESC,rank,key) WHERE visible=1;
CREATE INDEX IF NOT EXISTS source_page ON places(region,source,photoFlag DESC,rank,key) WHERE sourceVisible=1;
CREATE INDEX IF NOT EXISTS hotel_id ON places(id,region);
CREATE INDEX IF NOT EXISTS hotel_title ON places(region,title);
CREATE INDEX IF NOT EXISTS hotel_entity ON places(entity,region) WHERE entity IS NOT NULL;

`

export function createCatalogIndex({path, destinations}: {path: string, destinations: readonly PlaceRegion[]}) {
    const db = new DatabaseSync(path)
    db.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA cache_size=-8192; PRAGMA synchronous=NORMAL')
    db.exec(schema)
    // Each destination has its own small spatial/text trees: even a world viewport or a
    // common word cannot enqueue another destination's posting lists.
    const tables = new Map<string, {geo: string, words: string}>()
    function localTables(region: string) {
        const existing = tables.get(region)
        if (existing) return existing
        if (!destinations.some(destination => destination.id == region)) throw new Error('Unknown region ' + region)
        const key = Buffer.from(region).toString('hex')
        const names = {geo: 'geo_' + key, words: 'words_' + key}
        db.exec('CREATE VIRTUAL TABLE IF NOT EXISTS ' + names.geo + ' USING rtree(key,w,e,s,n)')
        db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS " + names.words + " USING fts5(text, tokenize='trigram',content='',contentless_delete=1)")
        tables.set(region, names)
        return names
    }
    for (const destination of destinations) localTables(destination.id)
    // Dynamic statements have a fixed number of query shapes. Bind all visitor data.
    const prepared = new Map<string, ReturnType<typeof db.prepare>>()
    function sql(query: string) {
        const existing = prepared.get(query)
        if (existing) return existing
        const stmt = db.prepare(query)
        if (prepared.size >= 256) prepared.clear()
        prepared.set(query, stmt)
        return stmt
    }
    const metrics = {payloadReads: 0, payloadBytes: 0, candidateRows: 0, writes: 0, byRegion: {} as Record<string, number>}
    function withPublication<T>(work: (database: DatabaseSync) => T): T {
        if (db.isTransaction) return work(db)
        db.exec('BEGIN IMMEDIATE')
        try {
            const result = work(db)
            db.exec('COMMIT')
            return result
        } catch (err) {
            db.exec('ROLLBACK')
            throw err
        }
    }
    // Request count, page and details observe the same revision, even with an external importer.
    function readView<T>(work: () => T): T {
        if (db.isTransaction) return work()
        db.exec('BEGIN')
        try { return work() } finally { db.exec('ROLLBACK') }
    }
    function meta(region: string, source: string) {
        return sql('SELECT fetchedAt,generation FROM feeds WHERE region=? AND source=?').get(region, source) as
            {fetchedAt: string | null, generation: string | null} | undefined
    }
    function revision(region: string) {
        return Number(sql('SELECT value FROM revisions WHERE region=?').get(region)?.value ?? 0)
    }
    function notify(region: string) {
        sql('INSERT INTO revisions VALUES(?,1) ON CONFLICT(region) DO UPDATE SET value=value+1').run(region)
    }
    function counted(region: string, source: string, change: number) {
        if (!change) return
        sql('INSERT INTO totals VALUES(?,?,?) ON CONFLICT(region,source) DO UPDATE SET n=n+excluded.n').run(region, source, change)
    }
    function hydrate(key: number, region: string) {
        const row = sql('SELECT raw,picture FROM payload WHERE key=?').get(key)
        if (!row) throw new Error('Missing catalogue payload ' + key)
        const raw = String(row.raw)
        const picture = row.picture == null ? null : String(row.picture)
        metrics.payloadReads++
        metrics.payloadBytes += Buffer.byteLength(raw) + (picture ? Buffer.byteLength(picture) : 0)
        metrics.byRegion[region] = (metrics.byRegion[region] ?? 0) + 1
        const hotel: SupplyHotel = JSON.parse(raw)
        if (!hotel.photo && picture) hotel.photo = JSON.parse(picture)
        return hotel
    }
    function find(region: string, id: string) {
        return readView(() => {
            // Legacy byId mapped the last record in provider/observation order.
            const row = sql('SELECT key FROM places WHERE region=? AND id=? ORDER BY priority DESC,ordinal DESC LIMIT 1').get(region, id)
            return row ? hydrate(Number(row.key), region) : undefined
        })
    }
    function buildFilter(query: PlaceQuery) {
        const bindings: Bindings = [query.destination.id]
        const conditions = ['p.region=?']
        const local = localTables(query.destination.id)
        let from = 'places p'
        if (query.source) {
            conditions.push('p.source=?')
            bindings.push(query.source)
        }
        if (query.box) {
            const [west, south, east, north] = query.box
            // RTree stores outward-rounded float32 boxes; finish with exact original coordinates.
            from = local.geo + ' g CROSS JOIN places p ON p.key=g.key'
            conditions.push('g.e>=? AND g.w<=? AND g.n>=? AND g.s<=?', 'p.lon BETWEEN ? AND ? AND p.lat BETWEEN ? AND ?')
            bindings.push(west, east, south, north, west, east, south, north)
        }
        if (query.q) {
            if (!query.box && Array.from(query.q).length >= 3) {
                from = local.words + ' CROSS JOIN places p ON p.key=' + local.words + '.rowid'
                const match = '"' + query.q.replaceAll('"', '""') + '"'
                conditions.push(local.words + ' MATCH ?')
                bindings.push(match)
            }
            conditions.push('instr(p.text,?)>0')
            bindings.push(query.q)
        }
        return {from, where: conditions.join(' AND '), bindings}
    }
    function keysFor(query: PlaceQuery) {
        const region = query.destination.id
        const source = query.source ?? ''
        if (!query.q && !query.box) {
            const total = Number(sql('SELECT n FROM totals WHERE region=? AND source=?').get(region, source)?.n ?? 0)
            const scope = source ? 'p.region=? AND p.source=? AND p.sourceVisible=1' : 'p.region=? AND p.visible=1'
            const args: Bindings = source ? [region, source] : [region]
            const keys = sql('SELECT p.key FROM places p WHERE ' + scope + ' ORDER BY p.photoFlag DESC,p.rank,p.key LIMIT ? OFFSET ?')
                .all(...args, query.limit, query.offset)
            return {total, keys}
        }
        const filter = buildFilter(query)
        const selected = ' FROM ' + filter.from + ' WHERE ' + filter.where
        const duplicateFields = 'p.key,p.id,p.title,p.entity,p.lat,p.lon'
        const duplicates = sql('SELECT ' + duplicateFields + selected + ' AND p.collision=1 ORDER BY p.photoFlag DESC,p.priority,p.ordinal,p.key')
            .all(...filter.bindings) as unknown as DuplicateCandidate[]
        metrics.candidateRows += duplicates.length
        const kept = survivors(duplicates)
        let suffix = ''
        const args = [...filter.bindings]
        if (kept.size < duplicates.length) {
            const rejected = duplicates.filter(row => !kept.has(row.key)).map(row => row.key)
            suffix = ' AND p.key NOT IN (SELECT value FROM json_each(?))'
            args.push(JSON.stringify(rejected))
        }
        const qualified = selected + suffix
        const total = Number(sql('SELECT count(*) AS n' + qualified).get(...args)?.n ?? 0)
        const keys = sql('SELECT p.key' + qualified + ' ORDER BY p.photoFlag DESC,p.rank,p.key LIMIT ? OFFSET ?')
            .all(...args, query.limit, query.offset)
        return {total, keys}
    }
    function list(query: PlaceQuery) {
        return readView(() => {
            const {total, keys} = keysFor(query)
            const items = keys.map(row => hydrate(Number(row.key), query.destination.id))
            return {total, items}
        })
    }
    function neighbours(region: string, rows: readonly {id: string, title: string, entity: string | null}[]) {
        const all = new Map<number, StoredIdentity>()
        const checked = new Set<string>()
        const pending = [...rows]
        for (let i = 0; i < pending.length; i++) {
            const row = pending[i]
            const fields = ['id', 'title', 'entity'] as const
            for (const field of fields) {
                const value = row[field]
                if (!value || checked.has(field + ':' + value)) continue
                checked.add(field + ':' + value)
                const neighbours = sql('SELECT * FROM places WHERE region=? AND ' + field + '=?').all(region, value) as unknown as StoredIdentity[]
                for (const match of neighbours) {
                    if (all.has(match.key)) continue
                    all.set(match.key, match)
                    pending.push(match)
                }
            }
        }
        return [...all.values()]
    }
    function shared(rows: readonly StoredIdentity[], field: 'id' | 'title' | 'entity') {
        const counts = new Map<string, number>()
        for (const row of rows) {
            const k = row[field]
            if (k != null) counts.set(k, (counts.get(k) ?? 0) + 1)
        }
        return counts
    }
    function samePriority(a: StoredIdentity, b: StoredIdentity) {
        const bySource = b.photoFlag - a.photoFlag || a.priority - b.priority
        return bySource || a.ordinal - b.ordinal || a.key - b.key
    }
    function refreshWinners(rows: StoredIdentity[], region: string) {
        if (!rows.length) return
        const sorted = rows
        sorted.sort(samePriority)
        const kept = survivors(sorted)
        const perSource = new Map<string, DuplicateCandidate[]>()
        for (const row of sorted) {
            const subset = perSource.get(row.source) ?? []
            subset.push(row)
            perSource.set(row.source, subset)
        }
        const sourceKept = new Set<number>()
        for (const subset of perSource.values()) for (const key of survivors(subset)) sourceKept.add(key)
        const byTitle = shared(sorted, 'title')
        const byEntity = shared(sorted, 'entity')
        const byId = shared(sorted, 'id')
        for (const row of sorted) {
            const cohort = (byId.get(row.id) ?? 0) > 1 || (byTitle.get(row.title) ?? 0) > 1
            const flag = Number(cohort || Boolean(row.entity && (byEntity.get(row.entity) ?? 0) > 1))
            const visible = Number(kept.has(row.key))
            const bySource = Number(sourceKept.has(row.key))
            if (row.visible == visible && row.sourceVisible == bySource && row.collision == flag) continue
            counted(region, '', visible - row.visible)
            counted(region, row.source, bySource - row.sourceVisible)
            sql('UPDATE places SET collision=?,visible=?,sourceVisible=? WHERE key=?').run(flag, visible, bySource, row.key)
        }
    }
    function lookup(region: string, source: string, id: string) {
        return sql('SELECT * FROM places WHERE region=? AND source=? AND id=?').get(region, source, id) as
            StoredIdentity | undefined
    }
    function rankedBetween(region: string, t: {name: string, id: string}): number {
        const columns = 'SELECT rank,named AS name,id,key FROM places WHERE region=? AND rank'
        const previous = sql(columns + ' > 0 ORDER BY rank DESC LIMIT 1').get(region) as unknown as OrderEntry | undefined
        if (!previous || compareEntries(previous, t) <= 0) return (previous?.rank ?? 0) + rankGap
        let lo = 0
        let hi = previous.rank
        while (true) {
            const middle = (lo + hi) / 2
            const upper = sql(columns + ' >= ? AND rank > ? AND rank < ? ORDER BY rank LIMIT 1')
            const candidate = upper.get(region, middle, lo, hi) as unknown as OrderEntry | undefined
            const row = candidate ?? sql(columns + ' > ? AND rank < ? ORDER BY rank DESC LIMIT 1').get(region, lo, hi) as unknown as OrderEntry | undefined
            if (!row) {
                if (middle == lo || middle == hi) {
                    rebalance(region)
                    return rankedBetween(region, t)
                }
                return middle
            }
            if (compareEntries(row, t) <= 0) lo = row.rank
            else hi = row.rank
        }
    }
    function rebalance(region: string) {
        const entries = sql('SELECT key,named AS name,id FROM places WHERE region=?').all(region) as unknown as OrderEntry[]
        entries.sort(compareEntries)
        for (const [i, row] of entries.entries()) sql('UPDATE places SET rank=? WHERE key=?').run((i + 1) * rankGap, row.key)
    }
    function drop(region: string, row: StoredIdentity) {
        sql('DELETE FROM ' + localTables(region).words + ' WHERE rowid=?').run(row.key)
        sql('DELETE FROM ' + localTables(region).geo + ' WHERE key=?').run(row.key)
        sql('DELETE FROM payload WHERE key=?').run(row.key)
        sql('DELETE FROM places WHERE key=?').run(row.key)
        counted(region, '', -row.visible)
        counted(region, row.source, -row.sourceVisible)
        metrics.writes++
    }
    function patchRows(region: string, source: string, changes: ChangeSet, photo: PhotoLookup, bulk = false) {
        const changed: {id: string, title: string, entity: string | null}[] = []
        const remove = changes.remove ?? []
        const incoming = changes.upsert ?? []
        const priority = destinations.find(item => item.id == region)?.sourceIds.indexOf(source) ?? 0
        let nextOrdinal = Number(sql('SELECT max(ordinal) AS n FROM places WHERE region=? AND source=?').get(region, source)?.n ?? -1) + 1
        for (const id of remove) {
            const row = lookup(region, source, id)
            if (!row) continue
            changed.push(row)
            drop(region, row)
        }
        for (const hotel of incoming) {
            const raw = JSON.stringify(hotel)
            const picture = hotel.photo ? null : photo(hotel)
            const actualPicture = picture ? JSON.stringify(picture) : null
            const flag = Number(Boolean(hotel.photo || actualPicture))
            // Compare raw bytes in SQL: unchanged supplier snapshots never hydrate hotel objects from disk.
            const unchanged = sql(`SELECT 1 FROM places p JOIN payload d ON p.key=d.key
                WHERE p.region=? AND p.source=? AND p.id=? AND d.raw=? AND d.picture IS ?`).get(region, source, hotel.id, raw, actualPicture)
            if (unchanged) continue
            const old = lookup(region, source, hotel.id)
            const title = searchPhrase(hotel.name)
            const text = searchPhrase(hotel.name + ' ' + (hotel.locality ?? '') + ' ' + (hotel.category ?? ''))
            const entity = hotel.wikidataId ?? null
            let rank = old?.rank ?? 0
            if (!bulk && old?.named != hotel.name) rank = rankedBetween(region, hotel)
            const ordinal = old?.ordinal ?? nextOrdinal++
            if (old) changed.push(old)
            changed.push({id: hotel.id, title, entity})
            const result = sql(`INSERT INTO places(region,source,id,entity,named,title,text,lat,lon,photoFlag,priority,ordinal,rank)
                VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(region,source,id) DO UPDATE SET
                entity=excluded.entity,named=excluded.named,title=excluded.title,text=excluded.text,lat=excluded.lat,
                lon=excluded.lon,photoFlag=excluded.photoFlag,rank=excluded.rank RETURNING key`)
                .get(region, source, hotel.id, entity, hotel.name, title, text, hotel.latitude, hotel.longitude, flag, priority, ordinal, rank)!
            const key = Number(result.key)
            sql('INSERT OR REPLACE INTO payload(key,raw,picture) VALUES(?,?,?)').run(key, raw, actualPicture)
            if (!old || old.text != text) {
                if (old) sql('DELETE FROM ' + localTables(region).words + ' WHERE rowid=?').run(key)
                sql('INSERT INTO ' + localTables(region).words + '(rowid,text) VALUES(?,?)').run(key, text)
            }
            if (!old || old.lat != hotel.latitude || old.lon != hotel.longitude) {
                sql('INSERT OR REPLACE INTO ' + localTables(region).geo + ' VALUES(?,?,?,?,?)')
                    .run(key, hotel.longitude, hotel.longitude, hotel.latitude, hotel.latitude)
            }
            if (!old) {
                counted(region, '', 1)
                counted(region, source, 1)
            }
            metrics.writes++
        }
        if (!changed.length) return {changed: false}
        if (bulk) {
            rebalance(region)
            // Find collisions with SQL grouping, avoiding per-record neighbour probes on initial import.
            const possible = sql(`SELECT * FROM places p WHERE p.region=? AND (
                p.collision=1 OR p.title IN (SELECT title FROM places WHERE region=? GROUP BY title HAVING count(*)>1)
                OR p.entity IN (SELECT entity FROM places WHERE region=? AND entity IS NOT NULL GROUP BY entity HAVING count(*)>1)
                OR p.id IN (SELECT id FROM places WHERE region=? GROUP BY id HAVING count(*)>1))`).all(region, region, region, region)
            refreshWinners(possible as unknown as StoredIdentity[], region)
        } else {
            refreshWinners(neighbours(region, changed), region)
        }
        notify(region)
        return {changed: true}
    }
    function patch(region: string, source: string, changes: ChangeSet, photo: PhotoLookup) {
        return withPublication(() => patchRows(region, source, changes, photo))
    }
    function replaceSource(region: string, source: string, data: PlaceDataset, photo: PhotoLookup, generation?: string) {
        return withPublication(() => {
            const firstImport = meta(region, source) == null
            const ids = new Set(data.records.map(h => h.id))
            const previous = sql('SELECT id FROM places WHERE region=? AND source=?').iterate(region, source)
            const remove = []
            for (const row of previous) if (!ids.has(String(row.id))) remove.push(String(row.id))
            const result = patchRows(region, source, {remove, upsert: data.records}, photo, firstImport && data.records.length > 256)
            sql('INSERT OR REPLACE INTO feeds(region,source,fetchedAt,generation) VALUES(?,?,?,?)').run(region, source, data.fetchedAt, generation ?? null)
            return result
        })
    }
    function applyPhotos(keys: readonly string[], photo: PhotoLookup) {
        return withPublication(() => {
            const affected = new Map<string, StoredIdentity[]>()
            const visited = new Set<number>()
            for (const key of keys) {
                const entity = key.startsWith('wikidata:') ? key.slice(9) : key
                const matches = sql('SELECT * FROM places WHERE id=? OR entity=? OR id=?').all(key, entity, 'wikidata:' + entity)
                for (const row of matches) {
                    const id = Number(row.key)
                    if (visited.has(id)) continue
                    visited.add(id)
                    const previous = sql('SELECT raw,picture FROM payload WHERE key=?').get(id)!
                    const hotel: SupplyHotel = JSON.parse(String(previous.raw))
                    const image = hotel.photo ? null : photo(hotel)
                    const picture = image ? JSON.stringify(image) : null
                    if (previous.picture === picture) continue
                    sql('UPDATE payload SET picture=? WHERE key=?').run(picture, id)
                    sql('UPDATE places SET photoFlag=? WHERE key=?').run(Number(Boolean(hotel.photo || picture)), id)
                    const region = String(row.region)
                    const dirty = affected.get(region) ?? []
                    dirty.push(row as unknown as StoredIdentity)
                    affected.set(region, dirty)
                    metrics.writes++
                }
            }
            for (const [region, rows] of affected) {
                refreshWinners(neighbours(region, rows), region)
                notify(region)
            }
            return [...affected.keys()]
        })
    }
    function stats() { return {...metrics, byRegion: {...metrics.byRegion}} }
    return {list, find, replaceSource, patch, applyPhotos, meta, revision, stats, withPublication, close: () => db.close()}
}
