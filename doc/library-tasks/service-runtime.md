# C2/C3 — публичный runtime сервиса вместо копирования examples

Версии: common2 2.17.0, react2 3.2.0, пример 0.8.0. Это две связанные поверхности одного контракта, а не два конкурирующих фреймворка. Имена будущих entrypoints ниже — предложения, а не существующие экспорты.

## C2 — клиент и descriptor

**Факт.** `apps/pizzeria/backend/client.ts:65` содержит локальные `ServiceClientDefinition`/`describeService`; `:99` — `createServiceClient`. В published `examples/pizzeria/client.ts` клиент принимает серверную definition, а consumer добавляет JSON descriptor и сохраняет вывод типов. Клиентская обвязка используется обоими интерфейсами. В export map common2 нет service-entrypoint; эти фабрики поставляются как исходники examples, а не публичный импорт.

**Воспроизведение.** Создать ещё один сервис с собственными командами/представлениями. Для использования проверенного lifecycle прав, токенов и placement приходится копировать клиент и поддерживать descriptor. При обновлении потребитель сверяет изменения вручную, как при переходе на 2.17.0.

**Проверено.** `createRpcClientHub` из `wenay-common2/rpc`, `followNodeDirectory`, `pickDirectoryNode`, `createStore`, `syncStoreReplayRoute` из `wenay-common2/observe` уже реализуют необходимые механизмы. Требуется опубликовать их готовую композицию из scaffold, а не новый транспорт.

**Работа.** Дать публичный browser-safe клиент и функцию описания сервиса. Типы команд, аргументов, результатов и проекций выводить из definition; JSON descriptor не должен содержать начальное состояние, credentials, секреты, функции apply/project. Сохранить стабильные Store, permissions, health, onToken, onAuth и текущее размещение. Зафиксировать контракт `identity.me()` и permissions: приложение сейчас сохраняет совместимый расширенный `me()`.

**Приёмка.** Пиццерия и органайзер импортируют клиент из npm, локальный client.ts удаляется либо превращается в продуктовую настройку; browser bundle не тянет Node host или seed-секреты. Ошибочная команда/payload отвергается TypeScript. Действующие network-check сценарии проходят: токен, независимые заведения, regrant, очистка старого зеркала, смена узла, стабильный Store и restart. Проверить очистку во время pending подключения.

## C3 — серверный контракт и композиция

**Факт.** `organizer/domain.ts:3` импортирует `schemaCommand` из backend пиццерии; `organizer/server.ts:3` импортирует `runLeaderProcess`. Общие `backend/access.ts`, `leader.ts`, `rest.ts`, `input-schema.ts` повторяют поставляемый examples scaffold. Это уже две domain definitions, использующие одну и ту же инфраструктуру. `rest.ts` строит маршруты и OpenAPI из definition; `input-schema.ts` связывает декларацию с TS inference и runtime-проверкой.

**Работа.** Выделить публичные типы definition и серверные фабрики authority/access/REST, сохранив существующий DSL schemaCommand. Сначала согласовать типовой контракт с C2. Разделить browser-safe типы и Node-реализацию. Выбор Express/Socket.IO и запуск процесса — отдельная поверхность C4.

**Проверено.** Низкоуровневые `Scale.createAuthority`, `deriveStore`, `exposeStoreReplay`, `createHttpFacadeServer`, `createHttpFacadeOpenApi` уже существуют. Их наличие не устраняет повторяющуюся service-композицию. Не создавать новую систему схем и не объявлять отсутствие возможностей в ядре.

**Приёмка.** Обе domain definitions могут находиться в независимых каталогах и импортировать только публичный service runtime. Удаляется заменённый общий код из backend примера. Сохраняются миграции архива, receipts, бюджеты команд, server-side ACL, keyframe/since-защита сохранённой ссылки, REST/OpenAPI и корректное освобождение проекций. Все existing account/inventory/REST/organizer/network проверки проходят. Не менять рецепты или правила задач ради удобства нового runtime.
