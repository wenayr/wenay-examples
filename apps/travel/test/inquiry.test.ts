import assert from 'node:assert/strict'
import test from 'node:test'
import {createDemoInquiries} from '../src/inquiry.ts'
import type {TourOffer} from '../src/search-tours.ts'

function quote(): TourOffer {
    return {id: 'palm-19-flex', hotelId: 'palm', origin: 'TLL', destinationId: 'hurghada', departure: '2027-01-19',
        tripDays: 10, travelers: 2, currency: 'EUR', total: 188_000, available: true}
}

test('повтор того же тарифа возвращает исходную заявку и уведомляет только один раз', () => {
    const inquiries = createDemoInquiries()
    const offer = quote()
    let count = 0
    const unsubscribe = inquiries.subscribe(() => count++)
    const first = inquiries.create(offer)
    const second = inquiries.create({...offer})
    assert.equal(second, first)
    assert.equal(inquiries.find(offer), first)
    assert.equal(first.reference, 'DEMO-001')
    assert.equal(count, 1)
    unsubscribe()
    inquiries.create({...offer, departure: '2027-01-20'})
    assert.equal(count, 1)
})

test('изменившиеся условия тарифа создают новый снимок, независимый от исходного объекта', () => {
    const inquiries = createDemoInquiries()
    const offer = quote()
    const first = inquiries.create(offer)
    offer.total += 10_000
    assert.equal(inquiries.find(offer), undefined)
    const revised = inquiries.create(offer)
    assert.notEqual(revised.reference, first.reference)
    assert.equal(first.offer.total, 188_000)
    assert.equal(revised.offer.total, 198_000)
    assert.equal(createDemoInquiries().find(offer), undefined)
})

test('недоступный тариф и неверная цена не создают заявку', () => {
    const inquiries = createDemoInquiries()
    assert.throws(() => inquiries.create({...quote(), available: false}), RangeError)
    assert.throws(() => inquiries.create({...quote(), total: NaN}), RangeError)
    assert.equal(inquiries.find(quote()), undefined)
})
