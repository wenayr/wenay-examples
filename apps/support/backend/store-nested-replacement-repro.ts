import assert from 'node:assert/strict'
import {createStore} from 'wenay-common2/observe'

const expected = {article: {title: 'second', history: [{title: 'previous'}, {title: 'first'}]}}
const store = createStore({article: {title: 'first', history: [{title: 'previous'}]}})
store.state.article = {title: 'second', history: [...store.state.article.history, {title: 'first'}]}

if (process.argv.includes('--expect-fixed')) {
    assert.deepEqual(store.snapshot(), expected)
    store.state.article.history[0].title = 'updated'
    assert.equal(store.snapshot().article.history[0].title, 'updated')
    console.log('PASS nested array entries survive parent replacement and remain reactive')
} else {
    assert.throws(() => store.snapshot(), RangeError, '2.21.1 reproducer: proxy entry retained under a replaced parent recurses')
    const safe = createStore({article: {title: 'first', history: [{title: 'previous'}]}})
    safe.state.article = {title: 'second', history: [...safe.state.article.history.map(version => ({...version})), {title: 'first'}]}
    assert.deepEqual(safe.snapshot(), expected)
    console.log('CONFIRMED common2 2.21.1 nested replacement RangeError; detached plain entries avoid it. Use --expect-fixed after update.')
}
