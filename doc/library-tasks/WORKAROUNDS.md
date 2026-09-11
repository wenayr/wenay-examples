# Реестр обходов открытых задач библиотек

Дата: 11 сентября 2026. Задача L01 [плана 2](../CONSOLIDATION-PLAN.md).

Каждое место в коде, которое существует только из-за открытого ограничения библиотеки, помечено комментарием `// Обход common2: <ID>` и перечислено здесь. После публикации исправления обход удаляется, а сценарий повторяется указанной командой.

Поиск всех мест: `grep -rn "Обход common2" apps --include='*.ts' --include='*.tsx'`.

## Открытые задачи

### STORE-NESTED-REPLACEMENT

[Задача](STORE-NESTED-REPLACEMENT.md). Сохранение proxy-элементов массива при замене родительского объекта уводит `snapshot()` в рекурсию.

| Место | Что делает обход |
| --- | --- |
| `apps/support/backend/domain.ts`, функция `articleHistory` | Перед заменой родителя копирует элементы истории поверхностно (`{...version}`), отделяя их от прежнего proxy |
| `apps/monitoring/backend/domain.ts`, команда `monitorSave` | То же для истории наблюдений проверки перед заменой записи монитора |

Проверка после исправления:

```text
cd apps/support && node --import tsx backend/store-nested-replacement-repro.ts --expect-fixed
```

Удаление обхода: вернуть `[...(article.history ?? []), {…}]` без `.map(version => ({...version}))` и прогнать `npm test` в support и monitoring.

### AI-POLICY-INVALIDATION

[Задача](AI-POLICY-INVALIDATION.md). Уже открытый AI-фрагмент может отдать результат после внешнего изменения policy; публичного способа уведомить существующие проекции нет.

| Место | Что делает обход |
| --- | --- |
| `apps/support/backend/assistant-resource.ts`, `createSupportAssistant` | Приватный текст не попадает в AI replay; он читается отдельным запросом с текущим ACL и версией источника |

Проверка после исправления:

```text
cd apps/support && node --import tsx backend/ai-policy-repro.ts --expect-fixed
```

Удаление обхода: только после появления публичного API инвалидации — вызвать его сразу после изменения `allowed` и вернуть чтение приватного вывода через обычную проекцию.

### AI-RESOURCE-LIFECYCLE

[Задача](AI-RESOURCE-LIFECYCLE.md). Позднее завершение replay при отзыве SC1 даёт необработанное исключение специализированного AI-клиента.

| Место | Что делает обход |
| --- | --- |
| `apps/support/backend/resource-check.ts`, функция `mirror` | Публичное `createStore` + `syncStoreReplay(..., {onError})` вместо AI-клиента: ошибка уходит в наблюдаемое состояние, устаревшее зеркало очищается |
| `apps/forms/backend/resource-check.ts`, зеркало `exports.ai.state` | То же для заданий выгрузки |

Проверка после исправления:

```text
cd apps/support && node --import tsx backend/ai-resource-lifecycle-repro.ts --expect-fixed
```

Удаление обхода: заменить state-only зеркало обычным AI-клиентом и прогнать `npm test` в support и forms. Композиция намеренно не подписывается на semantic delta/tool events — примеру, которому они понадобятся, обход не подойдёт и без исправления.

## Порядок принятия исправления

Задача L06 плана 2: обновить точную npm-версию во всех приложениях по очереди, удалить обход по этой таблице, повторить сценарий, записать результат в `doc/changes/common2-<версия>.md` и отметить строку здесь как закрытую.

## Закрытые

Пока нет. Ранее принятые пакеты исправлений перечислены в [CURRENT-HANDOFF](CURRENT-HANDOFF.md) и `doc/changes/`.
