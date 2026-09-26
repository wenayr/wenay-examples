# Q06-A: typed actual Counter receipt handoff

26 сентября 2026. ORIGINAL checkout, после Q05 backend 5755acb.
Опубликованные common2 3.1.1/react2 5.0.0. Это приёмка узкого adapter stage A,
**не готовность Q06 целиком**. Documents product receipt persistence ещё не реализована.

## Что изменилось

Existing canonical createMeteredExecution получил `settled<T>(input,operation)`:
Promise<{value:T,receipt:UsageReceipt}>. Receipt — настоящий native usageSettle reply,
тип импортируется из существующего metering-contract. Свои receipt ids/ledger/transport
не создаются. Legacy `run<T>` разворачивает `.value` этого же execution path, поэтому
семейный UsageGate.run Promise<T> и human consumers сохраняют прежний интерфейс.

Input копируется/frozen до первого await. Reserve/settle returned target проверяется
против исходного orgId/eventId и actual reserved id; confirmed settle требует committed,
исходные units/period. Native reserve использует новый random command requestId при том
же domain eventId; fresh=false запрещает повторный operation. Cached fresh=true receipt
не превращён в execution lease. Current identity preflight, RPC role/tenant policies,
quota/concurrency, release-before-IO и unknown-after-uncertain-IO сохранены.

Confirmed settlement проверки/поздний signal находятся **после** uncertain catch зоны.
Если native settle уже подтвердил расход, поздняя ошибка не вызывает usageUncertain.
Если после confirmation signal aborted, settled всё ещё throws; это не доказательство
бесплатной операции. Caller должен сверить настоящий Counter event, а не rerun/refund.
Current product postawait ACL остаётся обязанностью продукта; HTTP receipt ACL bug этим
адаптером не исправляется и native RPC proof не принимает Counter REST semantics.

Штатный `node scripts/sync.mjs --write` обновил ровно три копии: Support/Documents/CRM.
Canonical плюс copies — четыре sourcefiles; sync differences=[] после изменения.
Documents processingResult/API, Support UI и Metering ledger не менялись.

## Actual runtime evidence

Root последовательно выполнил из `apps/metering`:

| Команда | Actual результат |
| --- | --- |
| node node_modules/tsx/dist/cli.mjs backend/documents-machine-integration-check.ts | PASS, exit0, 2.706с |
| npm run test:integration | PASS, exit0, 3.948с после exact sync-banner fixture fix |

Первая проверка использует настоящие Metering/Documents native hosts, выданные отдельно
scoped keys, actual Metering adapter и actual Node CSV. Сохранился исходный Q06-0 run:
единственный event documents-<native run.id>, committed одна единица; native run/event
repeat и conflicts не выполняют работу снова. Current product revoke закрывает retained
start/result; current Counter revoke закрывает retained settle/read и новую обработку
с ещё живым product key.

Stage A добавил два отдельных actual CSV adapter operations:

- settled.value — настоящий parsed CSV. settled.receipt deep-equal native settlement
  reply с тем же account/requestId, включая original fresh. Повтор domain event получает
  fresh=false и не вызывает CSV второй раз.
- Caller меняет исходный eventId/units внутри operation; native settlement и return
  остаются связанными с frozen исходным target, не с изменённым caller object.
- Native Counter fixture hook вызывает AbortController только после original real
  usageSettle.apply. Поздний signal отказ не вызывает usageUncertain: attempts=0,
  actual event остаётся committed. Hook делегирует реальные original domain/outbox apply,
  не подменяет ledger/receipt или provider outcome.
- Итог actual ledger — три committed events/used3, reserved0/active0: один Documents run
  плюс два явно самостоятельных CSV adapter probes. Это не три execution исходного run.

Завершающие строки нового fixture:

```text
PASS Q06-0 bounded proof: real Counter + Documents machine CSV, one actual event/receipt, totals, dedup and current revoke
PASS Q06-A typed handoff: settled value + actual native receipt, repeated event prevents IO; late abort after commit never calls uncertain
GAP CONFIRMED: product status/result contain no Counter receipt; no Q06 acceptance, restart/lost-response/Support proof yet
```

Второй actual runtime прошёл: `PASS three real SaaS services`. Existing Support human
assistant и Documents human processor используют legacy run с одним настоящим Counter;
проверены реальные source/result, totals, domain dedup, tenant binding, quota exhaustion,
concurrent slot, unknown reserve и credential revoke. Это регрессия legacy interface,
не второе доказательство новых Support machine API retry/result semantics.

Первый legacy запуск остановился до runtime: client-contract source без canonical sync
banner сравнивался с consumer copy с banner. Public sync.mjs не предоставляет normalizer.
Fixture теперь требует exact известный двухстрочный prefix и сравнивает **все оставшиеся
bytes**. Arbitrary comments/logic/newlines не очищаются, другой banner тоже отклоняется.
PASS 3.948с выше относится к повторному actual выполнению после этой минимальной правки.

Авторские lightweight PASS: Metering/Support/Documents/CRM typecheck, targeted style0,
sync[], diffcheck0. Тяжёлые runtime запуски выполнял root, paid calls отсутствовали.
Собственные fixture каталоги/hosts/clients/resources очищаются через try/finally.

## Незакрытые границы

Product status/result по-прежнему не содержит Counter receipt/accounting. Adapter outcome
сам по себе не durable product linkage. Lost reserve/settle response, restart обеих
authority, crash после accounting commit до product metadata, pending revoke во время
reserve/settle, reconciliation с replacement same-tenant key, отдельные server processes,
Support machine retry/result и billing uncertainty UI — следующие стадии Q06.

Counter единственный writer quota/events/outbox. Product key revoke не отменяет расход
и не даёт серверному Counter key нового права. Counter key revoke не позволяет старому
key сверять/settle/uncertain; существующий другой trusted usage:write key той же организации
может завершить org event, но этот сценарий пока не принят новым machine fixture.
Опубликованный public API использован без native patch, own receipts или billing provider.

## Минимальный Stage B — предложение для root review

Bounded цель: показать подтверждённый actual Counter receipt в Documents status/result
после **успешной текущей попытки**, с native persistence/restart и current key/doc ACL.
Это не попытка сразу закрыть loss/crash reconciliation новым большим слоем.

1. Configured Documents accounting использует небольшой inferred `settled` порт фабрики.
   Legacy UsageGate.run других продуктов не менять. При configured accounting нельзя
   fallback на run и всё равно объявлять receipt confirmed; без Metering остаётся честный
   local/unmetered mode. Existing unit fake gates не считаются actual receipt proof.

2. DocumentItem получает optional `usageReceipt`, тип из существующего metering-contract,
   без второго receipt interface/ledger. Сохранить actual settlement snapshot; fresh —
   свойство первоначального command reply, **не разрешение выполнить операцию снова**.
   Native run/attempt/sourceVersion уже определяют текущую processing identity. На новом
   processingBegin/новом source current receipt очищается; это отсутствие locally attached
   подтверждения, не нулевой расход старых попыток. Counter history остаётся durable.

3. Existing system `processingResult` принимает optional receipt в public schema,
   сохраняет table/provenance/receipt одной native metadata command. Проверяет exact
   receipt.orgId==input.orgId, eventId=='documents-'+input.runId, committed units=1,
   actual current run/attempt/source version/owner. Источник receipt — доверенная private
   server adapter connection, не machine caller payload. Current credential ACL до apply
   и postawait returned id/owner/attempt остаётся строгой, receipt не даёт нового доступа.

4. Product status/result добавляют `usageReceipt:null|copied snapshot`, после тех же current
   requireProductKey/item/matches проверок. Snapshot не содержит Counter key/secret,
   org credentials или source bytes. Другой ключ/tenant его не читает; reviewer/owner human
   behavior сохраняется. Revision/status означают документ, committed receipt означает
   accounting; human approval не выводится из billing. Null — no attached confirmation,
   не no-cost. Existing documents без optional field читаются как раньше.

5. Actual fixture проверяет run→native Counter receipt→native processingResult→status/result,
   equality с actual event/native reply, один executor/charge при frozen repeat, restart
   metadata receipt без новой работы, revoke/expiry после settle перед metadata/return,
   wrong key/tenant и source/attempt change. Legacy human tests остаются отдельной регрессией.

Ограничение Stage B заранее явное: если product key revoked или crash произошёл после
Counter settle, но до разрешённой processingResult записи, Counter мог committed без
локально attached receipt/table. Не ослаблять current ACL и не создавать новый privileged
receipt-writing путь ради сокрытия этого окна. Status failure/uncertain/null не утверждает
no-cost. Последующий отдельный recovery stage должен сверить native run.id→actual Counter
event через trusted replacement authority, сохранить известный факт по узкому контракту,
не повторять executor и не делать автоматический refund/release. Stage B принимает
success persistence/current issuance boundary; полную Q06 crash/revoke модель — позже.

Точный frozen Stage A source set: shared/backend/metered-execution.ts, synced copies
apps/{support,documents,crm}/backend/metered-execution.ts,
apps/metering/backend/documents-machine-integration-check.ts,
apps/metering/backend/integration-check.ts. Package/test wiring, product result persistence
и UI не входили; cross-app machine fixture имеет explicit scaffold skip в Metering.
