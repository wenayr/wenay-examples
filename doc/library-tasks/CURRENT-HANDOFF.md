# Единый пакет для wenay-common2 и wenay-react2

Обновлено 26 сентября 2026 при переходе на точные npm-версии **common2 3.1.1 / react2 5.0.0**. Историческое основание — задача L07 [плана 2](../CONSOLIDATION-PLAN.md). [Аудит публичного API и минимальные результаты](../reports/LIBRARY-API-AUDIT-2026-09-26.md).

**Сверено 26 сентября 2026:** минимальные repro запускаются с установленным npm common2 3.1.1. Store replacement исправлен; обе AI-задачи сохраняются. Результаты общего обновления приложений фиксируются отдельно от минимальных repro.

Здесь только открытые задачи с воспроизведением. Предметных пожеланий и неподтверждённых идей в пакете нет. Места в коде, существующие из-за этих задач, перечислены в [реестре обходов](WORKAROUNDS.md) и помечены в исходниках комментарием `// Обход common2: <ID>`.

Прежняя версия документа с полной историей закрытых пунктов — [handoff за 10 сентября](../changes/handoff-2026-09-10.md).

## Открыто: common2

Пять задач, у каждой точная версия, минимальное воспроизведение и критерий приёмки в своём файле.
AI-задачи повторно подтверждены, Conversation receipt и lifecycle впервые подтверждены на npm 3.1.1.
Service command receipt ACL подтверждён public HTTP/RPC runtime repro на npm 3.1.1.

| ID | Что не так | Воспроизведение | Обход в примерах |
| --- | --- | --- | --- |
| [AI-POLICY-INVALIDATION](AI-POLICY-INVALIDATION.md) | Уже открытый AI-фрагмент отдаёт результат после внешнего изменения policy; публичного способа уведомить существующие проекции нет | `cd apps/support && node --import tsx backend/ai-policy-repro.ts` | Приватный вывод читается отдельным запросом с текущим ACL и версией источника |
| [AI-RESOURCE-LIFECYCLE](AI-RESOURCE-LIFECYCLE.md) | Позднее завершение replay при отзыве SC1 даёт необработанное исключение специализированного AI-клиента | `cd apps/support && node --import tsx backend/ai-resource-lifecycle-repro.ts` | Публичное state-only зеркало `createStore` плюс `syncStoreReplay(..., {onError})` вместо AI-клиента |
| [CONVERSATION-RECEIPT-POLICY](CONVERSATION-RECEIPT-POLICY.md) | Прежний requestId возвращает закрытую message/channel/conversation после policy=false; новые requestId и keyframe учитывают запрет | `cd apps/chat` затем `npx tsx ../../doc/library-tasks/repro/conversation-receipt-policy.ts` | `apps/chat/backend/chat-resource.ts`: account-scoped `previous(requestId)` повторяет `requireRoom` до native fragment/выдачи entity |
| [CONVERSATION-RESOURCE-LIFECYCLE](CONVERSATION-RESOURCE-LIFECYCLE.md) | Завершение живого SC1 remote вызывает поздний process fatal в native conversation replay; публичного error port нет | `cd apps/chat` затем `npx tsx ../../doc/library-tasks/repro/conversation-resource-lifecycle.ts` (или `--revoke`) | `apps/chat/shared/conversation-client.ts`: первый observer публичного RPC handle закрывает native consumer; frontend очищает зеркало по `onEnded` |
| [SERVICE-COMMAND-RECEIPT-ACL](SERVICE-COMMAND-RECEIPT-ACL.md) | Native HTTP receipt retry возвращает приватный результат после утраты owner-прав; новые запросы и retained principal RPC запрещены | `cd apps/chat` затем `node --import tsx ../../doc/library-tasks/repro/service-command-receipt-acl.ts` | Bound workspace owner RPC commands и login-only native REST; HTTP commands не экспортируются |

Обычный policy repro на 3.1.1 подтверждает прежнюю выдачу result через старый fragment/keyframe; lifecycle repro после внешнего revoke завершается кодом 1 с необработанным `logical RPC line ended`. Режим `--expect-fixed` служит критерием приёмки будущего исправления; в этом аудите AI-критерии не запускались повторно.


Conversation repro: обычный режим exit 0, `--expect-fixed` exit 1 на 3.1.1. Это app wrapper workaround, библиотека не исправлена.
Контракт first entity для retry не описывает исключения из текущей ACL; оговорка о намеренной семантике автора сохранена в задаче.

Service command receipt ACL: обычный режим exit 0 на 3.1.1,
`freshHttpDenied: true`, `retainedRpcDenied: true`, `repeatedHttpReturnsPrivateResult: true`.
`--expect-fixed` exit 1; cleanup завершился в обоих режимах. Приёмка app mitigation C03 отдельная.

Conversation lifecycle: native resource close и membership revoke на 3.1.1 оба exit 1 с seq 2
`logical RPC line ended`, вне `main catch`; `FINALLY` не успевает завершиться.
Контроль `--revoke --dispose-before-end` exit 0 с завершённым cleanup. `npm test` chat с временным adapter прошёл.
Ожидается управляемая terminal/error доставка consumer без process fatal; удаление observer guard — после опубликованного исправления и регрессии.

## Исправлено при обновлении 26 сентября

[STORE-NESTED-REPLACEMENT](STORE-NESTED-REPLACEMENT.md): исправление выпущено в common2 2.21.2. На npm 3.1.1 `store-nested-replacement-repro.ts --expect-fixed` проходит, включая реактивность сохранённого элемента. Два обхода истории support/monitoring удалены; тесты обоих приложений прошли. [Отчёт обновления](../changes/common2-3.1.1-react2-5.0.0.md).

## Открыто: react2

**Новых подтверждённых дефектов нет.** Задачи R1–R4 приняты в 3.3.0 и 3.4.0. Проверка `useStoreSelect` по крупным представлениям выполнена и показала, что замены не требуется — [замер перерисовок](../reports/rerender-audit.md).

## Проверено и задачей не стало

Четыре направления из [контрольной точки 10 сентября](../internal/SAAS-CHECKPOINT-2026-09-10.md) разобраны; ни одно не превратилось в задачу библиотеке.

| Что проверяли | Вывод | Отчёт |
| --- | --- | --- |
| `createConversationHost` для переписки обращения | Оставляем в домене: ответ меняет сообщение, статус, отметку времени ответа, ревизию и аудит одной командой, а хост ведёт отдельный журнал | [сравнение](../reports/conversation-host-comparison.md) |
| `createFileJobHost` для обработки документов | Оставляем `createAiRunHost`: у файлового хоста нет восстановления прерванных заданий | [сравнение](../reports/file-job-host-comparison.md) |
| `useStoreSelect` вместо широких подписок | Перерисовки есть, правок DOM ноль, цена не измерима на текущих размерах | [замер](../reports/rerender-audit.md) |
| Собственные модальные окна и async-обвязка | Своих окон не осталось; три флага ожидания описывают многошаговую загрузку файлов | [аудит](../reports/ui-wrappers-audit.md) |

Контрольная сборка нового SaaS из каталога ([K08](../reports/K08-approvals.md)) новых дефектов библиотек тоже не выявила. Единственное наблюдение оттуда — пара `(requestId, input)` у команд не защищена типами от перепутывания при переносе проверок между примерами — оставлено наблюдением: одного потребителя мало.

Второй замер ([K09](../reports/K09-rental.md), 11 сентября 2026) новых задач библиотекам не выявил и **второго потребителя для этого наблюдения не дал**: в нём проверки адаптировались внутри одного примера, а не переносились между примерами, поэтому перепутать аргументы было негде. Наблюдение остаётся наблюдением. Всё, что понадобилось прокату — зоны IANA, пик одновременной занятости, удержание с TTL, ключ намерения, очередь ожидания и напоминания, — закрылось публичным API 2.21.1 и 3.5.1.

## Граница ответственности

Библиотекам передаются lifecycle, публичная композиция фасадов, повторяющаяся оркестрация ресурсов и общие гарантии транспорта, replay и прав. Предметные правила — статусы обращений, расписание, вместимость, квоты, согласование — остаются в приложениях и в пакет не попадают.

Задача оформляется при двух условиях: воспроизведение на точной опубликованной версии и либо доказанный дефект, либо два независимых потребителя одной композиции.

## Порядок принятия исправления

1. Опубликована версия, закрывающая задачу.
2. Точное обновление npm по приложениям в порядке `scripts/run-all.mjs`, по одному коммиту на приложение.
3. Обход удаляется по строке [реестра](WORKAROUNDS.md), сценарий повторяется, `--expect-fixed` должен пройти.
4. Результат записывается в `doc/changes/common2-<версия>.md`, строка реестра отмечается закрытой, задача переносится отсюда в историю.
