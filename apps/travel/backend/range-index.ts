import {BSearchIndex} from 'wenay-common2'

/** Binary insertion point, including duplicate values on either boundary. */
export function boundary<T>(values: readonly T[], before: (value: T) => boolean) {
    const index = BSearchIndex(values.length, i => before(values[i]) ? -1 : 1, 'greatOrEqual')
    return index < 0 ? values.length : index
}

interface Node<T> {
    start: number
    end: number
    entries: readonly T[]
    left?: Node<T>
    right?: Node<T>
}

function merge<T>(a: readonly T[], b: readonly T[], compare: (a: T, b: T) => number) {
    const merged: T[] = []
    let i = 0
    let j = 0
    while (i < a.length && j < b.length) merged.push(compare(a[i], b[j]) <= 0 ? a[i++] : b[j++])
    return merged.concat(a.slice(i), b.slice(j))
}

export interface IndexSlice<T> {entries: readonly T[], start: number, end: number}

/** Immutable 2-D range tree. Each subtree stores its entries ordered by the second coordinate. */
export function createRangeIndex<T, P extends number | string>(
    points: readonly T[], primary: (point: T) => P, secondary: (point: T) => number,
    tie: (a: T, b: T) => number = () => 0
) {
    const groups = new Map<P, T[]>()
    for (const point of points) {
        const key = primary(point)
        const existing = groups.get(key)
        if (existing) existing.push(point)
        else groups.set(key, [point])
    }
    const keys = [...groups.keys()].sort((a, b) => a < b ? -1 : a > b ? 1 : 0)
    const compare = (a: T, b: T) => secondary(a) - secondary(b) || tie(a, b)
    function build(start: number, end: number): Node<T> {
        if (end - start == 1) return {start, end, entries: groups.get(keys[start])!.sort(compare)}
        const middle = Math.floor((start + end) / 2)
        const left = build(start, middle)
        const right = build(middle, end)
        return {start, end, left, right, entries: merge(left.entries, right.entries, compare)}
    }
    const root = keys.length ? build(0, keys.length) : null
    return function ranges(first: P, last: P, low: number, high: number) {
        const slices: IndexSlice<T>[] = []
        const from = boundary(keys, key => key < first)
        const until = boundary(keys, key => key <= last)
        function visit(node: Node<T>) {
            if (node.end <= from || node.start >= until) return
            if (from <= node.start && node.end <= until) {
                const start = boundary(node.entries, point => secondary(point) < low)
                const end = boundary(node.entries, point => secondary(point) <= high)
                if (start < end) slices.push({entries: node.entries, start, end})
                return
            }
            if (node.left && node.right) {
                visit(node.left)
                visit(node.right)
            }
        }
        if (root && from < until && low <= high) visit(root)
        return slices
    }
}
