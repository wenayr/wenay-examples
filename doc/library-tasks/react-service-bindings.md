# Задание react2/common2: React-привязки сервисного клиента

**Статус: применено в примере 0.8.0 (common2 2.17.0 / react2 3.2.0).** Проверены реальные клиенты, отзыв/возврат роли и сетевые сценарии. Ниже сохранена исходная постановка, а не список отсутствующих API. См. [результат внедрения](../changes/0.8.0.md).

Потребитель: `wenay-examples/apps/pizzeria@0.7.0`. Проверенные установленные версии: `wenay-common2@2.16.1`, `wenay-react2@3.1.0`, React 19.2.8. Работать в исходных репозиториях библиотек, опубликовать новые точные npm-версии и только затем обновлять пример. Установленные пакеты приложения не изменять.

## Что уже есть и реально используется

Публичный entrypoint `wenay-react2/react` экспортирует `useStoreNode`, `useClientStore`, `useListenEffect`, `useListenValue`, `useStoreSelect`, `useStoreKeys` и `useReorderBoard`. В приложении сейчас реально используются:

- `useClientStore(remote)` в `shared/react/service-view.tsx` для ролевых live-view; `useClientStore({store: client.health})` в `shared/react/service-session.ts` для соединения; оба приложения используют эти общие привязки;
- `useReorderBoard({columns, canDrag, onDragStart, commit})` в `organizer/board.tsx`; `commit` отправляет одну предметную команду `workMoveTask` после drop;
- публичные `wenay-common2` API `createRpcClientHub`, `followNodeDirectory`, `pickDirectoryNode`, `createStore` и `syncStoreReplayRoute` внутри `backend/client.ts`. Клиент уже отдаёт стабильные `views.<name> = {store, ready, seq, close}`, реактивный `health: Store<{connected,nodeId,url}>`, `identity`, `commands`, `view`, `control` и `close`.

`useClientStore` уже принимает структурный контракт `{store, ready?: Promise<void>}` и возвращает `{client, state, ready, error}` с защитой от позднего завершения прежнего клиента. Поэтому `ServiceClientView` подходит ему без нового API. `useStoreNode` подходит для `client.health.node`. В публичной поверхности `wenay-react2@3.1.0` отдельного общего action/session hook не найдено; это утверждение относится только к проверенным опубликованным `.d.ts` и документации этой версии.

## 1. Применить существующие bindings без расширения API

Уже выполнено в 0.7.0: локальный `Live` и его ручной `useEffect` заменены на `ServiceView` поверх `useClientStore(remote)`. Состояние соединения наблюдается через `useClientStore({store: client.health})`, без копирования `connected` по таймеру. Это использует уже опубликованные API и сохраняет владельцем transport/replay сам `ServiceClient`.

Критерии готовности:

1. Первый keyframe переводит view из loading в ready; rejection попадает в `error`; поздний результат закрытой или заменённой view не меняет новый экран.
2. `connected`, `nodeId` и `url` обновляются при потере serving node и переходе на другой узел без polling React-состояния.
3. Стабильный Store view сохраняет идентичность при `syncStoreReplayRoute.switch(..., {reset: true, since: -1})`.

## 2. Добавить узкий lifecycle binding для уже созданного сервисного ресурса

Добавить в `wenay-react2/react` общий hook с рабочим названием `useOwnedClient`, не знающий definition пиццерии:

```ts
useOwnedClient({create, key, enabled}) => {
    client,
    ready,
    error,
    close,
}
```

Минимальный структурный контракт клиента: `ready: () => Promise<void>` и `close: () => void`. Hook создаёт один ресурс на `key`, закрывает его ровно один раз при смене key/unmount, игнорирует поздние resolve/reject старого поколения и не занимается reconnect сам. При желании конкретный `createServiceClient` остаётся адаптером common2/scaffold и передаётся через `create`.

Критерии готовности:

1. StrictMode mount/unmount, смена URL/token и закрытие во время pending `ready()` не оставляют socket, replay line или timer.
2. Ошибка старого клиента не перезаписывает успешное состояние нового.
3. Hook не вызывает `close()` у клиента, который ему не принадлежит; ownership задаётся самим вызовом `create`.
4. Есть проверка с минимальным fake client и интеграционная проверка с клиентом common2.

## 3. Добавить типизированный action binding

Добавить в `wenay-react2/react` небольшой controller с рабочим названием `useAsyncAction`, поверх которого сервисный scaffold сможет дать `useServiceCommands(commands, {requestId})`:

```ts
const action = useAsyncAction()
await action.run(() => commands.workMoveTask(requestId(), input))
// action.pending, action.error, action.clearError
```

`useAsyncAction` отвечает только за pending/error и защиту от позднего результата после unmount или нового запуска. `useServiceCommands` должен сохранять вывод имени команды, input и result из переданного command map и генерировать id через явную зависимость `requestId`, по умолчанию `crypto.randomUUID`. Политика параллельности должна быть явной: минимальный вариант — один активный вызов на controller с отказом повторного запуска либо отдельное состояние по command key.

Критерии готовности:

1. Типы запрещают неизвестное имя команды и неверный input без `as never`/индексации через `keyof` в UI.
2. `pending` сбрасывается при resolve/reject; исходная ошибка доступна UI; позднее завершение не обновляет размонтированный компонент.
3. Один request id создаётся на один пользовательский запуск и не меняется внутри вызова.
4. Binding не повторяет команду автоматически после сетевой ошибки: команды сервиса уже имеют receipt/idempotency contract, а решение о retry остаётся вызывающей стороне.

## Граница задачи

В библиотеку входят только владение lifecycle React-ресурса, наблюдение существующих Store/view и состояние async action. Выбор ролей и доступных views, проверка разрешений, маршрутизация между authority/serving nodes, replay/reconnect, token renewal и receipts остаются в common2/scaffold. Статусы заказа, допустимые переходы кухни, optimistic revision задач, фильтры доски, правила `canDrag` и построение payload `workMoveTask` остаются приложению. `useReorderBoard` уже покрывает только механику drag/drop и расширять его правилами кухни или органайзера не требуется.

После публикации проверить `npm run typecheck`, `npm test`, `npm run build` и `npm run build:organizer`, затем пройти смену serving node с открытыми view, отзыв роли, повторную авторизацию и перенос карточки с единственной командой на drop.
