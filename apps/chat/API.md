# Контракт web-чата C03

Точные опубликованные зависимости: `wenay-common2` 3.1.1 и `wenay-react2` 5.0.0.
Один сервис `chat`, два authority resource: `chat` и `chatPersonal`. Стандартный транспорт, reconnect,
conversation state/events replay и receipts предоставляет common2.

## Сессия

`GET /api/client` возвращает публичный service descriptor.
`POST /api/chat/login` принимает `{args: [{account, password}]}` и возвращает
стандартный HTTP facade envelope `{ok: true, value: {token, account, expiresAt}}`.
Тестовые аккаунты: `alice` / `alice-pass`, `bob` / `bob-pass`.
Токен передаётся в `createServiceClient({definition, url, auth: {token}})`.
Представление `client.views.workspaces` содержит объект `{workspaces: [...]}`.
Элемент содержит `id`, `name`, `resourceName`, `membershipCommand` и
`members: [{account, name, role: 'owner' | 'member'}]`. View перечисляет только workspace
с текущей membership enabled аккаунта; пароли и хеши не экспортируются.
Default server: `http://127.0.0.1:3819`.

Выбор workspace локален каждой web-сессии. При смене workspace прежний conversation
owner закрывается, данные экрана и черновики очищаются. «Сменить аккаунт» закрывает
conversation до service client; вход другого аккаунта создаёт новый ServiceClient.
Logout удаляет локальный token; глобального отзыва ранее выданных токенов не обещает.

## Workspace и права

Фиксированный registry: `team` → `chat` (alice owner, bob member),
`personal` → `chatPersonal` (alice owner). Каждый ресурс связан со своим native host и журналом.
`team` сохраняет C01 журнал целиком, включая `private-alice` и прежние receipts;
`personal` получает новый разговор `personal-alice` / `personal-alice-main`.
Это совместимость с C01 и новый workspace, а не перенос старой личной истории в personal.

Native principal RPC команды:

- `client.commands.teamMemberSet(requestId, {account, role})`
- `client.commands.personalMemberSet(requestId, {account, role})`

`role` принимает `'none' | 'member' | 'owner'`; none удаляет membership.
Команда bound к одному workspace; её allow требует точную текущую
`workspace-owner:team` / `workspace-owner:personal` роль до receipt replay.
Apply повторно проверяет текущего owner, enabled аккаунта назначения и запрет удаления
или понижения последнего owner. Создание workspace/аккаунтов здесь отсутствует.
Service receipts принадлежат аккаунту и requestId: один id с другой командой запрещён.

Полная встроенная REST-поверхность отключена через `rest: false`; публичный native
`createServiceRest` монтируется только на credential login route. HTTP commands, views,
panel и docs не экспортируются. Причина — подтверждённый
[SERVICE-COMMAND-RECEIPT-ACL](../../doc/library-tasks/SERVICE-COMMAND-RECEIPT-ACL.md)
в common2 3.1.1: HTTP retry возвращает receipt до текущей allow-проверки.
Это ограничение приложения, а не исправление библиотеки.

## Разговор

`client.resources.open(workspace.resourceName)` выдаёт контроллер с `status`, `current()` и `close()`.
Текущая generation содержит remote `{conversation, demo}`.
`createConversationClient({remote: conversation})` синхронизирует родные state/events;
`ready` ждёт обе подписки. Выбор разговора и канала принадлежит экрану.

Conversation сохраняет публичный `ConversationRemote`:

- `createConversation({requestId, title, participantIds?, rootTitle?})`
- `createChannel({requestId, conversationId, title, parentMessageId?, factMode?})`
- `postMessage({requestId, conversationId, channelId, blocks: [{kind: 'text', version: 1, text}]})`
- `state`, `events`: родные библиотечные replay поверхности.
- `upsertFact`, `retractFact` отклонены: произвольные факты не входят в этот пример.

Команды возвращают родные Conversation/Channel/Message объекты. Успешный ответ означает,
что event и receipt записаны вместе и fsync завершён. Клиент сохраняет неизменяемый input
и requestId при неопределённом исходе; повтор возвращает прежний entity ID.
Адаптер сверяет повтор с неизменяемой сущностью и проверяет ACL оригинального receipt
до вызова библиотеки. Receipt deduplication и сериализацию операций выполняет common2.
Эта предварительная проверка обходится с ограничением `CONVERSATION-RECEIPT-POLICY`
в common2 3.1.1: родной повтор по receipt возвращает сущность раньше текущей ACL.
Одинаковый requestId другого аккаунта или conversation host независим;
другой command с прежним id в том же host запрещён.
Префикс `demo:` зарезервирован. RequestId до 128 символов, title до 120, text до 4000.
Ограничения экземпляра: 100 разговоров, 5000 сообщений, до 20 участников при создании.

Два исходных разговора: `shared` / `shared-main` для alice и bob;
`private-alice` / `private-alice-main` только для alice; оба остаются в team.
Состав участников разговора immutable; изменение workspace membership не добавляет
аккаунт в participantIds ранее созданного разговора. Нужны обе проверки доступа.
Доступ определяется текущим серверным аккаунтом, workspace membership и participantIds; closed/aborted resource
и disabled account не могут повторить даже ранее успешно выполненную команду.

## Явный тестовый ответ

`demo.reply({requestId, conversationId, channelId, sourceMessageId})` принимает существующее
сообщение участника выбранного канала. Возвращает законченный `ConversationMessage` автора
`{kind: 'assistant', id: 'demo', label: 'Тестовый ИИ'}`. Ответ виден разрешённым участникам разговора.
Никаких внешних запросов, оплаты или потоковых AI events: deterministic ответ сохраняется
одной conversation mutation с receipt `demo:<requestId>`. Marker `demo-source` в custom block
связывает повтор с исходным сообщением; renderer показывает text block.

## Хранение и проверка

Service identity и workspace membership хранятся стандартным service host;
conversation journals отдельно сохраняют
публичные event+receipt JSONL в data directory. Один процесс владеет записью. Незавершённая
строка при старте приводит к явной ошибке; после ошибки записи writer закрыт до перезапуска.
Это ограниченный пример: нет multi-writer storage, retention/compaction и динамических workspace.
Streaming и durable AI run/checkpoint принадлежат C02. Remote agent и установленные
desktop/mobile клиенты сохраняются отдельными непринятыми этапами.

`npm test` выполняет две настоящие RPC сессии, обе стороны обмена, state/event privacy,
повтор после подтверждённого durable commit с намеренно отброшенным клиентом ответом,
changed-payload и cross-command rejection, явный demo, закрытый ресурс, восстановление
истории из native replay и повтор после restart. Потеря ответа моделируется на клиенте
после завершённого реального RPC, а не физическим сетевым прокси.
Отдельная C03 проверка охватывает workspace isolation, native owner-команды, revoke,
retained remote, независимые receipts и restart. Наличие кода проверок не означает PASS;
текущий этап и оставшаяся приёмка указаны в [дизайне C03](../../doc/changes/chat-c03-design-20260926.md).
