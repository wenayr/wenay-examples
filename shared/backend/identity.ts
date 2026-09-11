// Канон: shared/backend/identity.ts. Копии в приложениях синхронизируются scripts/sync.mjs;
// правьте здесь или поднимите правку из приложения: sync.mjs --from=<приложение>.
import {randomBytes, scryptSync, timingSafeEqual} from 'node:crypto'

export type tSecret = {salt: string, hash: string}

export function hashSecret(password: string): tSecret {
    const salt = randomBytes(16).toString('base64url')
    return {salt, hash: scryptSync(password, salt, 32).toString('base64url')}
}

export function verifySecret(secret: tSecret | undefined, password: string) {
    if (!secret?.hash || !secret.salt || typeof password != 'string' || password.length > 256) return false
    const given = scryptSync(password, secret.salt, 32)
    const expected = Buffer.from(secret.hash, 'base64url')
    return given.length == expected.length && timingSafeEqual(given, expected)
}
