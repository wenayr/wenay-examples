# Реестр обходов открытых задач библиотек

Обновлено 26 сентября 2026 для npm common2 3.1.1 / react2 5.0.0. Историческое основание — задача L01 [плана 2](../CONSOLIDATION-PLAN.md). [Аудит обновления](../reports/LIBRARY-API-AUDIT-2026-09-26.md).

Каждое место в коде, которое существует только из-за открытого ограничения библиотеки, помечено комментарием `// Обход common2: <ID>` и перечислено здесь. После публикации исправления обход удаляется, а сценарий повторяется указанной командой.

Поиск всех мест: `grep -rn "Обход common2" apps --include='*.ts' --include='*.tsx'`.

## Открытые задачи

### AI-POLICY-INVALIDATION

[Задача](AI-POLICY-INVALIDATION.md). Уже открытый AI-фрагмент может отдать результат после внешнего изменения policy; публичного способа уведомить существующие проекции нет. Повторно подтверждено обычным repro на npm 3.1.1: новый клиент старого fragment и keyframe получают result после отзыва. Обход сохраняется.

| Место | Что делает обход |
| --- | --- |
| `apps/support/backend/assistant-resource.ts`, `createSupportAssistant` | Приватный текст не попадает в AI replay; он читается отдельным запросом с текущим ACL и версией источника |

Проверка после исправления:

```text
cd apps/support && node --import tsx backend/ai-policy-repro.ts --expect-fixed
```

Удаление обхода: только после появления публичного API инвалидации — вызвать его сразу после изменения `allowed` и вернуть чтение приватного вывода через обычную проекцию.

### AI-RESOURCE-LIFECYCLE

[Задача](AI-RESOURCE-LIFECYCLE.md). Позднее завершение replay при отзыве SC1 даёт необработанное исключение специализированного AI-клиента. Повторно подтверждено обычным repro на npm 3.1.1: exit 1, `logical RPC line ended`. Обход сохраняется.

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

### STORE-NESTED-REPLACEMENT

[Задача](STORE-NESTED-REPLACEMENT.md) исправлена в common2 2.21.2. На npm 3.1.1 26 сентября минимальная приёмка прошла:

```text
cd apps/support && node --import tsx backend/store-nested-replacement-repro.ts --expect-fixed
```

Код выхода 0; вложенные элементы переживают замену родителя и остаются реактивными. Удалены поверхностные копии истории в `apps/support/backend/domain.ts` (`articleHistory`) и `apps/monitoring/backend/domain.ts` (`monitorSave`). Тесты обоих приложений прошли без обходов; [отчёт обновления](../changes/common2-3.1.1-react2-5.0.0.md).

Ранее принятые пакеты исправлений перечислены в [CURRENT-HANDOFF](CURRENT-HANDOFF.md) и `doc/changes/`.
