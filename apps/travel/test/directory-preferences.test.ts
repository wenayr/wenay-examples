import assert from 'node:assert/strict'
import test from 'node:test'
import {directoryDefaults, restoreDirectoryPreferences, shiftDate} from '../frontend/directory-preferences.ts'

test('catalogue keeps the place and source but replaces expired, reversed or invalid trip dates', () => {
    const now = new Date('2026-12-29T13:00:00Z')
    const defaults = directoryDefaults(now)
    assert.equal(shiftDate('2026-12-29', 7), '2027-01-05')
    assert.equal(defaults.checkOut, shiftDate(defaults.checkIn, 7))
    for (const dates of [
        {checkIn: '2026-12-28', checkOut: '2027-01-12'},
        {checkIn: '2027-01-12', checkOut: '2027-01-12'},
        {checkIn: '2027-02-30', checkOut: '2027-03-12'},
    ]) {
        const restored = restoreDirectoryPreferences({destination: 'galway', source: 'failte', adults: 9, ...dates}, now)
        assert.deepEqual(restored, {...defaults, destination: 'galway', source: 'failte'})
    }
    const saved = {...defaults, search: 'hotel', adults: 3, checkIn: '2027-01-24', checkOut: '2027-01-31'}
    assert.deepEqual(restoreDirectoryPreferences(saved, now), saved)
})
