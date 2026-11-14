import {localStorageCache} from 'wenay-react2/persist'
import {marketCountries, type tMarketCountry} from '../src/market-contract.ts'

export function marketCountry(value: string | null | undefined) {
    const code = value?.toUpperCase()
    return code && Object.hasOwn(marketCountries, code) ? code as tMarketCountry : null
}

export function createMarketPreferences() {
    const key = 'wenay.travel.market.v1'
    async function load() {
        try {
            const value: unknown = await localStorageCache.get(key)
            if (!value || typeof value != 'object' || !('code' in value)) return null
            return typeof value.code == 'string' ? marketCountry(value.code) : null
        } catch {
            return null
        }
    }
    async function save(code: tMarketCountry) {
        try { await localStorageCache.set(key, {code}) } catch { /* The current route remains usable without browser storage. */ }
    }
    return {load, save}
}
