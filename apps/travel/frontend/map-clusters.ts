interface MapPoint {
    id: string
    x: number
    y: number
}

/** Pixel cells stay anchored to the map projection while the user pans. */
export function mapClusters<T extends MapPoint>(points: readonly T[], selectedId: string | null, width = 138, height = 62) {
    const cells = new Map<string, number[]>()
    const parents = points.map((_, index) => index)
    const areas = points.map(point => ({left: point.x, right: point.x, top: point.y, bottom: point.y}))
    function root(index: number): number {
        if (parents[index] == index) return index
        parents[index] = root(parents[index])
        return parents[index]
    }
    function join(first: number, second: number) {
        const a = root(first)
        const b = root(second)
        if (a == b) return
        const left = Math.min(areas[a].left, areas[b].left)
        const right = Math.max(areas[a].right, areas[b].right)
        const top = Math.min(areas[a].top, areas[b].top)
        const bottom = Math.max(areas[a].bottom, areas[b].bottom)
        if (right - left > width || bottom - top > height) return
        parents[b] = a
        areas[a] = {left, right, top, bottom}
    }
    points.forEach((point, index) => {
        if (point.id == selectedId) return
        const x = Math.floor(point.x / width)
        const y = Math.floor(point.y / height)
        const keys = [-1, 0, 1].flatMap(dx => [-1, 0, 1].map(dy => (x + dx) + ':' + (y + dy)))
        const nearby = keys.flatMap(key => cells.get(key) ?? [])
        nearby.forEach(other => join(index, other))
        const key = x + ':' + y
        const cell = cells.get(key)
        if (cell) cell.push(index)
        else cells.set(key, [index])
    })
    const groups = new Map<number, T[]>()
    points.forEach((point, index) => {
        const key = root(index)
        const members = groups.get(key)
        if (members) members.push(point)
        else groups.set(key, [point])
    })
    return [...groups].map(([key, members]) => {
        const area = areas[key]
        return {
            id: points[key].id == selectedId ? 'selected:' + selectedId : 'cluster:' + points[key].id,
            members, x: (area.left + area.right) / 2, y: (area.top + area.bottom) / 2,
        }
    })
}
