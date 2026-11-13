# Northstar — интерфейсы и интеграции

Справочник к [README](README.md): продуктовый HTTP-фасад поиска, постраничный архив переписки с индексом статей и необязательное подключение внешней контент-студии.

## Публикации внешней контент-студии

Необязательный `CONTENT_CONNECTIONS_JSON` — server-only карта support org → настроенный Content origin/organization/reader. Например, для локального стенда значение процесса:

```json
{"northstar":{"url":"http://127.0.0.1:3817","orgId":"northstar","account":"reader","password":"reader-pass"}}
```

Для внешнего сервиса используйте выделенную reader-учётную запись и передавайте секрет через защищённое окружение. Конфигурация не отправляется в UI и не выбирается клиентом. Endpoint CMS обязан быть сервисом content; отдельный common2 client открывает только `published` authority resource, без команд и редакторских views. `identity.me()` проверяется при каждом чтении: writer/editor/publisher/owner credentials отклоняются. Public CMS contract принадлежит студии и проверяется там через satisfies; копия `published-contract.ts` остаётся небольшим типом потребителя.

`content.control.list(supportOrgId)` возвращает `{configured,articles}`, `read({orgId,slug})` — текущую опубликованную версию. ACL организации поддержки проверяется до и после remote IO. Нет кеша результатов на сервере: снятая публикация отказывает при следующем чтении. Отсутствующая настройка показывает спокойное состояние «не подключено». Ошибка источника не заменяется старым текстом или копией в local articles. База знаний UI отдельно показывает read-only публикации: текст/цитаты/ссылки, изображения как описание. Запрошенная статья является снимком, показано время чтения; обновите её для проверки новой версии.

`apps/content/backend/integration-check.ts` проверяет два настоящих сервиса: draft/review privacy, reader-only, tenant mapping, publish/withdraw/rollback, неизменность local articles, отзыв роли во время чтения и offline. Запуск из исходного `apps/content`: `npm run test:integration`. Эта межпроектная проверка не является зависимостью самостоятельной поддержки. Подключение не изменяет источники AI-помощника поддержки.

## Архив переписки и индекс

В `views.workspace` входят последние 20 разрешённых сообщений и `messageCount`. Предыдущие сообщения и поиск по всей истории доступны через `resources.conversation.control.page({orgId,ticketId,beforeId,query,limit})`: до 50 записей, курсор — идентификатор граничного сообщения. Ответ содержит `messages`, `nextBeforeId`, `total`, `revision`. Новые ответы не сдвигают ранее полученную границу; чужая или скрытая граница отклоняется. В UI архив открывается порциями по20; смена версии/роли закрывает прежний материал. Полная история сохраняется на authority, предел200сообщений на обращение остаётся явным ограничением примера.

Нормализованный локальный индекс статей хранит организацию и revision. `createReconciler` обновляет его по изменениям; запрос немедленно проверяет опубликованность/версию/членство по исходному состоянию. Только что опубликованная версия индексируется при первом запросе, снятая исключается сразу. Индекс восстанавливается из основного архива и не требует второго durable писателя. Модели, embeddings и внешнего поиска нет.

## Узкий продуктовый API поиска

На authority доступен `POST /api/product/search/published`, описание — `GET /api/product/openapi.json`. Реализация использует публичные `createHttpFacadeServer`/`createHttpFacadeOpenApi` common2, а тип входа, проверка и OpenAPI выводятся из одного `SEARCH_INPUT` через `InferInput`/`buildInputValidate`/`inputJsonSchema`.

Вход — стандартный bearer сервиса; пример для Node22+, без установки другого SDK:

```js
const origin = 'http://127.0.0.1:3810'
const login = await fetch(origin + '/api/support/login', {
    method: 'POST', headers: {'content-type': 'application/json'},
    body: JSON.stringify({args: [{account: 'customer', password: 'customer-pass'}]})
}).then(response => response.json())
const result = await fetch(origin + '/api/product/search/published', {
    method: 'POST', headers: {'content-type': 'application/json', authorization: 'Bearer ' + login.value.token},
    body: JSON.stringify({args: [{orgId: 'northstar', query: 'приглашение', limit: 3, requestId: crypto.randomUUID()}]})
}).then(response => response.json())
console.log(result)
```

Фасад выдаёт только текущие опубликованные статьи; административных методов в этом OpenAPI нет. Проверяются членство, типы, размер запроса, лимит выдачи и версия источника. Ответ `no-store`; это свежее чтение без кеширования текста в квитанции команды. Если подключён Metering, поиск резервирует одну тестовую единицу через уже используемый адаптер, повтор requestId не выполняет операцию повторно. Доставку результата при сетевой неопределённости не объявляем exactly-once.

HTTP-продуктовая поверхность находится на authority. На serving-узлах остаются обычные SC1 представления/ресурсы и UI; для HTTP маршрутизируйте `/api/product/*` на authority.

### Машинный потребитель

Владелец открывает стандартный `resources.productKeys` и вызывает `control.issue`:

```ts
const issued = await keys.control.issue({
    requestId: 'knowledge-consumer-1', orgId: 'northstar', label: 'Knowledge consumer',
    scopes: ['knowledge:search'], days: 30
})
```

Здесь `keys` — `resource.current().remote` после открытия ресурса через common2. Ответ содержит
`id`, `account: 'product:<id>'`, `secret` и `expiresAt`. Секрет — 32 случайных байта, в Store и журнал
попадает только SHA-256. Срок — 1–90 дней, до 100 ключей на стенд; очередь выпуска ограничена.
Повтор тех же параметров с тем же `requestId` возвращает тот же ключ с `secret: null`, включая повтор
после рестарта. Изменённые параметры с прежним `requestId` отклоняются. При потерянном первом ответе
отзовите ключ и выпустите новый: восстановить исходный секрет нельзя.

Машинный потребитель входит через обычный `POST /api/support/login` с `args: [{account: issued.account,
password: issued.secret}]` или через `createServiceClient` с
`auth: {credentials: {account: issued.account, password: issued.secret}}`. Полученный библиотечный bearer
работает на том же HTTP-поиске. В RPC доступен только authority-ресурс `productSearch`:

```ts
const found = await search.control.published({
    orgId: 'northstar', query: 'гарантия', limit: 3, requestId: 'search-001'
})
```

Здесь `search` — `resource.current().remote` открытого `resources.productSearch`. Scope `knowledge:search`
даёт только текущие опубликованные статьи указанной организации. У машинного account нет человеческого
членства, workspace, файлов, переписки, помощника и административных команд. Пользовательский login и
его прежние права не меняются; при `SERVICE_DEMO=0` демопароли отключены, машинная ветка login сохраняется.

`productKeys.control.list({orgId})` выдаёт владельцу метаданные без хешей и секретов. Отзыв — стандартная
owner-команда `productKeyRevoke(requestId, {orgId, id})`; она отзывает отдельную машинную идентичность.
Expiry/revoke проверяются перед резервом, перед поиском и после settlement перед выдачей, в том числе
на уже открытом ресурсе; ресурс проверяет сигнал закрытия. После отзыва нельзя снова войти или читать
с прежним bearer. Отзыв переживает replay/рестарт; уже переданные потребителю байты удалить невозможно.

HTTP и RPC используют одну предметную операцию, схему входа и свежую проверку доступа. Повторы расхода
защищает существующий Metering-адаптер; отдельной системы replay или общего сервера API-ключей здесь нет.

`conversation-check.ts`, `article-index-check.ts`, `product-check.ts` проверяют страницы и конкурентное добавление,
поиск старых сообщений, приватность/отзыв, обновление индекса и реальный HTTP/OpenAPI. `product-check.ts`
дополнительно проходит настоящий машинный login/RPC, однократную выдачу, изоляцию, expiry, отзыв открытого
ресурса и во время IO, replay после рестарта и отсутствие исходного секрета в архиве. Это состав проверки,
а не подтверждение нового прогона: полная регрессия обязательна; предыдущий Docker отчёт не заменяет приёмку образа.

После review Q04 проверка также использует настоящий owner-client RPC для выпуска/list/повтора/conflict
и отзыва, сохранённые до expiry/revoke HTTP bearer и закрытие RPC-ресурса во время ожидания settlement.
UsageGate здесь тестовый: проверяет границы доступа во время IO, но не доказывает настоящие Metering
quota/dedup/uncertain. Межпродуктовая приёмка учёта остаётся Q06.
