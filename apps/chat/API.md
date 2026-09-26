# Контракт web-чата C01

Точные опубликованные зависимости: `wenay-common2` 3.1.1 и `wenay-react2` 5.0.0.
Один сервис `chat`, один authority resource `chat`. Стандартный транспорт, reconnect,
conversation state/events replay и receipts предоставляет common2.

## Сессия

`GET /api/client` возвращает публичный service descriptor.
`POST /api/chat/login` принимает `{args: [{account, password}]}` и возвращает
стандартный HTTP facade envelope `{ok: true, value: {token, account, expiresAt}}`.
Тестовые аккаунты: `alice` / `alice-pass`, `bob` / `bob-pass`.
Токен передаётся в `createServiceClient({definition, url, auth: {token}})`.
Представление `client.views.members` содержит `{account, name}[]` без паролей и хешей.
Default server: `http://127.0.0.1:3819`.

## Разговор

`client.resources.open('chat')` выдаёт контроллер с `status`, `current()` и `close()`.
Текущая generation содержит remote `{conversation, demo}`.
`createConversationClient({remote: conversation})` синхронизирует родные state/events;
`ready` ждёт обе подписки. Выбор разговора и канала принадлежит экрану.

Conversation сохраняет публичный `ConversationRemote`:

- `createConversation({requestId, title, participantIds?, rootTitle?})`
- `createChannel({requestId, conversationId, title, parentMessageId?, factMode?})`
- `postMessage({requestId, conversationId, channelId, blocks: [{kind: 'text', version: 1, text}]})`
- `state`, `events`: родные библиотечные replay поверхности.
- `upsertFact`, `retractFact` отклонены: произвольные факты не нужны C01.

Команды возвращают родные Conversation/Channel/Message объекты. Успешный ответ означает,
что event и receipt записаны вместе и fsync завершён. Клиент сохраняет неизменяемый input
и requestId при неопределённом исходе; повтор возвращает прежний entity ID.
Адаптер сверяет повтор с неизменяемой сущностью и проверяет ACL оригинального receipt
до вызова библиотеки. Receipt deduplication и сериализацию операций выполняет common2.
Эта предварительная проверка обходится с ограничением `CONVERSATION-RECEIPT-POLICY`
в common2 3.1.1: родной повтор по receipt возвращает сущность раньше текущей ACL.
Одинаковый requestId другого аккаунта независим; другой command с прежним id запрещён.
Префикс `demo:` зарезервирован. RequestId до 128 символов, title до 120, text до 4000.
Ограничения экземпляра: 100 разговоров, 5000 сообщений, до 20 участников при создании.

Два исходных разговора: `shared` / `shared-main` для alice и bob;
`private-alice` / `private-alice-main` только для alice. Состав участников immutable в C01.
Доступ определяется текущим серверным аккаунтом и membership; closed/aborted resource
и disabled account не могут повторить даже ранее успешно выполненную команду.

## Явный тестовый ответ

`demo.reply({requestId, conversationId, channelId, sourceMessageId})` принимает существующее
сообщение участника выбранного канала. Возвращает законченный `ConversationMessage` автора
`{kind: 'assistant', id: 'demo', label: 'Тестовый ИИ'}`. Ответ виден обоим участникам.
Никаких внешних запросов, оплаты или потоковых AI events: deterministic ответ сохраняется
одной conversation mutation с receipt `demo:<requestId>`. Marker `demo-source` в custom block
связывает повтор с исходным сообщением; renderer показывает text block.

## Хранение и проверка

Service identity хранится стандартным service host; conversation journal отдельно сохраняет
публичные event+receipt JSONL в data directory. Один процесс владеет записью. Незавершённая
строка при старте приводит к явной ошибке; после ошибки записи writer закрыт до перезапуска.
Это ограниченный пример: нет multi-writer storage, retention/compaction и account/workspace
переключения C03. Streaming и durable AI run/checkpoint принадлежат C02.

`npm test` выполняет две настоящие RPC сессии, обе стороны обмена, state/event privacy,
повтор после подтверждённого durable commit с намеренно отброшенным клиентом ответом,
changed-payload и cross-command rejection, явный demo, закрытый ресурс, восстановление
истории из native replay и повтор после restart. Потеря ответа моделируется на клиенте
после завершённого реального RPC, а не физическим сетевым прокси.
