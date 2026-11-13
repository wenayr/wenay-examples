# Аудит публичного API библиотек, 26 сентября 2026

Переход: **wenay-common2 2.21.1 → 3.1.1**, **wenay-react2 3.5.1 → 5.0.0**.
Соседние `wenay-common2` и `weay-react2` использованы только для чтения changelog и migration docs.
Минимальные проверки выполнены через публичные экспорты установленного npm `wenay-common2@3.1.1`
в `apps/support`; локальные исходники, link, архивы и сборки не подключались.

## Практический результат

- `STORE-NESTED-REPLACEMENT` исправлен начиная с common2 2.21.2. На 3.1.1 минимальный критерий
  `--expect-fixed` проходит. Можно убрать две поверхностные копии истории в support и monitoring;
  окончательное принятие включает тесты этих приложений.
- `AI-POLICY-INVALIDATION` и `AI-RESOURCE-LIFECYCLE` всё ещё воспроизводятся на npm 3.1.1.
  Новый major и исправления replay не заменяют требуемые публичные AI API. Защита ACL и state-only
  error-aware зеркала пока остаются необходимыми.
- Единственная найденная смена импортируемой React-поверхности в коде примеров — `useMediaSource`
  в двух компонентах органайзера: теперь он приходит из `wenay-calls@1.0.0`.
  CRM и metering уже объявляют совместимые точные ag-grid пакеты для `/grid`;
  optional peer статус не требует изменения этих деклараций.
- В этих версиях нет нового общего host/client/hook API, который позволяет удалить иной слой
  оркестрации примеров. Значимые улучшения находятся внутри Store, RPC, replay и упаковки.

## Common2: весь интервал релизов

| Версия | Изменение | Последствие для примеров |
| --- | --- | --- |
| 2.21.2 | Нормализация входного графа перед заменой реактивного родителя; сохранение path proxy, подписок и descriptors | Удалить обход копирования истории после успешного repro и тестов support/monitoring |
| 2.21.3 | Документация, проверка doc links и переносимое копирование demo | API и поведение приложений не меняются |
| 3.0.0 | Exchange-данные выделены в `wenay-exchange@1.0.0`; express стал optional peer; axios заменён fetch; удалены `/lib/client`, `/lib/server` | Явные server peers; проверить импорт exchange и webhook обработчики |
| 3.0.1 | Исправления auth, прототипов RPC, утечки stack, replay/Listen и подписок Store | Проверить login/reauth/revoke; доступ и выдачу ошибок трактовать по новому контракту |
| 3.1.0 | Seq-only обновление replica descriptor, общий снимок chunked keyframes, Map/onKey и codec fast paths | Улучшение стоимости репликации без нового транспорта и смены формата |
| 3.1.1 | Существенно меньше памяти на reactive node; строгие окончания async проверок самой библиотеки | API и wire format не меняются; опубликованные показатели не считать замером наших приложений |

Breaking migration 3.0.0:

- `Bars`, `CQuotesHistory*`, `CBar*`, `OHLC`, `CTimeSeries*`, `createRandomBars`, `LoadQuoteBase`
  импортируются из `wenay-exchange`. `TF`, `Period`, время и `Params` остаются в common2.
  В исходниках примеров использования перенесённых exchange-имён не найдено.
- `express` нужен приложениям с server/service-host поверхностями; `@types/express` нужен
  потребителям типов `server/http`. Нельзя рассчитывать на старую транзитивную зависимость.
- `createWebhookClient(...).status(tag)` возвращает `{status, data: {subscribed, expireAt?}}`;
  ошибка HTTP — `HttpStatusError` с `status/method/url`, а не `AxiosError.response.status`.
  В текущих примерах потребителей этого webhook API не найдено.
- Публичные пути `/client` и `/server` заменяют удалённые `/lib/client` и `/lib/server`.
  Использований удалённых путей в исходниках примеров не найдено.

Поведенческие изменения 3.0.1:

- Ungated сервис без `access.login` выдаёт только `{renew}`. Login на account, присланный клиентом
  в handshake, больше не выпускает token и не снимает revoke. Приложение либо предоставляет
  `access.login`, либо аутентифицирует account и выпускает token серверным `leader.identity.login`.
- Numeric RPC refs остаются привязаны к исходному path при reauth/grant. Этот security fix полезен
  текущим role facades; собственную таблицу маршрутов вводить не требуется.
- HTTP ошибки не передают серверный stack; RPC передаёт его только с `debug: true`.
  Операторская диагностика остаётся в `onError`/`log`; пользовательский UI не должен требовать stack.
- `saveKeyValue` запрещает абсолютные и traversal `path/key`; абсолютная база задаётся `dirDef`.
- Leaf-подписка переживает delete/recreate родителя в одном drain; lazy-line доставляет detached
  значения; бросивший catch-up consumer освобождает подписку. Эти исправления не добавляют
  поздний error port в `createAiRunClient`.
- `off(cb)` отменяет `once(cb)`; `fast:false` фиксирует состав слушателей в начале emit;
  `listenSnapshot` подключается при первом подписчике.

Ограничения, которые важно сохранить в проектировании: leaf-подписки в 3.1.0 не перечитывают raw
записи в обход proxy и запись через алиас другой ветки; порядок Map notifications — `keys`
перед `onKey`, а `keys.count()` считает только keys-подписчиков. В 3.1.1 также описаны незакрытые
ограничения типов `StoreReplayRemote`/`createStoreManager`/untyped strict facade, срока service token
и отсутствия публичного монтажа leader на общий socket. Они не объявляются новыми дефектами
примеров без собственного воспроизведения.

## React2: весь интервал релизов

| Версия | Изменение | Необходимая адаптация |
| --- | --- | --- |
| 4.0.0 | Удалён root `wenay-react2`; canonical subpaths; legacy renames; common2 3.x и exchange peer | Сохранять уже применённые `/react`, `/ui`, `/grid`; проверить удалённые имена |
| 4.0.1 | Dependency/peer common2 `^3.1.1` | Exact common2 3.1.1 удовлетворяет peer; хуки не меняются |
| 5.0.0 | Call UI выделен в `wenay-calls@1.0.0`; ag-grid optional peers | Органайзер переходит на `wenay-calls`; CRM/metering сохраняют уже объявленные grid peers |

Карта 4.0.0: `renderByRevers → renderByReverse`, `mapResiReact → resizableSizeMap`,
`mapRightMenu → rightMenuMap`, `FResizableReact → ResizableBox`, `CResizeObserver → ResizeObserverHub`,
`memorySet → memorySetIfAbsent`. Storage scopes сохраняются; последний метод по-прежнему set-if-absent.
Memory keys теперь string, `memoryGetOrCreate` принимает `reverseDeep` вместо `reversDeep`.
Column/toolbar `onChange` теперь read-only `{on(...) → off}`: подписка остаётся, `emit/close` удалены.
Resize handler types принадлежат react2, `FloatingWindowUpdate.dir` сужен до resize direction.
`__observerStateForTests` удалён. Употреблений этих удалённых/переименованных имён в коде примеров
не найдено; это не отменяет общий typecheck после npm-обновления.

Карта 5.0.0:

| Старый путь | Новый путь |
| --- | --- |
| `wenay-react2/communication` | `wenay-calls` |
| `useRouteState`, `RouteLogEntry` на `wenay-react2/react` | `wenay-calls` |
| `wenay-react2/styles/communication` | `wenay-calls/styles` |
| `wenay-react2/demo/peer-media`, `/demo/peer-conference` | Соответствующие `wenay-calls/demo/*` |

Публичный migration CLI опубликован в `scripts/migrate-root-imports.mjs`. Для него нужен optional
`@babel/parser`; `--write` применяет миграцию, `--check` проверяет остатки. Namespace/dynamic/type-query
случаи требуют ручной проверки. В примерах обычные named subpath imports; две найденные строки
`useMediaSource` можно исправить прямо, без добавления migration parser во все приложения.
`wenay-calls` зависит peers только от react/common2 и не требует дополнительной копии react2.

## Три прежние задачи: проверка npm 3.1.1

Команды выполнялись последовательно из `apps/support`, Node 24.18.0, без внешнего ИИ и Docker.
Перед запуском версия прочитана из установленного `node_modules/wenay-common2/package.json`.

| Команда | Фактический результат | Решение |
| --- | --- | --- |
| `node --import tsx backend/store-nested-replacement-repro.ts --expect-fixed` | Exit 0, `PASS nested array entries survive parent replacement and remain reactive` | Исправление принято минимальным repro; композиционные проверки выполняет общий этап обновления |
| `node --import tsx backend/ai-policy-repro.ts` | Exit 0; старый fragment выдаёт result новому клиенту и keyframe; новая connection не выдаёт | AI-POLICY-INVALIDATION остаётся открытой |
| `node --import tsx backend/ai-resource-lifecycle-repro.ts` | Exit 1; `replaySubscribe: live line from seq 2 failed: logical RPC line ended` после revoke | AI-RESOURCE-LIFECYCLE остаётся открытой |

Policy repro вернул `originalClientRetainsResult: true`, `newClientFromOldFragmentReceivesResult: true`,
`oldFragmentKeyframeContainsResult: true`, `newConnectionReceivesResult: false`. Сохранение результата
у старого клиента само по себе не дефект отзыва уже полученных данных; проблема — новое чтение старого
fragment/keyframe после отзыва. Вывод repro первоначально содержал историческую метку 2.21.1;
она не является обнаружением версии и обновляется отдельно.

Декларации публичного `/ai` из npm 3.1.1 подтверждают отсутствие нужных расширений:
`AiRunClientDeps = {remote, initial?, drain?}`, а клиент имеет `ready/events/store/commands/close`,
без `onError` или наблюдаемого терминального lifecycle. Host имеет `connection/store/persistence/recovery/close`,
без публичной инвалидации внешней policy. Поэтому удаление соответствующих обходов не обосновано.

## Обвязка и дальнейшая стратегия

Удаляется только защита Store parent replacement. `createStore + syncStoreReplay({onError})` для
state-only экрана — небольшой адаптер публичного runtime до исправления AI lifecycle; его нельзя
заменять новым собственным replay или скрытым подавлением исключений. Приватный support draft
пока остаётся на сервере с повторной ACL-проверкой чтения. Предметные роли, revision источника,
организации и действия отправки сохраняются в домене после будущей library invalidation.

Уже используемые `useOwnedClient`, `useClientStore`, `useServiceCommands`, `useAsyncAction`,
`useStoreReplayMirror`, `Overlay` остаются подходящими механизмами. Аудиты conversation/file-job,
rerender и UI wrappers от 11 сентября не опровергнуты changelog: API, меняющего их выводы, не появился.
Смена generation по SC1 требует нового owned consumer и освобождения старого; она не исправляет
отложенный throw специализированного AI-клиента.

Дальнейший цикл: новые сценарии проверять через опубликованный API, добавлять лишь малый адаптер,
а подтверждённый пробел оформлять воспроизведением. После публикации нужного API удалить только
замещённую обвязку и повторить revoke/reconnect/replay сценарии. Метрики Store памяти и codec из
release notes — свидетельства библиотеки, не обещание производительности примеров.

## Источники и границы проверки

Прочитаны local release notes common2 `doc/changes/{2.21.2,2.21.3,3.0.0,3.0.1,3.1.0,3.1.1}.md`,
его `doc/NAMING_RENAMES.md`, `doc/AI-RUN-PROTOCOL.md`; react2
`doc/changes/{v4.0.0,v4.0.1,v5.0.0}.md`, `doc/WENAY_REACT2_RENAMES.md`.
Исполняемый результат получен только с npm-пакетом. Публичные declaration files прочитаны
для аудита, внутренние пути не стали импортами приложения.

Ссылки на воспроизводимые задания: [Store](../library-tasks/STORE-NESTED-REPLACEMENT.md),
[AI policy](../library-tasks/AI-POLICY-INVALIDATION.md),
[AI lifecycle](../library-tasks/AI-RESOURCE-LIFECYCLE.md), [обходы](../library-tasks/WORKAROUNDS.md).
Общий typecheck, тесты, сборки, синхронность shared, браузер и `check:all` относятся к общему этапу
обновления; этот отчёт не объявляет их пройденными на основании release notes библиотеки.
