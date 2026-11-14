import assert from 'node:assert/strict'
import test from 'node:test'
import {mapClusters} from '../frontend/map-clusters.ts'

test('map clusters retain every hotel and keep the selected hotel separately accessible', () => {
    const hotels = Array.from({length: 62}, (_, index) => ({id: 'hotel-' + index, x: index % 6 * 24, y: Math.floor(index / 6) * 13}))
    const groups = mapClusters(hotels, 'hotel-24')
    assert.equal(groups.reduce((total, group) => total + group.members.length, 0), 62)
    const ids = groups.flatMap(group => group.members.map(hotel => hotel.id))
    assert.equal(new Set(ids).size, 62)
    assert.deepEqual(groups.find(group => group.id == 'selected:hotel-24')?.members.map(hotel => hotel.id), ['hotel-24'])
    assert.deepEqual(mapClusters([], null), [])
})

test('close hotels across a cell boundary form one cluster', () => {
    const hotels = [{id: 'a', x: 400, y: 300}, {id: 'b', x: 420, y: 310}, {id: 'c', x: 1200, y: 900}]
    const groups = mapClusters(hotels, null)
    assert.equal(groups.length, 2)
    assert.deepEqual(groups.map(group => group.members.map(hotel => hotel.id)), [['a', 'b'], ['c']])
    assert.equal(groups[0].x, 410)
    assert.equal(groups[0].y, 305)
})

test('a coastal chain cannot collapse into one screen-wide cluster', () => {
    const hotels = Array.from({length: 30}, (_, index) => ({id: String(index), x: index * 45, y: index * 8}))
    const groups = mapClusters(hotels, null)
    assert.ok(groups.length > 1)
    groups.forEach(group => {
        const xs = group.members.map(point => point.x)
        const ys = group.members.map(point => point.y)
        assert.ok(Math.max(...xs) - Math.min(...xs) <= 138)
        assert.ok(Math.max(...ys) - Math.min(...ys) <= 62)
    })
    assert.equal(groups.reduce((total, group) => total + group.members.length, 0), 30)
})
