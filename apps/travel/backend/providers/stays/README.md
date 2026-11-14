# Источники размещения

Поставщики загружаются динамически через `stayProviders`. Адаптер принимает
`ProviderQuery` и серверные `ProviderDeps`, строит запрос поставщика и разбирает его
ответ. Секреты читаются только из `deps.env`. Результат содержит источник, валюту,
основание суммы, время проверки и условия. Отсутствующие ключи дают `requires-access`,
отсутствующее сопоставление — `unsupported-query`, сбой сети или схемы — `unavailable`.
Состояние `sandbox` сохраняется для диагностики и исключается из потребительских цен
общим реестром.

| Источник | Запрос и документация | Серверный доступ | Выбор места и проверка |
|---|---|---|---|
| Hotelbeds | [Booking API](https://developer.hotelbeds.com/documentation/hotels/booking-api/) `POST /hotel-api/1.0/hotels` | `HOTELBEDS_API_KEY`, `HOTELBEDS_SECRET`, SHA-256 с текущей секундой | Координаты или `providerRefs.hotelbeds.hotelIds`. Проверены запрос и ответ по схеме. |
| RateHawk / ETG | [SERP geo](https://docs.emergingtravel.com/docs/b2b-api/hotel-search/search-by-geo-coordinates/) `POST /api/b2b/v3/search/serp/geo/` | `RATEHAWK_KEY_ID`, `RATEHAWK_API_KEY`, Basic | Координаты, радиус и гражданство. Проверены запрос и ответ по схеме. |
| Booking.com Demand | [Search 3.3](https://developers.booking.com/demand/docs/open-api/3.3/demand-api/accommodations/accommodations/search) `POST /3.3/accommodations/search` | `BOOKING_DEMAND_TOKEN`, `BOOKING_AFFILIATE_ID` | Координаты, Booking city ID или accommodation IDs. Проверены многовалютный ответ и запрос. |
| Expedia Rapid | [Shopping](https://developers.expediagroup.com/rapid/lodging/shopping/about-shopping-api) `GET /v3/properties/availability` | `EXPEDIA_RAPID_KEY`, `EXPEDIA_RAPID_SECRET`, EAN SHA-512 | Сопоставленные `property_id` из Content API. Проверены суммы и размещение по схеме. |
| Nuitee Connect / LiteAPI | [Rates](https://docs.nuitee.com/reference/post_hotels-rates) `POST /v3.0/hotels/rates` | `LITEAPI_KEY` | Координаты, IATA или hotel IDs, гражданство. Проверены все номера и публичный ценовой минимум. |
| Travelgate HotelX | [Search](https://docs.travelgate.com/docs/apis/for-buyers/hotel-x-pull-buyers-api/booking-flow/search/) GraphQL | `TRAVELGATE_API_KEY`, `TRAVELGATE_CLIENT`, при необходимости `TRAVELGATE_CONTEXT` | Сопоставленные hotel codes и фактический `adultAges`. Проверены запрос, Net/Gross и minimumSellingPrice. |
| DidaTravel | [PriceSearch](https://apidoc.didatravel.com/booking-api/price-search.html) `POST /api/rate/pricesearch?$format=json` | `DIDA_CLIENT_ID`, `DIDA_LICENSE_KEY` | Сопоставленные HotelID, гражданство и одинаковое размещение. Проверены даты и сумма номеров по схеме. |
| Xotelo | [Публичные list/rates](https://xotelo.com/) `GET /api/list`, `GET /api/rates` | Ключ для этих двух операций не нужен | Город или IATA через Wikidata, либо Xotelo location/hotel key. Живой поиск подтвердил цены. |
| Makcorps | [City prices](https://www.makcorps.com/documentation/hotel-api-search-by-city-id/) `GET /city`, `GET /mapping` | `MAKCORPS_API_KEY` | Город через Mapping API или его destinationId. Проверены запрос и цены продавцов по схеме. |
| Agoda Demand | [JSON Search](https://developer.agoda.com/demand/docs/copy-of-search-api) `POST /api/v4/property/availability` | `AGODA_SITE_ID`, `AGODA_API_KEY`, `AGODA_API_BASE` | Сопоставленные propertyIds. Host выбранной среды выдаёт менеджер Agoda. Проверены totalPayment и обязательные минимумы продажи. |
| GRNconnect | [Availability v3](https://cdn.grnconnect.com/static-assets/documentation/latest/search/search_and_availability_request/) `POST /api/v3/hotels/availability` | `GRNCONNECT_API_KEY`, `GRNCONNECT_API_BASE` | Сопоставленные hotel_codes. Host выдаёт поставщик. Проверены bundled rooms и MSP. |
| TourMind | [TMS 2.0](https://developers.tourmind.cn/hotel-apis/) `POST /v2/HotelDetail` | `TOURMIND_AGENT_CODE`, `TOURMIND_USERNAME`, `TOURMIND_PASSWORD`, `TOURMIND_API_BASE` | Сопоставленные HotelCodes. Host выбранной среды согласуется с поставщиком. Проверены PaxRooms, даты, валюта и TotalPrice. |

Параметр `<PROVIDER>_SANDBOX=true` обозначает тестовую среду и для адресов с отдельным
sandbox host, и для сервисов с одним host и разными ключами. Нужны ключи, выданные для
соответствующей среды. Для Agoda, GRNconnect и TourMind host задаётся явной серверной
настройкой `*_API_BASE` из партнёрского аккаунта. Примерные, старые и региональные host
не подставляются автоматически. Путь операции добавляет сам адаптер.

Ценовые поля сохраняют смысл поставщика. У Hotelbeds Net явно получает `price.type =
'net'`, у розничного SellingRate — `retail`. Travelgate использует minimumSellingPrice
с приоритетом перед Gross, затем сохраняет Net отдельно при отсутствии розничной цены.
Agoda соблюдает minSellPrice и refSellAmount, GRNconnect — MSP, Nuitee — suggestedSellingPrice.
Expedia разбирает только property-inclusive total в нужной валюте и суммирует
подтверждённые стоимости каждого размещения. Booking выбирает сумму и валюту из одной
ветви ответа, сохраняя USD как USD при отсутствии цены в валюте заказчика.

`adults` задаёт общее число взрослых, `rooms` — число номеров. Для API с отдельным
размещением взрослые распределяются последовательно и равномерно, например 3 взрослых
и 2 номера дают размещения 2 и 1. Hotelbeds, Dida и TourMind в этом адаптере требуют
одинаковое размещение во всех номерах. При несовместимом распределении возвращается
объяснение. Возраст для Travelgate берётся из переданного `adultAges`.

`comparisonKey` гостиничных предложений остаётся пустым до надёжного сопоставления
объекта, номера, питания, отмены и всех сборов. Совпадение названия отеля само по себе
не устанавливает такую эквивалентность. Внешняя цена за номер за ночь сохраняется с
`basis = 'room-night'` и не превращается в подтверждённую сумму всей поездки.

Xotelo по названию города ищет кандидатов Wikidata, читает их Tripadvisor ID `P3134`
и координаты `P625`. При неоднозначности возвращается уточнение. Для введённого IATA
название города берётся из мирового справочника аэропортов. Кандидаты проверяются
по географическому фокусу, когда он передан. Затем загружается небольшой список
Xotelo, из него выбирается до пяти отелей и запрашиваются цены на выбранные даты.
Поставщики цен показаны в заголовках, а название отеля — в `hotel.name`. Картинка
сохраняет ссылку на страницу отеля и указание происхождения.

Живая проверка 14 ноября 2026 года в 03:58 по Москве прошла для обычного запроса
«Bangkok», 15–22 декабря, двое взрослых, один номер, EUR, без ключа и без ручных IDs.
Для Eastin Grand Hotel Phayathai получены ориентиры 171 EUR от Booking.com, 139 EUR от
Agoda и 134 EUR от Official Hotel за номер за ночь. Для Asia Hotel Bangkok — 84 EUR
от Booking.com, 61 EUR от Agoda и 63 EUR от Trip.com. Всего вернулись семь цен двух
отелей с координатами и фотографиями. Налоги и эквивалентность типов номеров этими
ответами не подтверждены. Цены меняются при следующем запросе.

Проверки requests/parsers остальных одиннадцати адаптеров используют ответы по
официальным схемам и не подтверждают подключение production аккаунта агентства.
Обычный запрос пойдёт поставщику после настройки доступа. Методы создания брони,
списания денег и изменения заказов здесь не вызываются.

Amadeus Self-Service в этот список действующих интеграций не включён. Официальный
портал сообщает о закрытии 17 июля 2026 года. Для нового подключения нужен отдельный
Enterprise контракт и его согласованная схема. У TBO, WebBeds и HyperGuest без
партнёрского доступа не получены достаточные актуальные публичные JSON-схемы для
реализации в этой итерации. Они не включены в число реализованных адаптеров.
