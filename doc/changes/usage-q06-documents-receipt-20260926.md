# Q06-B: Documents current native usage receipt

26 сентября 2026, ORIGINAL после Q06-A 272f704. Public common2 3.1.1/react2 5.0.0.
Реализован узкий Documents handoff/persistence, **Q06 целиком не принят**.
Root actual Stage B machine fixture и полный Documents regression приняты.

## Контракт и запись

Настроенный Documents runtime принимает inferred `DocumentUsage` с методом `settled`
из существующего createMeteredExecution. Значение и настоящий native UsageReceipt
передаются в ту же системную processingResult, которая сохраняет таблицу/provenance.
Новый receipt interface, transport, журнал, refund или резервный fake result отсутствуют.
Без Metering используется прежний extractor path, без выдуманного подтверждения.

DocumentItem.usageReceipt optional: старые archives/commands читаются как раньше.
Системный input usageReceipt optional, sourceVersion — optional number для старых вызовов;
при наличии receipt требуется точный текущий sourceVersion. Apply сначала проверяет
текущие owner/tenant/key, activeRun, attempt и processing state, затем receipt orgId,
eventId `documents-<runId>`, committed, units/reservedUnits=1, hash id и period.
Receipt берётся из уже проверенного actual settlement адаптера; shape validation
не выдаётся за независимую криптографическую верификацию Counter.

Processing result использует прежний native requestId `<runId>-result`. После await
runner снова проверяет текущий ACL/signal и возвращённый document target, run/attempt/
sourceVersion. Полученный receipt не разрешает читать чужую организацию или обходить revoke.
Machine RPC/HTTP status/result возвращают `usageReceipt:null | UsageReceipt` как отдельную
копию после current guard. Входные четыре machine operations не расширены receipt input.
Общий workspace не реплицирует receipt. Human raw AI policy и её прежние lifecycle/ACL
ограничения из Q05 не изменены и не объявляются исправленными этим этапом.

processingBegin удаляет receipt вместе с provenance. documentDelete тоже удаляет оба;
documentImport заменяет запись новым sourceVersion без старых receipt/provenance.
Receipt описывает текущую extraction attempt, не отдельную историю расходов либо approval.

## Доказательства и команды root

Lightweight: Documents typecheck PASS, Documents style 35 files/0; Metering typecheck PASS,
bounded fixture style 1 file/0, targeted diff-check PASS.

Root actual machine fixture: **PASS, exit 0, 5.5255s**. Fresh Documents host восстановил
native архив seq 5; status/result совпали с настоящим исходным native settlement,
receipt пережил restart, повтор start не запустил executor заново. Existing Q06-0/A
real event/totals/dedup/revoke и typed handoff/late abort проверки тоже прошли.
Independent read-only source review PASS, обязательных P1/P2 нет.
Root `npm test` плюс отдельный `npm run test:advanced`: **PASS, exit 0**, session 63977,
с configured `DOCUMENT_PYTHON` из установленного pythoncore-3.14-64. Выполнены domain,
check, product, machine, backup и advanced с настоящими concurrent Node/Python процессами.
Общее elapsed не замерялось и не указывается. Login-refused 500 и backup negative stdout
ожидаемы соответствующими проверками. Provider/paid calls отсутствуют.

Из `apps/metering`:

```powershell
node node_modules/tsx/dist/cli.mjs backend/documents-machine-integration-check.ts
```

Fixture использует настоящий local Counter + Documents native hosts, реальный CSV executor,
issued machine credentials. Добавлены prestart null, exact original native usageSettle
receipt equality со status/result и native Documents state, restart того же архива с новым
runtime/host/login, сохранённый receipt и same native run без второго executor.
Прежние event/totals/dedup/current revoke и Q06-A late-abort-after-commit проверки сохранены.
Это новый Stage B runtime proof; прежний Q06-A PASS 2.706s не засчитывается за него.

Из `apps/documents`, с установленным DOCUMENT_PYTHON:

```powershell
npm test
npm run test:advanced
```

Domain negative cases вызывают настоящий system command с чужим org/event, неподтверждённым
status, неверными units/reservedUnits/id/period и missing/wrong sourceVersion: таблица
и state не должны измениться. Изолированные domain snapshots с явно forged stale metadata
проверяют очистку begin/import; они не доказывают Counter settlement. machine-check
проверяет null для реального unmetered результата и его рестарта. Positive receipt proof
проводится только через actual Counter fixture, без fake подтверждений.

## Оставшаяся граница

Counter settlement и Documents metadata/checkpoint — отдельные native записи.
Crash, lost settle response или current key revoke после Counter commit до processingResult
могут оставить реальный расход без Documents receipt. Null не означает no-cost; запрещённые
после revoke запись/возврат не обходятся. Автоматический provider rerun/refund/reconciliation
не добавлены, unknown не подменяет confirmed commit. Recovery завершает сохранённый result
из существующей записи, но не реконструирует отсутствующий receipt из нового ledger.

Support machine handoff, lost reserve/settle reconciliation, crash recovery между сервисами,
quota product flow и whole Q06 acceptance требуют отдельных этапов. Counter HTTP cached
receipt ACL issue остаётся отдельной границей, этот native RPC proof его не исправляет.
