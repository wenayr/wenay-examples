# Q06: native AI checkpoint + actual Counter receipt proof

26 сентября 2026, ORIGINAL. Первый root run85242 EXIT1; corrected actual repeat EXIT0, 2.489s.
Это public feasibility proof, не Support production capability или Q06 acceptance.
Scope: scripts/usage-ai-checkpoint-proof.mjs и этот отчёт. Donor Support/Metering,
canonical modules, scopes, package scripts и transports не меняются.

## Public composition и exact command

Installed public common2 3.1.1: createAiRunHost из wenay-common2/ai,
createServiceLeaderHost и createServiceClient из опубликованных service exports.
createRequire anchored apps/support/package.json выбирает installed public dependency.
Existing Support openAiCheckpoint использует публичный AiRunPersistencePort,
FsReplayStorage и synchronous fsync; existing createMeteredExecution.settled даёт
actual typed native Counter receipt. Existing Metering runtime запускается локально
с own data directory и штатными scoped owner-issued keys/native identity.
Новый ledger/cache/transport или synthetic receipt не создаются.

Root sequential command из ORIGINAL после освобождения heavy slot:

```powershell
node apps/support/node_modules/tsx/dist/cli.mjs scripts/usage-ai-checkpoint-proof.mjs
```

tsx только загружает existing TypeScript adapters; отдельной сборки библиотеки нет.
Own fixture directory apps/support/.test-data/usage-ai-proof-* содержит только
синтетические native Counter/archive/checkpoint данные. Parent создаёт directory,
запускает own child через public tsx loader и удаляет archive только после confirmed
child exit с exact parent+prefix guard. Overall child deadline25s; при зависании
Windows taskkill own PID/T/F timeout3s либо POSIX own detached process group SIGKILL,
затем stop wait2s. Timeout всегда FAIL, неподтверждённый stop сохраняет archive.
Perphase native create/login/issue/read/retry deadline4s, polls10s; metering timeout8s.
Эти deadlines не выдают Promise timeout за отмену native IO. Late host creation
отслеживается own creating Promise; closing generation сразу закрывает late host.
Child finally allSettled закрывает AI/usage, затем resources (2s), clients, Counter
(2s), пытается каждый этап независимо. Pending creation/close не позволяет удалить
archive внутри child; parent подтверждает остановку процесса до удаления данных.
Нет paid AI, внешних providers, user data или production machine API изменений.

## Prepared actual assertions

Fake executor здесь только локальный одноэлементный article-shaped output;
Counter reserve/settle и checkpoint storage реальные. Frozen full request содержит
org/query/limit и org resourceIds. Runner вызывает settled один раз, возвращает
bounded fixture result вместе с exact returned receipt в AiRunOutput.result;
AiRun.usage/token поля не переиспользуются.

Первый terminal completed: native Counter committed receipt имеет exact org/eventId.
Fresh host из того же FsReplay checkpoint возвращает deepEqual complete run/result/
receipt по тому же full request, executions остаётся1. Changed input под тем же
requestId отказывает native conflict; current policy revoke отказывает cached retry.
Это native direct connection proof; real machine credential RPC lifecycle здесь
не доказан и требует последующего scoped product fixture.

Второй independent checkpoint: fixture port отказывает **до** записи completed
checkpoint, после actual settled Counter operation. Native persistence error
оставляет durable running run без result; fresh host recovery.pending==1 и
executions==2. Автоматического runner.run/recover нет. Current revoked policy
отказывает recovery.settle(failed); после explicit restoration той же fixture
policy native failed terminal разрешён, pending==0. Никаких broad one-shot permits,
privileged public writer, completed outcome fallback или повторной paid execution.
Counter read проверяет2 committed units, zero reserved; missing product receipt
не выдан за zero cost. Это controlled known-before-write failure, не crash simulator
и не lost-response reconciliation proof.

## Limits и необходимый следующий scope

Counter commit и AI terminal checkpoint не atomic. Genuine crash/lost response до
durable product output остаётся unresolved: Counter read не восстанавливает output
или exact returned receipt. Не rerun/refund, не fake receipt из read event.
Current credential expiry/revoke, source publication/revision checks, outer resource
generation/closed/signal/pre-post-await ACL и machine HTTP/RPC endpoint ещё не созданы
этим proof. Human Support answer/ticket ACL и Q04 published latest-array path прежние.

Public host generic result имеет unknown: production envelope требует validation,
bounded body и текущего owner/org/source guard. Public replay policy invalidation
не гарантирует safe retained disclosure; raw AI fragment machine не публиковать.
Fixture policy restoration разрешает только проверенный failed reconciliation;
production internal job authority/credential separation требует отдельного review.

Source clarification к предварительному audit: AI host history регулирует replay
history, а не TTL persisted requestId/runs. В inspected ai-run-host.js отдельный
run eviction по history не обнаружен. Не обещать ни автоматическую persisted retention,
ни eviction только на основании history:5; product bounds/cleanup требуют своего
contract. Это уточнение source audit, не новое runtime доказательство.

Light checks actual PASS: node --check, style1file/0 и git diff --check.
Runtime command не выполнялся агентом; corrected root repeat EXIT0. Полный Q06 не accepted.

Первый actual root run session85242 EXIT1: terminal/restart/full-request retry/current
policy branches достигнуты, gap branch timeout controlled persistence refusal.
Supervisor cleanup завершился с подтверждённым child exit1. Source diagnosis:
installed ai-run-host.js:56–73 default ID — host-local ai-1/ai-2 counter;
оба независимых fresh completed/gap checkpoints начинают с ai-1. Fixture eventId
ai-proof-run.id ошибочно пересекал Counter namespace; settled запрещает уже
зарегистрированное событие до execution. Это доказанная source ошибка fixture,
а не runtime evidence successful gap. Исправление: eventId включает stable fixture
checkpoint namespace completed/gap и native run.id; receipt не придумывается.
Counter read теперь проверяет exact оба distinct eventIds. Ранний failed gap run
даёт bounded diagnostic id/state/error вместо timeout; controlled terminal-before-write
проверка сохранена. Первый FAIL не скрыт.

Root corrected exact command actual **EXIT0, 2.489s**, output chunk3ee702:
real native Counter + AI terminal result/receipt, fresh checkpoint restart, exact retry,
full input conflict, current policy refusal и controlled committed gap/no automatic
rerun PASS. Published host-local ID generation независимо сверена root. Native outcome
и real Counter assertions пройдены, не заменены fake UsageGate. Independent port52920/
own directory absence inspection root подтвердил: listening52920 равно0,
собственных usage-ai-proof directories не осталось; supervised exit0 подтверждён.
Whole Support product, real credential RPC lifecycle и crash/lost-response recovery
по-прежнему не accepted этим bounded direct-host proof.
