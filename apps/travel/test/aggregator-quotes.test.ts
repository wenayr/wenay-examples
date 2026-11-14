import assert from 'node:assert/strict'
import test from 'node:test'
import {readGoogleQuote, readGoogleQuotes} from '../backend/flights/google.ts'

test('public comparison retains different airlines and flights, removes duplicate cards and keeps unknown baggage', () => {
    const query = {origin: 'FRA', destination: 'CAI', departure: '2026-12-15', returnDate: '2026-12-22', adults: 2, checkedBag: false}
    const controls = '<input aria-label="Departure" value="Tue, Dec 15"><input aria-label="Return" value="Tue, Dec 22">' +
        '<div aria-label="Number of adult passengers" aria-valuenow="2"></div><time datetime="2026-12-15"></time><time datetime="2026-12-22"></time>'
    function card(carrier: string, total: number, departure: string, arrival: string, nextDay: boolean, cabinWarning = '') {
        const day = nextDay ? 'Wednesday, December 16' : 'Tuesday, December 15'
        return '<li><div aria-label="From ' + total + ' euros round trip total.' + cabinWarning + ' Nonstop flight with ' + carrier +
            '. Leaves Frankfurt Airport at ' + departure + ' on Tuesday, December 15 and arrives at Cairo International Airport at ' + arrival +
            ' on ' + day + '. Total duration 4 hr 15 min. Select flight"><b>FRA</b><b>CAI</b></div></li>'
    }
    const cheap = card('Lufthansa', 1075, '10:45 AM', '4:00 PM', false)
    const otherFlight = card('Lufthansa', 1075, '3:55 PM', '9:10 PM', false)
    const egypt = card('EgyptAir', 1271, '10:25 PM', '3:35 AM', true)
    const excluded = card('AJet', 798, '1:50 PM', '11:40 PM', false, 'This price does not include overhead bin access.')
    const html = controls + cheap + cheap + otherFlight + egypt + excluded
    const rows = readGoogleQuotes(html, query, '2026-11-14T09:00:00Z')
    assert.equal(rows.length, 4)
    assert.deepEqual(rows.map(row => row.carrier), ['AJet', 'Lufthansa', 'Lufthansa', 'EgyptAir'])
    assert.equal(new Set(rows.map(row => row.id)).size, 4)
    assert.equal(rows[0].details?.cabinBag, 'excluded')
    assert.equal(rows[1].details?.checkedBags, null)
    assert.equal(rows[1].details?.cabinBag, 'unknown')
    assert.equal(rows[1].details?.durationMinutes, 255)
    assert.match(rows[3].details?.outbound ?? '', /16 дек/)
    assert.equal(readGoogleQuote(html, query, '2026-11-14T09:00:00Z')?.total, 79800)
    assert.deepEqual(readGoogleQuotes(html, {...query, checkedBag: true}, '2026-11-14T09:00:00Z'), [])
})
