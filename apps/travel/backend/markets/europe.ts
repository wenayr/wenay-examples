import type {MarketPartner, MarketRecord, tMarketCountry} from '../../src/market-contract.ts'

function partner(kind: MarketPartner['kind'], input: Omit<MarketPartner, 'kind' | 'relationship' | 'evidence'>): MarketPartner {
    return {...input, kind, relationship: 'based', evidence: [{title: input.name + ' — официальный канал',
        url: input.partnershipUrl, checkedAt: '2026-11-14'}]}
}

function serving(input: MarketPartner): MarketPartner {return {...input, relationship: 'serves-market'}}

const airlines = {
    airbaltic: partner('airline', {
        id: 'airbaltic', name: 'airBaltic', country: 'LV', iata: 'BT', website: 'https://www.airbaltic.com/',
        partnershipUrl: 'https://www.airbaltic.com/en/other-services/direct-connect', connection: 'price-adapter', providerIds: ['airbaltic'],
        description: 'Латвийский перевозчик с базами в странах Балтии. Подключён публичный календарь; агентский договор и оформление согласуются отдельно.',
    }),
    marabu: partner('airline', {
        id: 'marabu', name: 'Marabu Airlines', country: 'EE', website: 'https://flymarabu.com/',
        partnershipUrl: 'https://flymarabu.com/et/contact', connection: 'partner-onboarding',
        description: 'Эстонская авиакомпания с курортными рейсами из Германии. Чартерное сотрудничество и продажу через партнёров согласовать с компанией.',
    }),
    nyxair: partner('airline', {
        id: 'nyxair', name: 'NyxAir', country: 'EE', website: 'https://flynyx.com/',
        partnershipUrl: 'https://flynyx.com/charter?___from_store=en&___store=ee', connection: 'partner-onboarding',
        description: 'Эстонский оператор региональных, чартерных и ACMI-перевозок. Коммерческий запрос направляется в чартерный отдел.',
    }),
    ryanair: partner('airline', {
        id: 'ryanair', name: 'Ryanair', country: 'IE', iata: 'FR', website: 'https://www.ryanair.com/',
        partnershipUrl: 'https://corporate.ryanair.com/news/ryanair-booking-holdings-sign-partnership-agreement/',
        connection: 'price-adapter', providerIds: ['ryanair'],
        description: 'Ирландский перевозчик на европейских рынках. Календарь подключён; коммерческая перепродажа требует разрешённого OTA-канала.',
    }),
    norwegian: partner('airline', {
        id: 'norwegian', name: 'Norwegian', country: 'NO', iata: 'DY', website: 'https://www.norwegian.com/',
        partnershipUrl: 'https://agent.norwegian.com/', connection: 'partner-onboarding',
        description: 'Норвежский перевозчик обслуживает международные маршруты, включая Ригу. Уточнить действующие агентские каналы и рейсы на выбранные даты.',
    }),
    getjet: partner('airline', {
        id: 'getjet', name: 'GetJet Airlines', country: 'LT', website: 'https://getjet.aero/',
        partnershipUrl: 'https://getjet.aero/for-companies/', connection: 'partner-onboarding',
        description: 'Литовский ACMI- и чартерный оператор. Подключение через договор перевозки или организатора чартерной программы.',
    }),
    avionexpress: partner('airline', {
        id: 'avionexpress', name: 'Avion Express', country: 'LT', website: 'https://avionexpress.aero/',
        partnershipUrl: 'https://avionexpress.aero/', connection: 'partner-onboarding',
        description: 'Литовский ACMI- и чартерный оператор. Для продажи мест требуется соответствующий туроператорский либо коммерческий канал.',
    }),
    lot: partner('airline', {
        id: 'lot', name: 'LOT Polish Airlines', country: 'PL', iata: 'LO', website: 'https://www.lot.com/',
        partnershipUrl: 'https://www.lot.com/gb/en/help-center/contact', connection: 'partner-onboarding',
        description: 'Польский регулярный перевозчик. Оформление доступно через собственный сайт и согласованные агентские каналы.',
    }),
    wizzair: partner('airline', {
        id: 'wizzair', name: 'Wizz Air', country: 'HU', iata: 'W6', website: 'https://wizzair.com/',
        partnershipUrl: 'https://wizzair.com/', connection: 'official-site',
        description: 'Венгерский перевозчик европейских маршрутов. Конкретный рейс, правила агентской продажи и дополнительные услуги проверяются у компании.',
    }),
    enterair: partner('airline', {
        id: 'enterair', name: 'Enter Air', country: 'PL', iata: 'E4', website: 'https://enterair.pl/en/',
        partnershipUrl: 'https://business.enterair.pl/', connection: 'partner-onboarding',
        description: 'Польский чартерный перевозчик. Для чартерной программы используется официальный раздел For Business.',
    }),
    lufthansa: partner('airline', {
        id: 'lufthansa', name: 'Lufthansa', country: 'DE', iata: 'LH', website: 'https://www.lufthansa.com/',
        partnershipUrl: 'https://lhgroupairlines.com/ndc/en/', connection: 'price-adapter', providerIds: ['lufthansa-fares'],
        description: 'NDC-подключение через партнёрскую программу группы. У отдельного Lowest Fares API в реестре приостановлен приём новых приложений.',
    }),
    condor: partner('airline', {
        id: 'condor', name: 'Condor', country: 'DE', iata: 'DE', website: 'https://www.condor.com/',
        partnershipUrl: 'https://docs.ndc.condor.com/docs/21_3/access.html', connection: 'partner-api',
        description: 'Немецкий перевозчик с документированным NDC API. Доступ к документации и рабочим средам требует партнёрского допуска.',
    }),
    eurowings: partner('airline', {
        id: 'eurowings', name: 'Eurowings', country: 'DE', iata: 'EW', website: 'https://www.eurowings.com/',
        partnershipUrl: 'https://www.eurowings.com/en/information/ew4business/for-travel-agencies.html', connection: 'partner-onboarding',
        description: 'Официальная регистрация туристических агентств Eurowings. Корпоративный профиль компании оформляется по отдельным правилам.',
    }),
    airfrance: partner('airline', {
        id: 'airfrance', name: 'Air France', country: 'FR', iata: 'AF', website: 'https://www.airfrance.com/',
        partnershipUrl: 'https://klmprod.mashery.com/ndc_starting_guide', connection: 'partner-api',
        description: 'NDC API группы Air France-KLM требует допуска агентства и канала дистрибуции. Проверить договор и доступную точку продажи.',
    }),
    transaviafrance: partner('airline', {
        id: 'transaviafrance', name: 'Transavia France', country: 'FR', iata: 'TO', website: 'https://www.transavia.com/',
        partnershipUrl: 'https://www.transavia.com/', connection: 'official-site',
        description: 'Французский перевозчик группы Transavia. Тарифы и правила агентского оформления подтверждаются для конкретной поездки.',
    }),
    frenchbee: partner('airline', {
        id: 'frenchbee', name: 'French bee', country: 'FR', iata: 'BF', website: 'https://www.frenchbee.com/en',
        partnershipUrl: 'https://www.frenchbee.com/en', connection: 'official-site',
        description: 'Французский дальнемагистральный перевозчик. Выбирать действующие рейсы и проверять включённые услуги в выбранном тарифе.',
    }),
    britishairways: partner('airline', {
        id: 'britishairways', name: 'British Airways', country: 'GB', iata: 'BA', website: 'https://www.britishairways.com/',
        partnershipUrl: 'https://ndc.ba.com/', connection: 'partner-api',
        description: 'Официальный NDC-портал с условиями подключения агентств и документацией. Нужны разрешённый канал и права на оформление.',
    }),
    easyjet: partner('airline', {
        id: 'easyjet', name: 'easyJet', country: 'GB', iata: 'U2', website: 'https://www.easyjet.com/',
        partnershipUrl: 'https://www.easyjet.com/en/business/travel-trade-partners', connection: 'partner-onboarding',
        description: 'Продажа агентствами через одобренные каналы дистрибуции. Сведения путешественника передаются по правилам перевозчика.',
    }),
    jet2: partner('airline', {
        id: 'jet2', name: 'Jet2.com', country: 'GB', iata: 'LS', website: 'https://www.jet2.com/',
        partnershipUrl: 'https://trade.jet2holidays.com/', connection: 'partner-onboarding',
        description: 'Британский перевозчик группы Jet2. Агентское сотрудничество и пакетные продукты доступны через торговый канал группы.',
    }),
    virginatlantic: partner('airline', {
        id: 'virginatlantic', name: 'Virgin Atlantic', country: 'GB', iata: 'VS', website: 'https://www.virginatlantic.com/',
        partnershipUrl: 'https://flywith.virginatlantic.com/gb/en/partner-hub.html', connection: 'partner-onboarding',
        description: 'Partner Hub содержит материалы и правила для агентов. Регистрация и доступ к оформлению согласуются с перевозчиком.',
    }),
    ita: partner('airline', {
        id: 'ita', name: 'ITA Airways', country: 'IT', iata: 'AZ', website: 'https://www.ita-airways.com/',
        partnershipUrl: 'https://lhgroupairlines.com/ndc/en/', connection: 'partner-onboarding',
        description: 'Итальянский регулярный перевозчик. Доступ к NDC через каналы группы Lufthansa требует отдельной активации авиакомпании.',
    }),
    neos: partner('airline', {
        id: 'neos', name: 'Neos', country: 'IT', iata: 'NO', website: 'https://www.neosair.com/it',
        partnershipUrl: 'https://www.neosair.com/it', connection: 'official-site',
        description: 'Итальянский регулярный и курортный перевозчик. Для чартера и группового инвентаря нужны коммерческие условия компании.',
    }),
    aeroitalia: partner('airline', {
        id: 'aeroitalia', name: 'Aeroitalia', country: 'IT', iata: 'XZ', website: 'https://www.aeroitalia.com/',
        partnershipUrl: 'https://www.aeroitalia.com/', connection: 'partner-onboarding',
        description: 'На официальном сайте есть вход Agenzie. Права агентства и условия бронирования оформляются у перевозчика.',
    }),
    iberia: partner('airline', {
        id: 'iberia', name: 'Iberia', country: 'ES', iata: 'IB', website: 'https://www.iberia.com/',
        partnershipUrl: 'https://agencias.iberia.com/', connection: 'partner-onboarding',
        description: 'Iberia Agencias содержит NDC и агентские каналы. Выбрать одобренного агрегатора и получить разрешение на продажу.',
    }),
    vueling: partner('airline', {
        id: 'vueling', name: 'Vueling', country: 'ES', iata: 'VY', website: 'https://www.vueling.com/',
        partnershipUrl: 'https://partners.vueling.com/web/en-US', connection: 'partner-onboarding',
        description: 'Vueling Partners предоставляет агентский и групповой кабинет. Групповые возможности имеют собственные условия и порог числа путешественников.',
    }),
    aireuropa: partner('airline', {
        id: 'aireuropa', name: 'Air Europa', country: 'ES', iata: 'UX', website: 'https://www.aireuropa.com/',
        partnershipUrl: 'https://www.aireuropa.com/', connection: 'official-site',
        description: 'Испанский регулярный перевозчик. Действующие тарифы требуют запроса по маршруту и разрешённого канала продажи.',
    }),
    volotea: partner('airline', {
        id: 'volotea', name: 'Volotea', country: 'ES', iata: 'V7', website: 'https://www.volotea.com/en/',
        partnershipUrl: 'https://www.volotea.com/en/', connection: 'partner-onboarding',
        description: 'На официальном сайте доступен раздел Travel agencies. Подключение и правила продажи проверяются для агентства.',
    }),
    skyup: partner('airline', {
        id: 'skyup', name: 'SkyUp Airlines', country: 'UA', iata: 'PQ', website: 'https://skyup.aero/',
        partnershipUrl: 'https://skyup.aero/en/agent-partnership', connection: 'partner-onboarding',
        description: 'Украинская компания группы SkyUp. Агентский модуль и API предоставляются партнёрам; текущие операции проверять с базами вне Украины.',
    }),
    skyline: partner('airline', {
        id: 'skylineexpress', name: 'Skyline Express', country: 'UA', website: 'https://skylineexpress.aero/',
        partnershipUrl: 'https://skylineexpress.aero/en/about-us/general-information', connection: 'partner-onboarding',
        description: 'Украинский чартерный оператор с международными программами из других стран. Места приобретаются через организатора или по договору.',
    }),
    skyupmt: partner('airline', {
        id: 'skyupmt', name: 'SkyUp MT', country: 'MT', iata: 'U5', website: 'https://skyup.aero/',
        partnershipUrl: 'https://skyup.aero/en/acmi', connection: 'partner-onboarding',
        description: 'Мальтийская авиакомпания группы SkyUp. Обсуждать конкретное юрлицо, ACMI или программу из доступных зарубежных аэропортов.',
    }),
    aeroflot: partner('airline', {
        id: 'aeroflot', name: 'Аэрофлот', country: 'RU', iata: 'SU', website: 'https://www.aeroflot.ru/',
        partnershipUrl: 'https://www.aeroflot.ru/', connection: 'official-site',
        description: 'Российский перевозчик. Канал продажи, оплату, юрлицо и допустимый маршрут проверить по действующим ограничениям и договору.',
    }),
    s7: partner('airline', {
        id: 's7', name: 'S7 Airlines', country: 'RU', iata: 'S7', website: 'https://www.s7.ru/',
        partnershipUrl: 'https://www.s7.ru/', connection: 'official-site',
        description: 'Российский перевозчик. Агентский доступ и расчёты зависят от договора и допустимости конкретной операции.',
    }),
    pobeda: partner('airline', {
        id: 'pobeda', name: 'Победа', country: 'RU', iata: 'DP', website: 'https://www.flypobeda.ru/',
        partnershipUrl: 'https://www.flypobeda.ru/', connection: 'official-site',
        description: 'Российский бюджетный перевозчик. Дополнительные услуги и договорный канал проверяются по текущим условиям компании.',
    }),
    airastana: partner('airline', {
        id: 'airastana', name: 'Air Astana', country: 'KZ', iata: 'KC', website: 'https://airastana.com/',
        partnershipUrl: 'https://airastana.com/', connection: 'official-site',
        description: 'Казахстанский регулярный перевозчик. Запросить агентский доступ и права оформления на международных и внутренних направлениях.',
    }),
    flyarystan: partner('airline', {
        id: 'flyarystan', name: 'FlyArystan', country: 'KZ', iata: 'FS', website: 'https://flyarystan.com/',
        partnershipUrl: 'https://flyarystan.com/', connection: 'official-site',
        description: 'Казахстанский бюджетный перевозчик. Тариф, багаж и доступность продажи уточняются для выбранного маршрута.',
    }),
    scat: partner('airline', {
        id: 'scat', name: 'SCAT Airlines', country: 'KZ', iata: 'DV', website: 'https://www.scat.kz/en/',
        partnershipUrl: 'https://www.scat.kz/en/', connection: 'official-site',
        description: 'Казахстанский перевозчик регулярных и курортных программ. Коммерческий канал и наличие мест согласуются с компанией.',
    }),
    uzbekistan: partner('airline', {
        id: 'uzbekistanairways', name: 'Uzbekistan Airways', country: 'UZ', iata: 'HY', website: 'https://www.uzairways.com/',
        partnershipUrl: 'https://corp.uzairways.com/en/agents', connection: 'partner-onboarding',
        description: 'Официальная процедура назначения агентов различает внутренние и зарубежные агентства. Требуются анкета и подтверждающие документы.',
    }),
    qanotsharq: partner('airline', {
        id: 'qanotsharq', name: 'Qanot Sharq', country: 'UZ', iata: 'HH', website: 'https://qanotsharq.com/en',
        partnershipUrl: 'https://qanotsharq.com/en', connection: 'official-site',
        description: 'Узбекский перевозчик. Для интеграции запросить официальный доступ и правила агентской продажи у компании.',
    }),
    centrum: partner('airline', {
        id: 'centrumair', name: 'Centrum Air', country: 'UZ', iata: 'C6', website: 'https://centrum-air.com/ru',
        partnershipUrl: 'https://centrum-air.com/ru', connection: 'official-site',
        description: 'Узбекский перевозчик с собственным бронированием. Агентские условия и технический доступ согласуются через раздел сотрудничества.',
    }),
} satisfies Record<string, MarketPartner>

const tourism = {
    novatoursEE: partner('tour-operator', {
        id: 'novatours-ee', name: 'Novatours Eesti', country: 'EE', website: 'https://www.novatours.ee/',
        partnershipUrl: 'https://www.novatours.ee/', connection: 'partner-onboarding',
        description: 'Балтийский организатор пакетных поездок. Агентский договор, бронирование и условия комиссии согласовать с эстонским подразделением.',
    }),
    tezEE: partner('tour-operator', {
        id: 'tez-ee', name: 'TEZ TOUR Eesti', country: 'EE', website: 'https://www.teztour.ee/',
        partnershipUrl: 'https://www.teztour.ee/page/xml-gate.et.html', connection: 'price-adapter', providerIds: ['tez'],
        description: 'Подключены опубликованные тарифы из Таллина. XML-канал и агентское вознаграждение оформляются по условиям оператора.',
    }),
    joinupBaltic: partner('tour-operator', {
        id: 'joinup-baltic', name: 'Join UP! Baltic', country: 'LV', website: 'https://joinup.ee/',
        partnershipUrl: 'https://joinup.ee/en/last-minute', connection: 'price-adapter', providerIds: ['joinup-packages'],
        description: 'Балтийский оператор. Подключён эстонский каталог Last Minute из Таллина; другие рынки и оформление требуют отдельного согласования.',
    }),
    itakaEE: partner('tour-operator', {
        id: 'itaka-ee', name: 'ITAKA Eesti', country: 'EE', website: 'https://www.itaka.ee/',
        partnershipUrl: 'https://www.itaka.ee/last-minute/', connection: 'price-adapter', providerIds: ['itaka-packages'],
        description: 'Подключён опубликованный каталог эстонского сайта, включая отдельные вылеты из Риги и Хельсинки. Агентский доступ оформляется отдельно.',
    }),
    novatoursLV: partner('tour-operator', {
        id: 'novatours-lv', name: 'Novatours Latvija', country: 'LV', website: 'https://www.novatours.lv/',
        partnershipUrl: 'https://www.novatours.lv/', connection: 'partner-onboarding',
        description: 'Латвийское подразделение пакетного оператора. Получить договор и права продажи конкретной программы из Латвии.',
    }),
    itakaLV: partner('tour-operator', {
        id: 'itaka-lv', name: 'ITAKA Latvija', country: 'LV', website: 'https://www.itaka.lv/',
        partnershipUrl: 'https://www.itaka.lv/', connection: 'partner-onboarding',
        description: 'Латвийский канал оператора ITAKA. Условия агентского сотрудничества и инвентарь согласуются с местным подразделением.',
    }),
    novaturas: partner('tour-operator', {
        id: 'novaturas-lt', name: 'Novaturas', country: 'LT', website: 'https://www.novaturas.lt/',
        partnershipUrl: 'https://www.novaturas.lt/', connection: 'partner-onboarding',
        description: 'Литовский организатор поездок. Запросить агентский договор, допуск к бронированию и условия трансграничной перепродажи.',
    }),
    tezLT: partner('tour-operator', {
        id: 'tez-lt', name: 'TEZ TOUR Lietuva', country: 'LT', website: 'https://www.teztour.lt/',
        partnershipUrl: 'https://www.teztour.lt/', connection: 'partner-onboarding',
        description: 'Литовский рынок TEZ TOUR требует собственного коммерческого доступа. Тарифы эстонского адаптера не подтверждают наличие вылетов из Литвы.',
    }),
    itakaLT: partner('tour-operator', {
        id: 'itaka-lt', name: 'ITAKA Lietuva', country: 'LT', website: 'https://www.itaka.lt/',
        partnershipUrl: 'https://www.itaka.lt/', connection: 'partner-onboarding',
        description: 'Литовское подразделение оператора. Подключить агентский канал и подтвердить право продажи его пакетов.',
    }),
    itakaPL: partner('tour-operator', {
        id: 'itaka-pl', name: 'ITAKA Polska', country: 'PL', website: 'https://www.itaka.pl/',
        partnershipUrl: 'https://www.itaka.pl/', connection: 'partner-onboarding',
        description: 'Польский организатор пакетных поездок. Допуск к польскому инвентарю и расчёты согласуются отдельно от балтийских сайтов бренда.',
    }),
    rainbow: partner('tour-operator', {
        id: 'rainbow-pl', name: 'Rainbow', country: 'PL', website: 'https://r.pl/',
        partnershipUrl: 'https://r.pl/', connection: 'partner-onboarding',
        description: 'Польский организатор курортных и экскурсионных программ. Запросить агентское соглашение и технический канал.',
    }),
    coralPL: partner('tour-operator', {
        id: 'coral-pl', name: 'Coral Travel Poland', country: 'PL', website: 'https://www.coraltravel.pl/',
        partnershipUrl: 'https://www.coraltravel.pl/', connection: 'partner-onboarding',
        description: 'Польское подразделение туроператора. Согласовать регистрацию агентства, продажи за пределами Польши и расчёты.',
    }),
    tuiDE: partner('tour-operator', {
        id: 'tui-de', name: 'TUI Deutschland', country: 'DE', website: 'https://www.tui.com/',
        partnershipUrl: 'https://www.tui.com/', connection: 'partner-onboarding',
        description: 'Немецкий организатор пакетных поездок. Агентский допуск, контент и технический канал определяются договором для выбранного рынка.',
    }),
    dertour: partner('tour-operator', {
        id: 'dertour-de', name: 'DERTOUR', country: 'DE', website: 'https://www.dertour.de/',
        partnershipUrl: 'https://www.dertour.de/', connection: 'partner-onboarding',
        description: 'Немецкий организатор пакетов, гостиничных и экскурсионных продуктов. Подтвердить B2B-доступ и обязанности продавца.',
    }),
    schauinsland: partner('tour-operator', {
        id: 'schauinsland', name: 'schauinsland-reisen', country: 'DE', website: 'https://www.schauinsland-reisen.de/',
        partnershipUrl: 'https://www.schauinsland-reisen.de/', connection: 'partner-onboarding',
        description: 'Немецкий организатор отдыха. Запросить агентское сотрудничество, доступный инвентарь и разрешение на материалы.',
    }),
    clubmed: partner('tour-operator', {
        id: 'clubmed-fr', name: 'Club Med France', country: 'FR', website: 'https://www.clubmed.fr/',
        partnershipUrl: 'https://www.clubmed.fr/', connection: 'partner-onboarding',
        description: 'Курортные пакеты Club Med. Согласовать договор перепродажи, рынок бронирования и условия обслуживания.',
    }),
    fram: partner('tour-operator', {
        id: 'fram-fr', name: 'FRAM', country: 'FR', website: 'https://www.fram.fr/',
        partnershipUrl: 'https://www.fram.fr/', connection: 'partner-onboarding',
        description: 'Французские курортные и экскурсионные программы. Агентский канал и техническая интеграция предоставляются по договору.',
    }),
    kuoniFR: partner('tour-operator', {
        id: 'kuoni-fr', name: 'Kuoni France', country: 'FR', website: 'https://www.kuoni.fr/',
        partnershipUrl: 'https://www.kuoni.fr/agences/', connection: 'official-site',
        description: 'Французский продавец и организатор специализированных путешествий. Запросить условия работы стороннего агентства у компании.',
    }),
    tuiGB: partner('tour-operator', {
        id: 'tui-gb', name: 'TUI UK', country: 'GB', website: 'https://www.tui.co.uk/',
        partnershipUrl: 'https://www.tui.co.uk/', connection: 'partner-onboarding',
        description: 'Британский пакетный рынок TUI. До продажи согласовать агентский договор, точку продажи и применимые правила защиты путешественников.',
    }),
    jet2holidays: partner('tour-operator', {
        id: 'jet2holidays', name: 'Jet2holidays', country: 'GB', website: 'https://www.jet2holidays.com/',
        partnershipUrl: 'https://trade.jet2holidays.com/', connection: 'partner-onboarding',
        description: 'Британский организатор пакетов с торговым порталом для независимых агентов. Иностранное агентство согласует допуск отдельно.',
    }),
    audley: partner('tour-operator', {
        id: 'audley', name: 'Audley Travel', country: 'GB', website: 'https://www.audleytravel.com/',
        partnershipUrl: 'https://www.audleytravel.com/', connection: 'official-site',
        description: 'Индивидуальные путешествия по заказу. Условия сторонней перепродажи и совместного обслуживания нужно получить у компании.',
    }),
    alpitour: partner('tour-operator', {
        id: 'alpitour', name: 'Alpitour', country: 'IT', website: 'https://www.alpitour.it/',
        partnershipUrl: 'https://www.alpitour.it/', connection: 'partner-onboarding',
        description: 'Итальянский организатор пакетов с агентской сетью. Согласовать новый договор, инвентарь и доступ к бронированию.',
    }),
    veratour: partner('tour-operator', {
        id: 'veratour', name: 'Veratour', country: 'IT', website: 'https://www.veratour.it/',
        partnershipUrl: 'https://agenti.veratour.it/', connection: 'partner-onboarding',
        description: 'Итальянский курортный организатор. Vera Agenzia предоставляет торговый вход; новый агент получает допуск по правилам оператора.',
    }),
    edenviaggi: partner('tour-operator', {
        id: 'edenviaggi', name: 'Eden Viaggi', country: 'IT', website: 'https://www.edenviaggi.it/',
        partnershipUrl: 'https://www.edenviaggi.it/', connection: 'partner-onboarding',
        description: 'Итальянский туроператорский бренд группы Alpitour. При подключении проверить юридическое лицо договора и доступ к продуктам бренда.',
    }),
    civitatis: partner('agency', {
        id: 'civitatis', name: 'Civitatis', country: 'ES', website: 'https://www.civitatis.com/',
        partnershipUrl: 'https://www.civitatis.com/en/agencies/', connection: 'partner-onboarding',
        description: 'Площадка экскурсий и активностей с агентской регистрацией. Доступны комиссионные и нетто-условия по правилам программы.',
    }),
    juliatravel: partner('dmc', {
        id: 'juliatravel', name: 'Julià Travel', country: 'ES', website: 'https://juliatravel.com/',
        partnershipUrl: 'https://juliatravel.com/', connection: 'partner-onboarding',
        description: 'Испанские экскурсии и местные программы. Для агентской продажи согласовать подтверждение, отмены и язык обслуживания.',
    }),
    hotelbeds: partner('wholesaler', {
        id: 'hotelbeds', name: 'Hotelbeds', country: 'ES', website: 'https://discover.hotelbeds.com/',
        partnershipUrl: 'https://developer.hotelbeds.com/documentation/hotels/booking-api/',
        connection: 'price-adapter', providerIds: ['hotelbeds'],
        description: 'Гостиничный bedbank с реализованным адаптером. Доступ к ценам и продаже появляется после договора и выдачи production-ключей.',
    }),
    joinupUA: partner('tour-operator', {
        id: 'joinup-ua', name: 'Join UP! Ukraine', country: 'UA', website: 'https://joinup.ua/',
        partnershipUrl: 'https://joinup.ua/', connection: 'partner-onboarding',
        description: 'Украинский организатор международных программ. Проверять фактический зарубежный аэропорт вылета и наземную часть маршрута.',
    }),
    feerie: partner('tour-operator', {
        id: 'feerie', name: 'Феєрія', country: 'UA', website: 'https://feerie.com.ua/',
        partnershipUrl: 'https://feerie.com.ua/', connection: 'partner-onboarding',
        description: 'Украинские экскурсионные и курортные программы. Согласовать агентское соглашение и фактический состав поездки.',
    }),
    coralUA: partner('tour-operator', {
        id: 'coral-ua', name: 'Coral Travel Ukraine', country: 'UA', website: 'https://www.coraltravel.ua/',
        partnershipUrl: 'https://www.coraltravel.ua/', connection: 'partner-onboarding',
        description: 'Украинский оператор публикует вылеты из других стран. Договор, аэропорт старта и условия наземного участка проверяются отдельно.',
    }),
    biblioglobus: partner('tour-operator', {
        id: 'biblioglobus', name: 'Библио-Глобус', country: 'RU', website: 'https://www.bgoperator.ru/',
        partnershipUrl: 'https://www.bgoperator.ru/', connection: 'partner-onboarding',
        description: 'Российский организатор пакетов и гостиничных программ. Юридическую допустимость договора и расчётов проверять для конкретного контрагента.',
    }),
    coralRU: partner('tour-operator', {
        id: 'coral-ru', name: 'Coral Travel Russia', country: 'RU', website: 'https://www.coral.ru/',
        partnershipUrl: 'https://www.coral.ru/', connection: 'partner-onboarding',
        description: 'Российский рынок оператора. Доступ, право перепродажи и валютные расчёты согласуются с юридическим лицом поставщика.',
    }),
    leveltravel: partner('agency', {
        id: 'leveltravel', name: 'Level.Travel', country: 'RU', website: 'https://level.travel/',
        partnershipUrl: 'https://help-partners.level.travel/api', connection: 'partner-api',
        description: 'Платформа поиска и продажи туров с партнёрским API. Персональный ключ и допуск выдаются после обращения в партнёрскую службу.',
    }),
    kompas: partner('tour-operator', {
        id: 'kompas-kz', name: 'Kompas Kazakhstan', country: 'KZ', website: 'https://kompastour.com/kz/rus/',
        partnershipUrl: 'https://kompastour.com/kz/rus/', connection: 'partner-onboarding',
        description: 'Казахстанский организатор пакетных программ. Подключить агентское соглашение и согласовать рынок клиента.',
    }),
    selfie: partner('tour-operator', {
        id: 'selfietravel', name: 'Selfie Travel', country: 'KZ', website: 'https://www.selfietravel.kz/',
        partnershipUrl: 'https://www.selfietravel.kz/agency/', connection: 'partner-onboarding',
        description: 'B2B-оператор с опубликованной процедурой регистрации и перечнем документов. Допуск иностранного агентства проверяется отдельно.',
    }),
    advantour: partner('dmc', {
        id: 'advantour', name: 'Advantour', country: 'UZ', website: 'https://www.advantour.com/',
        partnershipUrl: 'https://www.advantour.com/', connection: 'partner-onboarding',
        description: 'Принимающие программы Узбекистана и Центральной Азии, включая Казахстан. Согласовать B2B-цены, подтверждение и обслуживание.',
    }),
    dolores: partner('dmc', {
        id: 'dolorestravel', name: 'Dolores Travel', country: 'UZ', website: 'https://dolorestravel.com/en',
        partnershipUrl: 'https://dolorestravel.com/en/contacts', connection: 'partner-onboarding',
        description: 'Узбекский принимающий оператор и DMC. Запросить договор для индивидуальных, групповых и корпоративных поездок.',
    }),
    orexca: partner('dmc', {
        id: 'orexca', name: 'OrexCA', country: 'UZ', website: 'https://www.orexca.com/',
        partnershipUrl: 'https://www.orexca.com/', connection: 'partner-onboarding',
        description: 'Туры и принимающие услуги Центральной Азии. Доступ к программе, цены и правила отмены подтверждаются по запросу.',
    }),
} satisfies Record<string, MarketPartner>

export const europeanMarkets = {
    EE: {
        summary: 'Базовый рынок эстонского агентства с вылетами из Таллина и балтийскими пакетными операторами.', airports: ['TLL', 'TAY'],
        airlines: [airlines.marabu, airlines.nyxair, serving(airlines.airbaltic)],
        tourism: [tourism.novatoursEE, tourism.tezEE, serving(tourism.joinupBaltic), tourism.itakaEE], notices: [],
    },
    LV: {
        summary: 'Рига служит региональным узлом регулярных рейсов и отправлением курортных программ.', airports: ['RIX', 'LPX'],
        airlines: [airlines.airbaltic, serving(airlines.ryanair), serving(airlines.norwegian)],
        tourism: [tourism.novatoursLV, tourism.itakaLV, tourism.joinupBaltic], notices: [],
    },
    LT: {
        summary: 'Регулярные перевозки из Вильнюса и Каунаса дополняются литовскими чартерными операторами и пакетными программами.',
        airports: ['VNO', 'KUN', 'PLQ'], airlines: [airlines.getjet, airlines.avionexpress, serving(airlines.airbaltic), serving(airlines.ryanair)],
        tourism: [tourism.novaturas, tourism.tezLT, tourism.itakaLT], notices: [],
    },
    PL: {
        summary: 'Крупный региональный рынок регулярных, бюджетных и чартерных перевозок с несколькими самостоятельными пакетными операторами.',
        airports: ['WAW', 'KRK', 'GDN', 'KTW'], airlines: [airlines.lot, serving(airlines.ryanair), serving(airlines.wizzair), airlines.enterair],
        tourism: [tourism.itakaPL, tourism.rainbow, tourism.coralPL], notices: [],
    },
    DE: {
        summary: 'Германские регулярные и курортные перевозчики сочетаются с развитой туроператорской дистрибуцией.',
        airports: ['FRA', 'MUC', 'BER', 'DUS'], airlines: [airlines.lufthansa, airlines.condor, airlines.eurowings],
        tourism: [tourism.tuiDE, tourism.dertour, tourism.schauinsland], notices: [],
    },
    FR: {
        summary: 'Французский рынок включает сетевые, бюджетные и дальнемагистральные компании, курортные пакеты и индивидуальные программы.',
        airports: ['CDG', 'ORY', 'NCE', 'LYS'], airlines: [airlines.airfrance, airlines.transaviafrance, airlines.frenchbee],
        tourism: [tourism.clubmed, tourism.fram, tourism.kuoniFR], notices: [],
    },
    GB: {
        summary: 'Британский рынок требует отдельных договорных условий точки продажи и сочетает регулярные рейсы с пакетной дистрибуцией.',
        airports: ['LHR', 'LGW', 'MAN', 'EDI'], airlines: [airlines.britishairways, airlines.easyjet, airlines.jet2, airlines.virginatlantic],
        tourism: [tourism.tuiGB, tourism.jet2holidays, tourism.audley], notices: [],
    },
    IT: {
        summary: 'Итальянские сетевые и курортные перевозки дополняют программы операторов с агентскими сетями.', airports: ['FCO', 'MXP', 'VCE', 'NAP'],
        airlines: [airlines.ita, airlines.neos, airlines.aeroitalia], tourism: [tourism.alpitour, tourism.veratour, tourism.edenviaggi], notices: [],
    },
    ES: {
        summary: 'Регулярные и региональные рейсы Испании дополняются гостиничной оптовой дистрибуцией, экскурсиями и активностями.',
        airports: ['MAD', 'BCN', 'PMI', 'AGP'], airlines: [airlines.iberia, airlines.vueling, airlines.aireuropa, airlines.volotea],
        tourism: [tourism.civitatis, tourism.juliatravel, tourism.hotelbeds], notices: [],
    },
    UA: {
        summary: 'Украинский рынок рассматривается через действующие международные компании и программы с фактическим отправлением за пределами Украины.',
        airports: ['KBP', 'IEV', 'LWO'], airlines: [airlines.skyup, airlines.skyline, serving(airlines.skyupmt)],
        tourism: [tourism.joinupUA, tourism.feerie, tourism.coralUA],
        notices: [{kind: 'airspace', title: 'Гражданское воздушное пространство закрыто',
            description: 'EASA CZIB-2022-01R14 ссылается на NOTAM о закрытии украинских FIR. Карточки компаний не подтверждают вылеты из украинских аэропортов.',
            evidence: [{title: 'EASA — Airspace of Ukraine, CZIB-2022-01R14',
                url: 'https://www.easa.europa.eu/en/domains/air-operations/czibs/czib-2022-01r14', checkedAt: '2026-11-14'}]}],
    },
    RU: {
        summary: 'Российские перевозчики и туристические поставщики учитываются с проверкой конкретного маршрута, контрагента, оплаты и допуска канала.',
        airports: ['SVO', 'DME', 'VKO', 'LED', 'OVB'], airlines: [airlines.aeroflot, airlines.s7, airlines.pobeda],
        tourism: [tourism.biblioglobus, tourism.coralRU, tourism.leveltravel],
        notices: [{kind: 'commercial', title: 'Проверка маршрута и контрагента',
            description: 'Правила ЕС ограничивают операции российских перевозчиков и отдельных воздушных судов. Гражданство пассажира не является общим запретом поиска.',
            evidence: [{title: 'EASA — restrictive measures, FAQ 136185',
                url: 'https://www.easa.europa.eu/en/faq/136185', checkedAt: '2026-11-14'}]}],
    },
    KZ: {
        summary: 'Казахстанский рынок объединяет регулярные и бюджетные перевозки, пакетные туры и принимающие программы Центральной Азии.',
        airports: ['ALA', 'NQZ', 'CIT', 'SCO'], airlines: [airlines.airastana, airlines.flyarystan, airlines.scat],
        tourism: [tourism.kompas, tourism.selfie, serving(tourism.advantour)], notices: [],
    },
    UZ: {
        summary: 'Узбекистан сочетает национальные и частные авиалинии с развитой принимающей инфраструктурой Шёлкового пути.',
        airports: ['TAS', 'SKD', 'BHK', 'UGC'], airlines: [airlines.uzbekistan, airlines.qanotsharq, airlines.centrum],
        tourism: [tourism.advantour, tourism.dolores, tourism.orexca], notices: [],
    },
} as const satisfies Record<Extract<tMarketCountry, 'EE' | 'LV' | 'LT' | 'PL' | 'DE' | 'FR' | 'GB' | 'IT' | 'ES' | 'UA' | 'RU' | 'KZ' | 'UZ'>, MarketRecord>
