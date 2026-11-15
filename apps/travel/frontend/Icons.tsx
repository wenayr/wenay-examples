export const iconPaths = {
    list: 'M9 6h12M9 12h12M9 18h12M3 6h1M3 12h1M3 18h1',
    suitcase: 'M3 7h18v14H3z M8 7V4h8v3 M7 11v6m10-6v6',
    search: 'M16 16l5 5 M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
    chat: 'M21 11a8 8 0 0 1-8 8H8l-5 3 1.5-6A8 8 0 0 1 11 3h2a8 8 0 0 1 8 8z M8 10h8m-8 4h5',
    compass: 'm15.5 8.5-2.3 4.7-4.7 2.3 2.3-4.7 4.7-2.3z M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0z',
    plane: 'm22 3-2-1-7 7-8-2-2 2 7 4-4 5-3-1-1 1 4 3 3 1 1-1-1-3 5-4 4 7 2-2-2-8 4-6z',
    map: 'm2 5 6-3 8 3 6-3v17l-6 3-8-3-6 3V5z M8 2v17 M16 5v17',
    pin: 'M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0z M14 10a2 2 0 1 1-4 0 2 2 0 0 1 4 0z',
    filters: 'M3 6h6m4 0h8M3 12h10m4 0h4M3 18h3m4 0h11 M13 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0 M17 12a2 2 0 1 1-4 0 2 2 0 0 1 4 0 M10 18a2 2 0 1 1-4 0 2 2 0 0 1 4 0',
    arrow: 'M4 12h16m-6-6 6 6-6 6',
    down: 'm6 9 6 6 6-6',
    close: 'm5 5 14 14M19 5 5 19',
    calendar: 'M4 5h16v16H4z M4 10h16 M8 2v5 M16 2v5',
    people: 'M16 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2 M12.5 7a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0 M21 21v-2a4 4 0 0 0-3-3.9 M16.5 3.6a3.5 3.5 0 0 1 0 6.8',
    bookmark: 'M6 3h12v18l-6-4-6 4V3z',
    heart: 'M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8z',
    flag: 'M5 22V3m0 1c5-3 9 3 14 0v11c-5 3-9-3-14 0',
    matrix: 'M3 3h18v18H3z M3 9h18 M3 15h18 M9 3v18 M15 3v18',
    refresh: 'M20.5 8A9 9 0 0 0 5 5L2 8m0-5v5h5 M3.5 16A9 9 0 0 0 19 19l3-3m0 5v-5h-5',
    move: 'M12 2v20M2 12h20M8 6l4-4 4 4M8 18l4 4 4-4M6 8l-4 4 4 4M18 8l4 4-4 4',
    locate: 'M12 2v4m0 12v4M2 12h4m12 0h4 M18 12a6 6 0 1 1-12 0 6 6 0 0 1 12 0z M14 12a2 2 0 1 1-4 0 2 2 0 0 1 4 0z',
    settings: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z M10 2h4l1 3 3 1 3-1 2 4-2 2v3l2 2-2 4-3-1-3 1-1 3h-4l-1-3-3-1-3 1-2-4 2-2v-3L1 9l2-4 3 1 3-1 1-3z',
    image: 'M3 3h18v18H3z M3 17l5-5 5 5 3-3 5 5 M10 8a2 2 0 1 1-4 0 2 2 0 0 1 4 0z',
    external: 'M14 3h7v7m0-7L10 14 M10 3H3v18h18v-7',
    grip: 'M8 4h1m6 0h1M8 12h1m6 0h1M8 20h1m6 0h1',
} as const

export function Icon({name, size = 18}: {
    name: keyof typeof iconPaths
    size?: number
}) {
    return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"
        strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={iconPaths[name]} /></svg>
}
