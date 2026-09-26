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

### CONVERSATION-RECEIPT-POLICY

[Задача](CONVERSATION-RECEIPT-POLICY.md), [public repro](repro/conversation-receipt-policy.ts).
Подтверждено на npm common2 3.1.1: после policy=false новый requestId отклоняется,
но прежний post/createChannel/createConversation возвращает закрытую entity через receipt.
Retained и fresh state keyframe фильтруются корректно. Библиотека не исправлена.

| Место | Что делает обход |
| --- | --- |
| `apps/chat/backend/chat-resource.ts`, `previous(requestId)` с захваченным account | До вызова native fragment или выдачи прежнего результата находит account-scoped receipt и повторяет `requireRoom` для его entity; `request`/`active` проверяют актуальную membership и lifecycle |

Проверка после опубликованного исправления из `apps/chat`:

```text
npx tsx ../../doc/library-tasks/repro/conversation-receipt-policy.ts --expect-fixed
```

Обычный режим на 3.1.1 exit 0; ожидаемое исправление exit 1. Обещание first entity сохраняет
идемпотентность, но не считается исключением из актуальной ACL; намеренную иную семантику должен подтвердить автор.
Удалять wrapper guard только после точного npm-обновления и повторной отрицательной приёмки приложения.
### CONVERSATION-RESOURCE-LIFECYCLE

[Задача](CONVERSATION-RESOURCE-LIFECYCLE.md), [public repro](repro/conversation-resource-lifecycle.ts).
На npm common2 3.1.1 native conversation consumer не имеет позднего error port;
завершение живого SC1 remote ставит необработанный timer throw `logical RPC line ended`.
Тот же механизм ранее подтверждён у AI consumer, но это отдельная проверка conversation.

| Место | Что делает обход |
| --- | --- |
| `apps/chat/shared/conversation-client.ts`, `createOwnedConversation`; frontend owner | Сохраняет native client и RPC line handle, первым наблюдает его завершение и закрывает consumer до library callbacks; `onEnded` очищает старое frontend зеркало |

Проверка после опубликованного исправления из `apps/chat`:

```text
npx tsx ../../doc/library-tasks/repro/conversation-resource-lifecycle.ts
npx tsx ../../doc/library-tasks/repro/conversation-resource-lifecycle.ts --revoke
npm test
```

Удалить line observer guard только после точного npm-обновления и добавления проверки публичного terminal/error channel.
Оба native repro должны завершиться без process fatal; terminal consumer error ожидаема и должна быть наблюдаема владельцем.

### SERVICE-COMMAND-RECEIPT-ACL

[Задача](SERVICE-COMMAND-RECEIPT-ACL.md), [public repro](repro/service-command-receipt-acl.ts).
Подтверждено на npm common2 3.1.1: новый HTTP requestId и retained principal RPC отклонены,
но HTTP retry старого requestId возвращает приватный fixture marker после утраты owner-прав.
Обычный repro exit 0; `--expect-fixed` exit 1; finally cleanup завершился в обоих режимах.

| Место | Что делает обход |
| --- | --- |
| `apps/chat/backend/workspaces.ts`, `createMembershipCommand` | Bound native commands используют точную current owner-роль workspace; principal RPC проверяет её до receipts |
| `apps/chat/backend/public-login.ts`, `mountChatLogin`; `backend/server.ts` | Полный native REST отключён, публичный native REST монтируется только для login; HTTP commands не экспортируются |

Проверка после исправления из `apps/chat`:

```text
node --import tsx ../../doc/library-tasks/repro/service-command-receipt-acl.ts --expect-fixed
```

Удалить ограничение native REST только после опубликованного исправления, точного npm-обновления
и отрицательной runtime проверки старого receipt после потери owner при сохранении member.
Bound workspace-команды остаются предметной границей даже после исправления библиотеки.

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
