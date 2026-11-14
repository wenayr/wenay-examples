import type {MarketPartner, MarketRecord, tMarketCountry} from '../../src/market-contract.ts'

const checkedAt = '2026-11-14'

function evidence(title: string, url: string) {
    return {title, url, checkedAt}
}

function airline(input: {
    id: string, name: string, iata: string, country: string, website: string, source: string,
    partnershipUrl?: string, description?: string, connection?: MarketPartner['connection'], providerIds?: string[], priceSource?: string
}): MarketPartner {
    const {source, partnershipUrl, description, connection, priceSource, ...identity} = input
    const sources = [evidence(input.name + ' — официальный код и перевозчик', source)]
    if (partnershipUrl) sources.push(evidence(input.name + ' — работа с агентствами', partnershipUrl))
    if (priceSource) sources.push(evidence(input.name + ' — опубликованные цены', priceSource))
    return {...identity, kind: 'airline', relationship: 'based', partnershipUrl: partnershipUrl ?? input.website,
        description: description ?? 'Поиск рейса у перевозчика. Агентские тарифы, выписка и коммерческий доступ согласуются с отделом продаж.',
        connection: connection ?? 'official-site', evidence: sources}
}

function supplier(input: {
    id: string, name: string, kind: Exclude<MarketPartner['kind'], 'airline'>, website: string,
    partnershipUrl: string, description: string, country?: string, relationship?: MarketPartner['relationship'],
    source?: string, providerIds?: string[], connection?: MarketPartner['connection']
}): MarketPartner {
    const {source, relationship, connection, ...identity} = input
    return {...identity, relationship: relationship ?? 'based', connection: connection ?? 'partner-onboarding',
        evidence: [evidence(input.name + ' — официальный порядок сотрудничества', source ?? input.partnershipUrl)]}
}

const airlines = {
    airchina: airline({id: 'airchina', name: 'Air China', iata: 'CA', country: 'CN', website: 'https://www.airchina.com.cn/',
        source: 'https://www.iata.org/en/about/members/airline-list/air-china-/16/'}),
    chinaeastern: airline({id: 'chinaeastern', name: 'China Eastern Airlines', iata: 'MU', country: 'CN', website: 'https://www.ceair.com/',
        source: 'https://www.iata.org/en/about/members/airline-list/china-eastern/58/'}),
    chinasouthern: airline({id: 'chinasouthern', name: 'China Southern Airlines', iata: 'CZ', country: 'CN', website: 'https://www.csair.com/',
        source: 'https://www.iata.org/en/about/members/airline-list/china-southern-airlines/54/'}),
    jal: airline({id: 'jal', name: 'Japan Airlines', iata: 'JL', country: 'JP', website: 'https://www.jal.co.jp/',
        source: 'https://tokyo-haneda.com/en/flight/company_list.html', partnershipUrl: 'https://www.ndc.jal.com/en/top.html',
        connection: 'partner-api', description: 'Официальный NDC и агентские каналы JAL. Подключение требует подходящего рынка продаж и соглашения.'}),
    ana: airline({id: 'ana', name: 'ANA', iata: 'NH', country: 'JP', website: 'https://www.ana.co.jp/en/',
        source: 'https://tokyo-haneda.com/en/flight/company_list.html', partnershipUrl: 'https://www.ana.co.jp/businesspartners/en/ndc/',
        connection: 'price-adapter', providerIds: ['direct-ana'],
        priceSource: 'https://www.ana.co.jp/en-jp/flights-from-tokyo-to-osaka',
        description: 'Собственные опубликованные цены ANA за одного взрослого. NDC-доступ оформляется отдельно для одобренных агентств.'}),
    peach: airline({id: 'peach', name: 'Peach Aviation', iata: 'MM', country: 'JP', website: 'https://www.flypeach.com/en',
        source: 'https://tokyo-haneda.com/en/flight/company_list.html'}),
    koreanair: airline({id: 'koreanair', name: 'Korean Air', iata: 'KE', country: 'KR', website: 'https://www.koreanair.com/',
        source: 'https://www.iata.org/en/about/members/airline-list/korean-air/96/', connection: 'price-adapter', providerIds: ['direct-korean'],
        priceSource: 'https://www.koreanair.com/flights/en/flights-from-seoul-to-tokyo',
        description: 'Собственные опубликованные тарифы Korean Air на конкретные даты за одного взрослого. Группа и багаж проверяются у перевозчика.'}),
    jejuair: airline({id: 'jejuair', name: 'Jeju Air', iata: '7C', country: 'KR', website: 'https://www.jejuair.net/',
        source: 'https://www.iata.org/en/about/members/airline-list/jeju-air/531/'}),
    jinair: airline({id: 'jinair', name: 'Jin Air', iata: 'LJ', country: 'KR', website: 'https://www.jinair.com/',
        source: 'https://www.iata.org/en/about/members/airline-list/?ordering=Relevance&page=4&region=Asia+Pacific&search='}),
    airindia: airline({id: 'airindia', name: 'Air India', iata: 'AI', country: 'IN', website: 'https://www.airindia.com/',
        source: 'https://www.iata.org/en/about/members/airline-list/air-india-/61/', partnershipUrl: 'https://ndc.airindia.com/en/ndc/faq',
        connection: 'partner-api', description: 'Air India NDC предлагает агентские каналы после регистрации и согласования коммерческого доступа.'}),
    indigo: airline({id: 'indigo', name: 'IndiGo', iata: '6E', country: 'IN', website: 'https://www.goindigo.in/',
        source: 'https://www.iata.org/en/about/members/airline-list/indigo/545/'}),
    akasa: airline({id: 'akasa', name: 'Akasa Air', iata: 'QP', country: 'IN', website: 'https://www.akasaair.com/',
        source: 'https://www.iata.org/en/about/members/airline-list/akasa-air/662/'}),
    thaiairways: airline({id: 'thaiairways', name: 'Thai Airways', iata: 'TG', country: 'TH', website: 'https://www.thaiairways.com/',
        source: 'https://www.iata.org/en/about/members/airline-list/thai-airways-international/182/'}),
    bangkokairways: airline({id: 'bangkokairways', name: 'Bangkok Airways', iata: 'PG', country: 'TH', website: 'https://www.bangkokair.com/',
        source: 'https://www.iata.org/en/about/members/airline-list/bangkok-airways-/328/'}),
    thaiairasia: airline({id: 'thaiairasia', name: 'Thai AirAsia', iata: 'FD', country: 'TH', website: 'https://www.airasia.com/',
        source: 'https://suvarnabhumi.airportthai.co.th/service/airport-guide/detail/AirlineInformation_BKK'}),
    thailionair: airline({id: 'thailionair', name: 'Thai Lion Air', iata: 'SL', country: 'TH', website: 'https://www.lionairthai.com/',
        source: 'https://www.iata.org/en/about/members/airline-list/?ordering=Relevance&page=6&region=Asia+Pacific&search='}),
    vietnamairlines: airline({id: 'vietnamairlines', name: 'Vietnam Airlines', iata: 'VN', country: 'VN',
        website: 'https://www.vietnamairlines.com/', source: 'https://www.iata.org/en/about/members/airline-list/vietnam-airlines/375/',
        connection: 'price-adapter', providerIds: ['direct-vietnam'],
        priceSource: 'https://www.vietnamairlines.com/en-vn/flights-from-hanoi-to-ho-chi-minh-city',
        description: 'Собственные опубликованные предложения Vietnam Airlines с аэропортами и датами. Цена за одного, итог проверяется при выборе тарифа.'}),
    vietjet: airline({id: 'vietjet', name: 'Vietjet Air', iata: 'VJ', country: 'VN', website: 'https://www.vietjetair.com/',
        source: 'https://www.iata.org/en/about/members/airline-list/vietjet/486/'}),
    bamboo: airline({id: 'bamboo', name: 'Bamboo Airways', iata: 'QH', country: 'VN', website: 'https://www.bambooairways.com/vn-en',
        source: 'https://www.iata.org/en/about/members/airline-list/bamboo-airways/552/'}),
    garuda: airline({id: 'garuda', name: 'Garuda Indonesia', iata: 'GA', country: 'ID', website: 'https://www.garuda-indonesia.com/',
        source: 'https://www.caam.gov.my/legislation-regulations/general/schedule-operators/'}),
    citilink: airline({id: 'citilink', name: 'Citilink', iata: 'QG', country: 'ID', website: 'https://www.citilink.co.id/',
        source: 'https://www.iata.org/en/about/members/airline-list/citilink/658/'}),
    lionair: airline({id: 'lionair', name: 'Lion Air', iata: 'JT', country: 'ID', website: 'https://www.lionair.co.id/',
        source: 'https://www.iata.org/en/about/members/airline-list/lion-air/651/'}),
    indonesiaairasia: airline({id: 'indonesiaairasia', name: 'Indonesia AirAsia', iata: 'QZ', country: 'ID', website: 'https://www.airasia.com/',
        source: 'https://www.caam.gov.my/legislation-regulations/general/schedule-operators/'}),
} as const satisfies Record<string, MarketPartner>

const tourism = {
    tripcom: supplier({id: 'tripcom', name: 'Trip.com', kind: 'agency', country: 'SG', relationship: 'serves-market',
        website: 'https://www.trip.com/', partnershipUrl: 'https://www.trip.com/partners/index',
        description: 'Affiliate-платформа и отдельный партнёрский API. Доступ к Open Platform и право продажи согласуются с Trip.com.',
        source: 'https://connect.trip.com/login?redirect=%2F'}),
    cits: supplier({id: 'cits', name: 'CITS / CTG Travel', kind: 'tour-operator', country: 'CN', website: 'https://www.cits.net/',
        partnershipUrl: 'https://www.cits.net/about/cits.html',
        description: 'Принимающие программы в Китае. Входящий бизнес CITS передан CTG Travel, сторону договора нужно подтвердить у поставщика.'}),
    chinahighlights: supplier({id: 'chinahighlights', name: 'China Highlights', kind: 'tour-operator', country: 'CN',
        website: 'https://www.chinahighlights.com/', partnershipUrl: 'https://www.chinahighlights.com/travel-agents.htm',
        description: 'Форма для агентств и консультантов, продающих индивидуальные поездки в Китай. Условия и расчёт тура согласуются после заявки.'}),
    jtbgmt: supplier({id: 'jtbgmt', name: 'JTB Global Marketing & Travel', kind: 'dmc', country: 'JP',
        website: 'https://www.jtbgmt.com/en/', partnershipUrl: 'https://www.japandmc.jtbbwt.com/',
        description: 'Японский DMC с агентскими услугами для FIT, групп и мероприятий. Договор и доступ к бронированию согласуются с JTB.',
        source: 'https://www.japanmeetings.org/plan-your-event/supplier-search/supplier-proflile/1708.html'}),
    his: supplier({id: 'his', name: 'HIS Japan', kind: 'tour-operator', country: 'JP', website: 'https://www.his.co.jp/en/',
        partnershipUrl: 'https://www.his-j.com/japan-tourist/',
        description: 'Принимающие программы и организация поездок в Японию через входящее подразделение HIS.',
        source: 'https://www.japanmeetings.org/plan-your-event/supplier-search/supplier-proflile/1705.html'}),
    rakuten: supplier({id: 'rakuten', name: 'Rakuten Travel', kind: 'agency', country: 'JP', website: 'https://travel.rakuten.com/',
        partnershipUrl: 'https://webservice.rakuten.co.jp/documentation/vacant-hotel-search', connection: 'price-adapter', providerIds: ['rakuten'],
        description: 'Японская гостиничная выдача через официальный VacantHotelSearch. Нужны свои applicationId и accessKey. Цена первой ночи сохраняется отдельно.'}),
    hanatouritc: supplier({id: 'hanatouritc', name: 'Hanatour ITC', kind: 'dmc', country: 'KR', website: 'https://www.hanatouritc.com/',
        partnershipUrl: 'https://www.hanatouritc.com/tour/about-us',
        description: 'Корейский принимающий DMC, работающий с зарубежными агентствами. FIT, группы и MICE подключаются через коммерческую команду.'}),
    modetour: supplier({id: 'modetour', name: 'Mode Tour', kind: 'tour-operator', country: 'KR', website: 'https://www.modetour.com/',
        partnershipUrl: 'https://www.modetournetwork.com/company/companyOutline',
        description: 'Корейский оператор и агентская сеть. Для перепродажи нужен отдельный договор и согласование рынка продаж.',
        source: 'https://www.kata.or.kr/search/02_search_pop.asp?businesscode=11&custcode=10020'}),
    trazy: supplier({id: 'trazy', name: 'Trazy', kind: 'agency', country: 'KR', website: 'https://www.trazy.com/',
        partnershipUrl: 'https://www.trazy.com/affiliate',
        description: 'Affiliate-программа экскурсий и активностей с отслеживаемыми ссылками. Коммерческие условия зависят от одобренного аккаунта.'}),
    thomascookindia: supplier({id: 'thomascookindia', name: 'Thomas Cook India', kind: 'tour-operator', country: 'IN',
        website: 'https://www.thomascook.in/', partnershipUrl: 'https://www.thomascook.in/about-us',
        description: 'Индийский оператор, работающий в B2C и B2B. Агентские условия и полномочия перепродажи согласуются отдельно.'}),
    makemytrip: supplier({id: 'makemytrip', name: 'MakeMyTrip myPartner', kind: 'agency', country: 'IN',
        website: 'https://www.makemytrip.com/', partnershipUrl: 'https://mypartner.makemytrip.com/agent/home',
        description: 'B2B-портал для туристических агентов. Приём иностранного агентства, средства оплаты и выписка требуют подтверждения MakeMyTrip.'}),
    tbo: supplier({id: 'tbo', name: 'TBO', kind: 'wholesaler', country: 'IN', website: 'https://www.tbo.com/',
        partnershipUrl: 'https://api.tbotechnology.in/AIS_APISpecification.aspx', connection: 'partner-api',
        description: 'Оптовая B2B-дистрибуция для агентств и API-покупателей. Официальный контракт API доступен, credentials выдаются после одобрения.'}),
    asiantrails: supplier({id: 'asiantrails', name: 'Asian Trails', kind: 'dmc', country: 'TH', website: 'https://www.asiantrails.travel/',
        partnershipUrl: 'https://www.asiantrails.travel/contact-us/international-offices/',
        description: 'Принимающий DMC с головным офисом в Бангкоке. Агентский договор, тарифы и eConnect согласуются с представителем.',
        source: 'https://www.asiantrails.travel/'}),
    dthtravel: supplier({id: 'dthtravel', name: 'DTH Travel', kind: 'dmc', country: 'TH', website: 'https://dth.travel/',
        partnershipUrl: 'https://dth.travel/about-us/',
        description: 'Принимающая компания, ранее Diethelm Travel. Поездки и условия работы для туроператоров согласуются с местной командой.'}),
    exotravel: supplier({id: 'exotravel', name: 'EXO Travel', kind: 'dmc', relationship: 'serves-market',
        website: 'https://www.exotravel.com/', partnershipUrl: 'https://www.exotravel.com/partner/partners-with-us',
        description: 'Региональный принимающий DMC. Форма партнёрства позволяет выбрать страну, виды поездок и данные агентства.'}),
    saigontourist: supplier({id: 'saigontourist', name: 'Saigontourist Travel', kind: 'tour-operator', country: 'VN',
        website: 'https://www.saigontourist.net/', partnershipUrl: 'https://www.saigontourist.net/',
        description: 'Вьетнамский оператор с принимающими программами. FIT, групповые цены и агентский договор запрашиваются у международного отдела.',
        source: 'https://2025.vietnam.travel/en/list-of-tour-operators-registered-to-welcome-tourists-under-resolution-11-nq-cp-dated-15th-january-2025/'}),
    vietravel: supplier({id: 'vietravel', name: 'Vietravel Asia', kind: 'tour-operator', country: 'VN', website: 'https://vietravelasia.com/',
        partnershipUrl: 'https://vietravelasia.com/agent-portal',
        description: 'Агентский портал с заявкой на учётную запись и предложение комиссии. Действующие условия поставщик присылает после проверки заявки.'}),
    panorama: supplier({id: 'panorama', name: 'Panorama Destination', kind: 'dmc', country: 'ID',
        website: 'https://www.panorama-destination.com/', partnershipUrl: 'https://www.panorama-destination.com/contact/',
        description: 'Индонезийский DMC с программами для FIT, групп и мероприятий. Доступ к B2B-бронированию согласуется с коммерческой командой.'}),
    traveloka: supplier({id: 'traveloka', name: 'Traveloka', kind: 'agency', relationship: 'serves-market', website: 'https://www.traveloka.com/',
        partnershipUrl: 'https://www.traveloka.com/en-en/partnership',
        description: 'Affiliate и B2B-партнёрство оформляются через Traveloka Partners Network. Схему, рынок продаж и доступ к инвентарю согласует поставщик.'}),
    smailing: supplier({id: 'smailing', name: 'Smailing Tour DMC', kind: 'dmc', country: 'ID', website: 'https://www.smailingdmc.com/',
        partnershipUrl: 'https://www.smailingdmc.com/smailing-tour-dmc-to-launch-new-b2b-platform',
        description: 'B2B-платформа для зарубежных агентов с отелями и активностями в Индонезии. Нужна одобренная агентская учётная запись.'}),
} as const satisfies Record<string, MarketPartner>

export const asianMarkets = {
    CN: {
        summary: 'Крупные международные и внутренние авиаузлы, местные авиакомпании и принимающие программы. CNY, рынок продаж и сторона договора проверяются отдельно.',
        airports: ['PEK', 'PKX', 'PVG', 'CAN'],
        airlines: [airlines.airchina, airlines.chinaeastern, airlines.chinasouthern],
        tourism: [tourism.tripcom, tourism.cits, tourism.chinahighlights], notices: [],
    },
    JP: {
        summary: 'Международные узлы Токио и Осаки, японские перевозчики, DMC и локальная гостиничная выдача Rakuten в JPY.',
        airports: ['HND', 'NRT', 'KIX'], airlines: [airlines.jal, airlines.ana, airlines.peach],
        tourism: [tourism.jtbgmt, tourism.his, tourism.rakuten], notices: [{kind: 'commercial', title: 'Цена первой ночи Rakuten',
            description: 'Официальный VacantHotelSearch передаёт dailyCharge только для первой ночи. Эта сумма требует проверки остальных ночей у продавца.',
            evidence: [evidence('Rakuten VacantHotelSearch — dailyCharge', 'https://webservice.rakuten.co.jp/documentation/vacant-hotel-search')]}],
    },
    KR: {
        summary: 'Международные и внутренние перелёты через Сеул, Пусан и Чеджу, местные DMC и агентские программы. Национальность гостя и рынок оплаты задаются отдельно.',
        airports: ['ICN', 'GMP', 'PUS', 'CJU'], airlines: [airlines.koreanair, airlines.jejuair, airlines.jinair],
        tourism: [tourism.hanatouritc, tourism.modetour, tourism.trazy], notices: [],
    },
    IN: {
        summary: 'Широкая внутренняя авиасеть и международные узлы Индии. TBO и myPartner требуют одобрения агентства и согласования рынка продаж.',
        airports: ['DEL', 'BOM', 'BLR', 'MAA'], airlines: [airlines.airindia, airlines.indigo, airlines.akasa],
        tourism: [tourism.thomascookindia, tourism.makemytrip, tourism.tbo], notices: [],
    },
    TH: {
        summary: 'Внутренние и международные рейсы, курорты и принимающие DMC. Багаж, сборы и условия конкретного перевозчика сохраняются в найденном тарифе.',
        airports: ['BKK', 'DMK', 'HKT', 'CNX'],
        airlines: [airlines.thaiairways, airlines.bangkokairways, airlines.thaiairasia, airlines.thailionair],
        tourism: [tourism.asiantrails, tourism.dthtravel, tourism.exotravel], notices: [],
    },
    VN: {
        summary: 'Местные перевозчики и принимающие операторы для Ханоя, Хошимина и курортных регионов. Пакеты, отдельные перелёты и услуги DMC имеют свои договоры.',
        airports: ['HAN', 'SGN', 'DAD', 'CXR'], airlines: [airlines.vietnamairlines, airlines.vietjet, airlines.bamboo],
        tourism: [tourism.saigontourist, tourism.vietravel, tourism.exotravel], notices: [],
    },
    ID: {
        summary: 'Международные узлы Джакарты и Бали и обширная внутренняя авиасеть. Принимающие услуги можно запрашивать через местные DMC и B2B-платформы.',
        airports: ['CGK', 'DPS', 'SUB', 'UPG'], airlines: [airlines.garuda, airlines.citilink, airlines.lionair, airlines.indonesiaairasia],
        tourism: [tourism.panorama, tourism.traveloka, tourism.smailing], notices: [],
    },
} as const satisfies Record<Extract<tMarketCountry, 'CN' | 'JP' | 'KR' | 'IN' | 'TH' | 'VN' | 'ID'>, MarketRecord>
