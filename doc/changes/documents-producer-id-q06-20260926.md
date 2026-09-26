# Q06-PRODUCER-D: Documents independent producer IDs

26 сентября 2026, ORIGINAL. Production slice и strengthened root runtime PASS.
Documents-only slice; Support остаётся отдельным будущим scope. Не whole Q06 acceptance.

## Contract и минимальный change

Published common2 3.1.1 AiRunHostDeps.id принимает () => string. Documents production
createAiRunHost теперь получает существующий node:crypto randomUUID. EventId остаётся
documents-run.id, processingResult/UsageReceipt linkage и schema прежние. Нового
ledger/namespace registry/config/secrets или transport нет. UUID даёт стандартную
вероятностную uniqueness между independent archives; library дополнительно отказывает
duplicate ID внутри host. Это не абсолютная распределённая uniqueness transaction.

Installed host восстанавливает usedIds и owner/requestId → persisted run.id из
initial checkpoint. createRun проверяет full request и возвращает существующий run
до обращения к id factory. Поэтому старые ai-N IDs не мигрируют и normal restart
сохраняет прежний native event/receipt. Existing UI/checks используют opaque dynamic
run.id, literal ai-N assumptions в production paths не обнаружены.

Affected production file: apps/documents/backend/processing-resource.ts — один
id:randomUUID entry; crypto import существовал. Новый isolated fixture:
scripts/documents-producer-id-proof.mjs. Existing Metering/Support production,
canonical modules, integration fixture, package/scaffold/UI не менялись.

## Prepared independent acceptance

Root sequential command из ORIGINAL после source review/freeze:

```powershell
node apps/documents/node_modules/tsx/dist/cli.mjs scripts/documents-producer-id-proof.mjs
```

Real native Counter host + два production createDocumentRuntime с независимыми
data/processing archives. Одна Counter org и один и тот же actual billing key.
Product key issue/start inputs и identity одинаковы между archives; local CSV parser
реальный, не fake UsageGate/provider. UUID run IDs и documents-event IDs distinct.
Actual original usageSettle receipts deepEqual machine status/result, Counter ровно
2 committed events/used2/reserved0/active0 и оба events принадлежат shared billing key.
Same archive A restart/full request retry возвращает тот же ID/receipt без третьей
extraction; changed processor input отказывает native full-request conflict.

Backward compatibility отдельно seed-ится через public native createAiRunHost с
id factory ai-1 в уже остановленный собственный B checkpoint, используя existing
openAiCheckpoint, без ручной записи ledger/archive. Это синтетический terminal
compatibility run, не billed extraction и не изготовленный receipt. Новая production
factory B читает old ai-1 по exact request, сохраняет original UUID run и не вызывает
production executor. Deserialized persisted completed legacy run до остановки deepEqual всему native
checkpoint run после production reopen/retry; не только existence/string ID.
Нельзя объявлять этот seed proof реальным историческим job
settlement: actual cost2/receipt proof относится к двум настоящим CSV runs.

Own parent supervises native child: deadline30s, own process-tree forced stop3s,
confirmed exit wait2s. Native host/login/issue/upload/start/status/result/read bounded5s;
polls10s; usage existing timeout8s. Late host generation закрывается при closing.
Finally allSettled пытается resource→client→host cleanup независимо; архив удаляется
parent только после confirmed child exit. Unconfirmed stop сохраняет directory.
Own data apps/documents/.test-data/producer-id-proof-*; user data не используются.
No paid AI/provider calls, no new product transport, no source fixture flags.

## Limits

Data reset не равен restart: при потере checkpoint исчезает native request dedup.
Новый UUID предотвращает случайную event collision, но не распознаёт утраченный
business job и не предотвращает его ручное повторное billing. Нельзя автоматически
rerun lost jobs, обещать exactly-once после reset или считать missing receipt zero cost.
Counter commit → product terminal persistence crash/lost-response gap остаётся.
Current org/key/revision/source/late-abort guards production не менялись; этот маленький
proof не заменяет accepted machine/full Documents regression после source change.
Support assistant IDs и machine durable handoff требуют отдельного app commit/proof.

Light syntax/style2files0/diffcheck и Documents npm run typecheck PASS;
Первый root actual proof output e35fd1 EXIT0 8.5016s: 5 hosts, два реальных CSV/
Counter cost2, restart/native receipts и legacy compatibility branches PASS.
Review уточнил negative assertion: прежний assert.rejects мог принять timeout/ACL;
теперь matcher требует published native `AI run create: requestId reused with different input`.
Unused hosts list удалён; lifecycle creating tracking/cleanup прежние. Первый outcome
не выдаётся за specificity proof нового matcher; strengthened repeat и full Documents
regressions пока pending root. Дополнительный разрешённый legacy completed clone
deepEqual усиливает compatibility assertion; production source неизменён.

Root Documents target9254 EXIT0: type0.9s/test45.7s/build1.9s. Strengthened fixture
845f68 EXIT1 3.2829s: structuredClone reactive native run Proxy дал DataCloneError.
Это fixture snapshot ошибка, не compatibility rejection. Fix использует plain
deserialized openAiCheckpoint.initial.store.runs[old.id] и явно проверяет durable
state completed до reopen; unsafe casts/Proxy clone нет. Full-run deepEqual сохранён.
Final corrected root repeat `0dd006` **EXIT0 3.9421s**: exact native conflict matcher,
две production extraction, два committed Counter events/used2 и прежние actual receipts,
restart без нового execution, whole persisted legacy terminal deepEqual PASS.
Root Documents regression `9254` **EXIT0**: typecheck0.9s/test45.7s/build1.9s,
настоящий Python задан через DOCUMENT_PYTHON. Ошибочный CLI вызов с `--only documents`
отклонён до app checks; correct `--only=documents` выполнил все три проверки.
Root подтвердил: own ports50376/50383/50394/50402/50406 listen count0,
own producer-id-proof directories отсутствуют. Final independent source review PASS;
repository style471files/0. Full merged gate после переноса ещё pending; parent Q06 не закрыт.

Перенос: ORIGINAL `53f3a8d` → INTEGRATION `9d47359`. Exact transferred fixture
root `e18bd3` **EXIT0 5.8218s**; own ports60925/60932/60943/60951/60955 listen0,
producer-id-proof directories отсутствуют. Full raw27106 запущен на этой source basis;
пока active, не PASS. Последующие browser reports не меняют app source.

Последующий raw27106 завершился **EXIT0** на source9d47359: все38 actual app checks,
style498/0/links852/0 и generated status verify PASS. Documents type/test/build
0.8/45.3/2.0с. [Полный отчёт](examples-post-transfer-gate-20260926.md).
Родительский Q06 сохраняет отдельные непроверенные Support/lost-settle/crash границы.
