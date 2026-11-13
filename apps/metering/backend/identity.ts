// Канон: shared/backend/identity.ts. Копии в приложениях синхронизируются scripts/sync.mjs;
// правьте здесь или поднимите правку из приложения: sync.mjs --from=<приложение>.
import {randomBytes, scryptSync, timingSafeEqual} from 'node:crypto'

export type tSecret = {salt: string, hash: string}

// Идентичность выше библиотеки: библиотека проверяет токены, приложение решает,
// кому принадлежит аккаунт. Пример хранит соль и scrypt-хеш прямо в реплицируемом
// состоянии — хеш доступен каждому узлу, но ни одно представление его не проецирует.
// Продукт заменяет этот помощник своим провайдером, не трогая определение сервиса.
export function hashSecret(password: string): tSecret {
    const salt = randomBytes(16).toString('base64url')
    return {salt, hash: scryptSync(password, salt, 32).toString('base64url')}
}

export function verifySecret(secret: tSecret | undefined, password: string) {
    const usable = !!secret?.hash && !!secret.salt
    const acceptable = typeof password == 'string' && password.length <= 256
    if (!usable || !acceptable) return false
    const given = scryptSync(password, secret.salt, 32)
    const expected = Buffer.from(secret.hash, 'base64url')
    return given.length == expected.length && timingSafeEqual(given, expected)
}
