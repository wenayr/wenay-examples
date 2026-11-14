import type {ProviderRegistration} from '../../../src/provider-contract.ts'

export const regionalProviders = {
    'direct-ana': {
        definition: {id: 'direct-ana', name: 'ANA — опубликованные тарифы', website: 'https://www.ana.co.jp/en/',
            docsUrl: 'https://www.ana.co.jp/en-jp/', kinds: ['flights'], requiredEnv: [], access: 'public', environment: 'production',
            description: 'Собственные опубликованные минимумы ANA за одного взрослого в нативной валюте на явно указанные даты. Японская витрина.',
            activation: 'Ключ не требуется. Выберите пару аэропортов. Наличие на группу, рынок продажи, багаж и итоговая сумма проверяются у ANA.',
            queryFields: ['origin', 'destination', 'departure', 'returnDate', 'adults']},
        load: async () => (await import('./direct-fares.ts')).directFareAdapter('direct-ana'),
    },
    'direct-vietnam': {
        definition: {id: 'direct-vietnam', name: 'Vietnam Airlines — опубликованные тарифы', website: 'https://www.vietnamairlines.com/',
            docsUrl: 'https://www.vietnamairlines.com/en-vn/', kinds: ['flights'], requiredEnv: [], access: 'public', environment: 'production',
            description: 'Собственные опубликованные минимумы Vietnam Airlines за одного взрослого. Вьетнамская витрина, конкретные даты и валюта источника.',
            activation: 'Ключ не требуется. Выберите аэропорты. Публичный минимум не подтверждает доступность всей группы и условия продажи из Эстонии.',
            queryFields: ['origin', 'destination', 'departure', 'returnDate', 'adults']},
        load: async () => (await import('./direct-fares.ts')).directFareAdapter('direct-vietnam'),
    },
    'direct-korean': {
        definition: {id: 'direct-korean', name: 'Korean Air — опубликованные тарифы', website: 'https://www.koreanair.com/',
            docsUrl: 'https://www.koreanair.com/flights/en/', kinds: ['flights'], requiredEnv: [], access: 'public', environment: 'production',
            description: 'Собственные опубликованные минимумы Korean Air за одного взрослого на явные даты. Нативная валюта и условия витрины сохраняются.',
            activation: 'Ключ не требуется. Нужны выбранные аэропорты. Цена на конкретную группу, багаж и рынок продажи проверяются у перевозчика.',
            queryFields: ['origin', 'destination', 'departure', 'returnDate', 'adults']},
        load: async () => (await import('./direct-fares.ts')).directFareAdapter('direct-korean'),
    },
    rakuten: {
        definition: {id: 'rakuten', name: 'Rakuten Travel', website: 'https://travel.rakuten.com/',
            docsUrl: 'https://webservice.rakuten.co.jp/documentation/vacant-hotel-search', kinds: ['hotels'],
            requiredEnv: ['RAKUTEN_APPLICATION_ID', 'RAKUTEN_ACCESS_KEY'], optionalEnv: ['RAKUTEN_AFFILIATE_ID'],
            access: 'partner', onboarding: 'self-service', environment: 'production',
            description: 'Поиск доступных японских гостиниц. Публикуется известная стоимость номера за первую ночь в JPY, полный срок не суммируется.',
            activation: 'Создайте разрешённое приложение Rakuten Web Service и задайте серверные application ID и access key. ' +
                'Выберите японский район радиусом до 3 км или собственные hotel IDs, один номер.',
            queryFields: ['checkIn', 'checkOut', 'adults', 'rooms', 'country', 'latitude', 'longitude', 'radiusKm', 'providerRefs.rakuten.hotelIds']},
        load: () => import('./rakuten.ts'),
    },
    travelline: {
        definition: {id: 'travelline', name: 'TravelLine Search', website: 'https://www.travelline.ru/',
            docsUrl: 'https://www.travelline.ru/dev-portal/docs/connect/intro/', kinds: ['hotels'],
            requiredEnv: ['TRAVELLINE_CLIENT_ID', 'TRAVELLINE_CLIENT_SECRET'], optionalEnv: ['TRAVELLINE_PROPERTY_IDS'],
            access: 'partner', onboarding: 'partner-contract', environment: 'production',
            description: 'Поиск размещения по гостиницам, предоставившим права партнёру TravelLine. Ответ содержит стоимость проживания и налоги.',
            activation: 'Подключите Partner API, получите client credentials и разрешение конкретного отельера. ' +
                'Передайте известные property IDs через сопоставления запроса или серверный TRAVELLINE_PROPERTY_IDS. Один номер на запрос. ' +
                'География подтверждается первой порцией Content до 200 объектов. Неизвестная привязка обозначается отдельно.',
            queryFields: ['checkIn', 'checkOut', 'adults', 'rooms', 'providerRefs.travelline.hotelIds']},
        load: () => import('./travelline.ts'),
    },
} as const satisfies Record<string, ProviderRegistration>
