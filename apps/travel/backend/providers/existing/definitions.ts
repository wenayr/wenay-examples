import type {ProviderRegistration} from '../../../src/provider-contract.ts'

export const existingProviders = {
    'google-flights': {
        definition: {id: 'google-flights', name: 'Google Flights', website: 'https://www.google.com/travel/flights',
            docsUrl: 'https://developers.google.com/travel/flights', kinds: ['flights'], requiredEnv: [], access: 'public',
            description: 'Опубликованные варианты авиакомпаний на выбранные даты и всех взрослых. Условия багажа и выбранного обратного рейса неизвестны.',
            activation: 'Ключ не требуется. Нужны доступные публичные страницы маршрута и curl на сервере.', queryFields: ['origin', 'destination', 'departure']},
        load: () => import('./google.ts').then(module => module.googleAdapter)
    },
    ryanair: {
        definition: {id: 'ryanair', name: 'Ryanair Fare Finder', website: 'https://www.ryanair.com',
            docsUrl: 'https://www.ryanair.com/ie/en/fare-finder', kinds: ['flights', 'deals'], requiredEnv: [], access: 'public',
            description: 'Публичные дневные минимумы EUR за одного в одну сторону. Экономия вычисляется относительно соседних дат.',
            activation: 'Ключ не требуется. Нужны маршрут Ryanair и дата вылета.', queryFields: ['origin', 'destination', 'departure']},
        load: () => import('./ryanair.ts').then(module => module.ryanairAdapter)
    },
    airbaltic: {
        definition: {id: 'airbaltic', name: 'airBaltic Calendar', website: 'https://www.airbaltic.com',
            docsUrl: 'https://www.airbaltic.com/en/book-flight', kinds: ['flights', 'deals'], requiredEnv: [], access: 'public',
            description: 'Публичные минимумы EUR за одного в одну сторону. Условия и групповая сумма проверяются у перевозчика.',
            activation: 'Ключ не требуется. Нужны маршрут airBaltic и дата вылета.', queryFields: ['origin', 'destination', 'departure']},
        load: () => import('./airbaltic.ts').then(module => module.airbalticAdapter)
    },
    duffel: {
        definition: {id: 'duffel', name: 'Duffel', website: 'https://duffel.com', docsUrl: 'https://duffel.com/docs/api/offer-requests',
            kinds: ['flights'], requiredEnv: ['DUFFEL_ACCESS_TOKEN'], access: 'partner', onboarding: 'partner-contract', environment: 'production',
            description: 'Действующие тарифы авиакомпаний для всей группы с известными условиями и сроком действия.',
            activation: 'Создайте организацию Duffel, получите доступ Live Mode и задайте серверный DUFFEL_ACCESS_TOKEN. Тестовые тарифы исключаются.',
            queryFields: ['origin', 'destination', 'departure']},
        load: () => import('./duffel.ts').then(module => module.duffelAdapter)
    },
    tez: {
        definition: {id: 'tez', name: 'TEZ TOUR Eesti', website: 'https://www.teztour.ee',
            docsUrl: 'https://www.teztour.ee/page/xml-gate.et.html', kinds: ['packages'], requiredEnv: [], access: 'public',
            description: 'Публичные пакеты из Таллина за двоих в Хургаду, Шарм-эль-Шейх и Родос. Цены получены от оператора.',
            activation: 'Ключ для публичного поиска не требуется. Для комиссии и оформления нужен договор агентства с оператором.',
            queryFields: ['destination', 'departure', 'returnDate']},
        load: () => import('./tez.ts').then(module => module.createTezAdapter())
    }
} as const satisfies Record<string, ProviderRegistration>
