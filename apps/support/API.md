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

HTTP-продуктовая поверхность находится на authority. На serving-узлах остаются обычные SC1 представления/ресурсы и UI; для HTTP маршрутизируйте `/api/product/*` на authority. Стандартный пользовательский bearer в этом примере не является отдельным машинным API-ключом: scopes/ротация API-ключей показываются в Counter. Отдельная машина должна получить свою ограниченную идентичность, а не пароль владельца.

`conversation-check.ts`, `article-index-check.ts`, `product-check.ts` проверяют страницы и конкурентное добавление, поиск старых сообщений, приватность/отзыв, обновление индекса и реальный HTTP/OpenAPI. Полная регрессия после этих дополнений обязательна; предыдущий Docker отчёт не заменяет новую приёмку образа.
