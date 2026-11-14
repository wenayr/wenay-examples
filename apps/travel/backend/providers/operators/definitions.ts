import type {ProviderRegistration} from '../../../src/provider-contract.ts'

export const operatorProviders = {
    'joinup-packages': {
        definition: {
            id: 'joinup-packages', name: 'Join UP! Last Minute', website: 'https://joinup.ee',
            docsUrl: 'https://joinup.ee/en/last-minute', kinds: ['packages', 'deals'],
            description: 'Опубликованные пакеты Last Minute из Таллина за двух взрослых с датами и общей ценой. Покрытие витрины частичное.',
            requiredEnv: [], access: 'public', environment: 'production',
            activation: 'Публичная коллекция доступна без ключа. Для агентского вознаграждения и оформления нужен отдельный договор с Join UP!.',
            queryFields: ['origin', 'destination', 'departure', 'nights', 'adults', 'currency'],
        },
        load: async () => (await import('./joinup.ts')).adapter,
    },
    'itaka-packages': {
        definition: {
            id: 'itaka-packages', name: 'ITAKA Last Minute', website: 'https://www.itaka.ee',
            docsUrl: 'https://www.itaka.ee/last-minute/', kinds: ['packages', 'deals'],
            description: 'Опубликованные пакеты ITAKA за двух взрослых из Таллина, Риги и Хельсинки. Акция подтверждается меткой конкретного тарифа.',
            requiredEnv: [], access: 'public', environment: 'production',
            activation: 'Публичные ориентиры доступны без ключа. Агентский доступ, вознаграждение и production-бронирование согласуются с оператором.',
            queryFields: ['origin', 'destination', 'departure', 'returnDate', 'nights', 'adults', 'currency'],
        },
        load: async () => (await import('./itaka.ts')).adapter,
    },
} as const satisfies Record<string, ProviderRegistration>
