import assert from 'node:assert/strict'
import test from 'node:test'
import {findAirports} from '../backend/flights/airports.ts'

test('international airport lookup distinguishes a region, a metro area and an exact IATA code', () => {
    const codes = (query: string, limit = 8) => findAirports(query, limit).map(port => port.iata)
    const texas = findAirports('Техаса')
    assert.ok(texas.every(port => port.region === 'Texas' && port.country === 'United States'))
    for (const hub of ['DFW', 'AUS', 'IAH', 'HOU']) assert.ok(texas.some(port => port.iata === hub))
    assert.deepEqual(codes('Токио', 2), ['HND', 'NRT'])
    assert.deepEqual(codes('Dallas', 2), ['DFW', 'DAL'])
    assert.deepEqual(codes('Остин', 1), ['AUS'])
    assert.deepEqual(codes('Хьюстона', 2), ['IAH', 'HOU'])
    assert.deepEqual(codes('hou', 1), ['HOU'])
    assert.deepEqual(codes('constructor'), [])
})
