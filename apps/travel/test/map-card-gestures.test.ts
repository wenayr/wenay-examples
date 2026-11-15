import assert from 'node:assert/strict'
import test from 'node:test'
import {acceptsMapCardDrag, acceptsMapPhotoSwipe, movedMapCard, photoSwipeDirection} from '../frontend/map-card-gestures.ts'

test('photo transfer belongs to a primary mouse, while the handle also accepts touch', () => {
    const mouse = {pointerType: 'mouse', isPrimary: true, button: 0}
    const touch = {...mouse, pointerType: 'touch'}
    assert.equal(acceptsMapCardDrag(mouse, 'photo'), true)
    assert.equal(acceptsMapCardDrag(touch, 'photo'), false)
    assert.equal(acceptsMapCardDrag(touch, 'handle'), true)
    assert.equal(acceptsMapCardDrag({...mouse, pointerType: 'pen'}, 'photo'), false)
    assert.equal(acceptsMapCardDrag({...mouse, isPrimary: false}, 'handle'), false)
    assert.equal(acceptsMapCardDrag({...mouse, button: 2}, 'photo'), false)
    assert.equal(acceptsMapPhotoSwipe(touch), true)
    assert.equal(acceptsMapPhotoSwipe(mouse), false)
    assert.equal(acceptsMapPhotoSwipe({...touch, isPrimary: false}), false)
})

test('a mouse photo click is not a transfer until it crosses the movement threshold', () => {
    const start = {x: 100, y: 150}
    assert.equal(movedMapCard(start, {x: 102, y: 152}), false)
    assert.equal(movedMapCard(start, {x: 104, y: 150}), true)
    assert.equal(movedMapCard(start, {x: 97, y: 147}), true)
})

test('gallery swipes require a deliberate horizontal movement and preserve vertical scrolling', () => {
    const start = {x: 100, y: 150}
    assert.equal(photoSwipeDirection(start, {x: 60, y: 155}), 1)
    assert.equal(photoSwipeDirection(start, {x: 140, y: 145}), -1)
    assert.equal(photoSwipeDirection(start, {x: 70, y: 150}), null)
    assert.equal(photoSwipeDirection(start, {x: 120, y: 200}), null)
    assert.equal(photoSwipeDirection(start, {x: 140, y: 190}), null)
})
