# Подключение источников Wenay Travel

В реестре 25 независимых исполняемых адаптеров — девять авиационных, тринадцать гостиничных и три пакетных. Каждый выполняет запрос и нормализует ответ. Публичный путь есть у семи поставщиков. Остальные 18 требуют параметров партнёрского доступа. Настроенный ключ проверяется настоящим поиском. Один ответ агрегатора с несколькими продавцами остаётся одним источником.

Публичные источники — Google Flights, Ryanair Fare Finder, airBaltic Calendar, TEZ TOUR Eesti, Xotelo, Join UP! Last Minute, ITAKA Last Minute.

## Активация

1. Откройте «Источники» и выберите поставщика. Карточка показывает продукты, официальный контракт, необходимые имена серверных переменных и порядок получения доступа.
2. Получите собственные credentials и production-разрешение у поставщика. Добавьте значения в окружение серверного процесса. Перезапустите процесс, чтобы он получил новое окружение. Клиентскую сборку менять не требуется.
3. При необходимости включите явно указанную sandbox-переменную. Тестовый ответ появится в диагностике с отдельным статусом. Тестовые цены исключаются из потребительской выдачи и горящих предложений.
4. Выполните поиск на настоящие даты и подходящую географию. Ответ покажет статус каждого источника, время и число цен. Для поставщиков с собственными hotel IDs заполните сопоставления через «Параметры партнёрских каталогов». Идентификатор OSM не является кодом объекта у коммерческого поставщика.
5. Включайте production после проверки среды, валюты, размещения и условий. Оплату и бронирование текущий модуль поиска не выполняет. Комиссия появляется по условиям заключённого договора.

Приём новых приложений Lufthansa Open API приостановлен. Его Fares-адаптер предназначен для существующего партнёрского доступа. Публичный общий тестовый аккаунт Dida закрыт. Amadeus Self-Service закрыт в июле 2026 года и в этот реестр не включён. WebBeds, TBO и другие поставщики с закрытой актуальной схемой требуют отдельной партнёрской документации перед реализацией.

## Реестр

| Поставщик | Продукты | Обязательные серверные параметры | Первичный источник |
| --- | --- | --- | --- |
| Google Flights | flights | Ключ не нужен | [Контракт](https://developers.google.com/travel/flights) |
| Ryanair Fare Finder | flights, deals | Ключ не нужен | [Контракт](https://www.ryanair.com/ie/en/fare-finder) |
| airBaltic Calendar | flights, deals | Ключ не нужен | [Контракт](https://www.airbaltic.com/en/book-flight) |
| Duffel | flights | `DUFFEL_ACCESS_TOKEN` | [Контракт](https://duffel.com/docs/api/offer-requests) |
| TEZ TOUR Eesti | packages | Ключ не нужен | [Контракт](https://www.teztour.ee/page/xml-gate.et.html) |
| Sabre Bargain Finder Max | flights | `SABRE_ACCESS_TOKEN`, `SABRE_PCC` | [Контракт](https://developer.sabre.com/rest-api/bargain-finder-max/v5/index.html) |
| Travelport TripServices Air 11 | flights | `TRAVELPORT_ACCESS_TOKEN`, `TRAVELPORT_ACCESS_GROUP` | [Контракт](https://support.travelport.com/webhelp/JSONAPIs/Airv11/Content/Air11/Search/APIRef_Search.htm) |
| Skyscanner Flights Live Prices | flights | `SKYSCANNER_API_KEY` | [Контракт](https://developers.skyscanner.net/docs/flights-live-prices/overview) |
| Aviasales Data API | flights | `TRAVELPAYOUTS_TOKEN` | [Контракт](https://support.travelpayouts.com/hc/en-us/articles/203956163-Aviasales-Data-API) |
| Lufthansa Group Lowest Fares | flights | `LUFTHANSA_CLIENT_ID`, `LUFTHANSA_CLIENT_SECRET` | [Контракт](https://developer.lufthansa.com/docs/api_partner/offers/Lowest_Fares_New) |
| PriceTravel Connect | hotels | `PRICETRAVEL_CLIENT_ID`, `PRICETRAVEL_CLIENT_SECRET` | [Контракт](https://connect.pricetravel.com/docs/endpoints/rates/) |
| Hotelbeds | hotels | `HOTELBEDS_API_KEY`, `HOTELBEDS_SECRET` | [Контракт](https://developer.hotelbeds.com/documentation/hotels/booking-api/) |
| RateHawk / ETG | hotels | `RATEHAWK_KEY_ID`, `RATEHAWK_API_KEY` | [Контракт](https://docs.emergingtravel.com/docs/b2b-api/hotel-search/search-by-geo-coordinates/) |
| Booking.com Demand | hotels | `BOOKING_DEMAND_TOKEN`, `BOOKING_AFFILIATE_ID` | [Контракт](https://developers.booking.com/demand/docs/open-api/3.3/demand-api/accommodations/accommodations/search) |
| Expedia Rapid | hotels | `EXPEDIA_RAPID_KEY`, `EXPEDIA_RAPID_SECRET` | [Контракт](https://developers.expediagroup.com/rapid/lodging/shopping/about-shopping-api) |
| Nuitee Connect / LiteAPI | hotels | `LITEAPI_KEY` | [Контракт](https://docs.nuitee.com/reference/post_hotels-rates) |
| Travelgate HotelX | hotels | `TRAVELGATE_API_KEY`, `TRAVELGATE_CLIENT` | [Контракт](https://docs.travelgate.com/docs/apis/for-buyers/hotel-x-pull-buyers-api/booking-flow/search/) |
| DidaTravel | hotels | `DIDA_CLIENT_ID`, `DIDA_LICENSE_KEY` | [Контракт](https://apidoc.didatravel.com/booking-api/price-search.html) |
| Xotelo | hotels | Ключ не нужен | [Контракт](https://xotelo.com/) |
| Makcorps | hotels | `MAKCORPS_API_KEY` | [Контракт](https://www.makcorps.com/documentation/hotel-api-search-by-city-id/) |
| Agoda Demand | hotels | `AGODA_SITE_ID`, `AGODA_API_KEY`, `AGODA_API_BASE` | [Контракт](https://developer.agoda.com/demand/docs/copy-of-search-api) |
| GRNconnect | hotels | `GRNCONNECT_API_KEY`, `GRNCONNECT_API_BASE` | [Контракт](https://cdn.grnconnect.com/static-assets/documentation/latest/search/search_and_availability_request/) |
| TourMind | hotels | `TOURMIND_AGENT_CODE`, `TOURMIND_USERNAME`, `TOURMIND_PASSWORD`, `TOURMIND_API_BASE` | [Контракт](https://developers.tourmind.cn/hotel-apis/) |
| Join UP! Last Minute | packages, deals | Ключ не нужен | [Контракт](https://joinup.ee/en/last-minute) |
| ITAKA Last Minute | packages, deals | Ключ не нужен | [Контракт](https://www.itaka.ee/last-minute/) |

В «Источниках» также показаны дополнительные параметры среды, назначенные API base URLs и queryFields. Значения ключей, подписей и upstream debug туда не передаются. TRAVEL_DISABLED_PROVIDERS содержит список отключённых ID через запятую.

## Поиск и автоматическое обновление

После корректного изменения параметров интерфейс подбирает доступные источники по продукту и выполняет поиск. Изменения объединяются короткой задержкой. Ответ предыдущего запроса не заменяет новый. Сохранённый результат появляется сразу с исходным временем проверки, затем обновляется. Открытая видимая выдача повторно проверяется по TTL, при возвращении сети и видимости.

Реестр лениво загружает выбранные адаптеры. Отсутствующий ключ блокирует загрузку и сетевой запрос соответствующего поставщика. Один запрос выполняет до четырёх источников параллельно, а совпадающие запросы объединяются. Кеш успешного поиска живёт до 60 секунд, ошибки короче. Срок предложения проверяется отдельно. Сбой одного источника сохраняет результаты остальных. Каждая сетевая операция имеет ограничение времени.

GET /api/travel/providers возвращает возможности, имена missingEnv, configured, enabled, режим среды и последнюю проверку. POST /api/travel/provider-search принимает ProviderQuery. GET или POST /api/travel/deals возвращает только предложения с доказательством акции либо вычисленной разницей сопоставимых наблюдений. MCP использует list_providers и search_travel_offers.

Пример публичного гостиничного запроса

```json
{
  "kind": "hotels",
  "destination": "Bangkok",
  "checkIn": "2026-12-15",
  "checkOut": "2026-12-22",
  "adults": 2,
  "rooms": 1,
  "currency": "EUR",
  "providers": [
    "xotelo"
  ],
  "limit": 2
}
```

Пример текущей подборки горящих туров

```json
{
  "kind": "deals",
  "adults": 2,
  "currency": "EUR",
  "providers": [
    "joinup-packages",
    "itaka-packages"
  ]
}
```

Xotelo загружает каталог страницами. Обычная порция содержит до десяти отелей, увеличенная — до двадцати. Цены этих объектов запрашиваются с параллельностью до четырёх. Общее число относится к каталогу локации, затем применяется выбранный радиус. Частичность и следующая порция видны в выдаче. Поиск по координатам сопоставляет ближайшую пригодную локацию, а фактические координаты гостиниц дополнительно проверяются. Большая область карты сохраняет свой масштаб. Индивидуальное ограничение ETG в 70 км останавливает только его адаптер.

## Смысл цен

price.amount хранит сумму в основных единицах исходной валюты. basis различает цену всей группы, одного человека и номера за ночь. Net, retail и неизвестный состав показываются отдельно. Сумма за ночь не превращается в полную цену с неизвестными сборами. Группы одинаковых предложений требуют известного ключа рейсов или тарифа, условий и основания цены. Остальные варианты можно сопоставить в таблице с явными неизвестными полями.

Google возвращает опубликованные ориентиры всей поездки. Ryanair и airBaltic дают минимумы за одного в одну сторону. Aviasales Data API содержит кешированные поиски, Lufthansa Fares — один взрослый туда и обратно в валюте страны вылета. Xotelo публикует ориентиры OTA за номер за ночь. Join UP! и ITAKA возвращают часть публичной last-minute коллекции за двоих. Состав обратного рейса Join UP! не выводится из числа ночей.

Метка акции относится к конкретному источнику и предложению. Если источник не сообщил дату окончания акции, expiresAt остаётся null. Разница медианы соседних дат описывает наблюдение. Причина изменения цены показывается только при наличии опубликованного объяснения.

## Проверенные публичные ответы

14 ноября 2026 года обычный запрос Bangkok через Xotelo без hotel IDs получил два отеля и семь цен. Asia Hotel Bangkok у Agoda показывался от 61 EUR за номер за ночь. Страница Join UP! дала 14 пакетов, ITAKA — 25. Это опубликованные ориентиры, их окончательные условия подтверждает продавец. Состав коллекций и цены меняются.

Описание гостиничных контрактов и доказанной цепочки сопоставления находится в backend/providers/stays/README.md. Партнёрские заявки, документы агентства и договоры рассматриваются в соседних руководствах.
