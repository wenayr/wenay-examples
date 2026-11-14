import type {ProviderRegistration} from '../../../src/provider-contract.ts'

export const aviationProviders = {
    'sabre-flights': {
        definition: {id: 'sabre-flights', name: 'Sabre Bargain Finder Max', website: 'https://www.sabre.com',
            docsUrl: 'https://developer.sabre.com/rest-api/bargain-finder-max/v5/index.html', kinds: ['flights'], access: 'partner',
            description: 'Глобальный поиск агентских авиапредложений BFM v5. Полная сумма на конкретные даты за всех взрослых.',
            requiredEnv: ['SABRE_ACCESS_TOKEN', 'SABRE_PCC'],
            activation: 'Подключите договор Sabre с BFM v5. Получайте и обновляйте bearer token на сервере агентства, добавьте его и PCC в окружение.',
            queryFields: ['origin', 'destination', 'departure', 'returnDate', 'adults', 'currency']},
        load: async () => (await import('./sabre.ts')).default
    },
    'travelport-flights': {
        definition: {id: 'travelport-flights', name: 'Travelport TripServices Air 11', website: 'https://www.travelport.com',
            docsUrl: 'https://support.travelport.com/webhelp/JSONAPIs/Airv11/Content/Air11/Search/APIRef_Search.htm', kinds: ['flights'], access: 'partner',
            description: 'Глобальные GDS-предложения с BestCombinablePrice за весь маршрут. NDC включается при наличии доступа агентства.',
            requiredEnv: ['TRAVELPORT_ACCESS_TOKEN', 'TRAVELPORT_ACCESS_GROUP'], optionalEnv: ['TRAVELPORT_INCLUDE_NDC'],
            activation: 'Подключите TripServices Air 11, получите access group и серверный OAuth bearer token. Обновляйте токен по договору. NDC отдельно.',
            queryFields: ['origin', 'destination', 'departure', 'returnDate', 'adults', 'currency']},
        load: async () => (await import('./travelport.ts')).default
    },
    'skyscanner-flights': {
        definition: {id: 'skyscanner-flights', name: 'Skyscanner Flights Live Prices', website: 'https://www.skyscanner.net',
            docsUrl: 'https://developers.skyscanner.net/docs/flights-live-prices/overview', kinds: ['flights'], access: 'partner',
            description: 'Создание поиска и получение цен авиакомпаний и агентств по всему миру. Сумма за всю группу, экономический класс.',
            requiredEnv: ['SKYSCANNER_API_KEY'], optionalEnv: ['SKYSCANNER_MARKET', 'SKYSCANNER_LOCALE'],
            activation: 'Заключите коммерческий договор Skyscanner Travel API и добавьте серверный API key. Багаж требует отдельного подключения данных.',
            queryFields: ['origin', 'destination', 'departure', 'returnDate', 'adults', 'currency']},
        load: async () => (await import('./skyscanner.ts')).default
    },
    'travelpayouts-flights': {
        definition: {id: 'travelpayouts-flights', name: 'Aviasales Data API', website: 'https://www.aviasales.com',
            docsUrl: 'https://support.travelpayouts.com/hc/en-us/articles/203956163-Aviasales-Data-API', kinds: ['flights'], access: 'partner',
            description: 'Ориентиры за одного взрослого из кеша поисков Aviasales. Метод specific dates использует последние 48 часов, общие кеши могут храниться до 7 дней.',
            requiredEnv: ['TRAVELPAYOUTS_TOKEN'], optionalEnv: ['TRAVELPAYOUTS_MARKET'],
            activation: 'Получите персональный токен в партнёрском кабинете Travelpayouts. Этот Data API предоставляет кеш, живой поиск подключается отдельно.',
            queryFields: ['origin', 'destination', 'departure', 'returnDate', 'currency']},
        load: async () => (await import('./travelpayouts.ts')).default
    },
    'lufthansa-fares': {
        definition: {id: 'lufthansa-fares', name: 'Lufthansa Group Lowest Fares', website: 'https://www.lufthansa.com',
            docsUrl: 'https://developer.lufthansa.com/docs/api_partner/offers/Lowest_Fares_New', kinds: ['flights'], access: 'partner',
            description: 'Партнёрский Lowest Fares по конкретным датам за одного взрослого туда и обратно. Валюта определяется страной вылета.',
            requiredEnv: ['LUFTHANSA_CLIENT_ID', 'LUFTHANSA_CLIENT_SECRET'], onboarding: 'paused', environment: 'production',
            activation: 'Используйте действующий партнёрский договор с правом Fares и client credentials. Приём новых приложений Lufthansa Open API приостановлен.',
            queryFields: ['origin', 'destination', 'departure', 'returnDate', 'currency']},
        load: async () => (await import('./lufthansa.ts')).default
    }
} as const satisfies Record<string, ProviderRegistration>
