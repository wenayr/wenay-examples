interface BufferPolicy {
    automatic: boolean
    freshMs: number
    negativeFreshMs: number
    retainMs: number
    errorRetryMs: number
    sharedCheckMs: number
    deadlineMs: number
    leaseMs: number
    maxEntries: number
    maxSnapshotBytes: number
    maxResidentBytes: number
    manualRefreshGapMs: number
    maxPendingKeys: number
    maxSharedReads: number
    limits: {windowMs: number, startsPerWindow: number, minStartGapMs: number, maxConcurrent: number}
}

const standard = {
    freshMs: 120_000, negativeFreshMs: 30_000, retainMs: 900_000, errorRetryMs: 10_000,
    sharedCheckMs: 10_000, deadlineMs: 20_000, leaseMs: 25_000, maxEntries: 360, maxSnapshotBytes: 2_000_000,
    maxResidentBytes: 12 * 1024 * 1024,
    manualRefreshGapMs: 15_000,
    maxPendingKeys: 48,
    maxSharedReads: 4,
    limits: {windowMs: 60_000, startsPerWindow: 30, minStartGapMs: 2_000, maxConcurrent: 6},
} as const

export const providerBufferProfiles = {
    demand: {...standard, automatic: true},
    'request-only': {...standard, automatic: false},
    economy: {...standard, automatic: true, freshMs: 300_000, sharedCheckMs: 30_000,
        limits: {...standard.limits, minStartGapMs: 4_000, startsPerWindow: 15}},
} as const satisfies Record<string, BufferPolicy>

export type tProviderBufferProfile = keyof typeof providerBufferProfiles
export type ProviderBufferConfig = BufferPolicy & {profile: tProviderBufferProfile}

export function resolveProviderBufferConfig(profile: string = 'demand'): ProviderBufferConfig {
    if (!Object.hasOwn(providerBufferProfiles, profile)) throw new RangeError('Неизвестный профиль обновления цен.')
    return {...providerBufferProfiles[profile as tProviderBufferProfile], profile: profile as tProviderBufferProfile}
}
