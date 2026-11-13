# Q05: минимальный дизайн машинного API Documents

26 сентября 2026. **Дизайн, не реализация и не приёмка Q05.** Объединяет
[исходный аудит](../internal/progress/documents-machine-api-audit.md) и
[проверку публичных API и lifecycle](../internal/progress/documents-machine-api-review.md).
Исходники приложений, package/lock, shared journal и тесты этим документом не меняются.
Версии основания: опубликованные common2 3.1.1 / react2 5.0.0.

## Граница продукта

Машинный consumer загружает собственный файл, запускает извлечение и получает
status/result. Он не становится human member, uploader, reviewer или owner.
Новый authority resource `productDocuments`, allow `['documents:extract']`, публикует
только `{control: {upload, start, status, result}}`. Native AI connection остаётся private.
Human `processor`, workspace, review/admin сохраняют отдельные предметные проверки.

Сохраняются один `createDocumentProcessing`, native `createAiRunHost`, checkpoint,
blob storage и существующая files queue. Не добавляются транспорт, reconnect, replay,
receipt map или второй job writer. Support machine keys служат reference composition;
общий infrastructure helper выделяется после приёмки второго consumer, не заранее.

## Credentials и текущий scope

Optional `DocumentState.productKeys` безопасно читается как `{}` в старом state.
Key metadata: id, orgId, label, hash, scopes, createdBy, createdAt, expiresAt, revokedAt.
Единственный scope — `documents:extract`. Машинный account — `product:<id>`; его нет
в accounts/members. Native login проверяет secret и текущий key/tenant/expiry/revoke.
`rolesOf` выдаёт только product scope, без human ролей.

Owner authority `productKeys` предоставляет guarded issue/list/revoke. Secret случайный,
показывается один раз; persistence хранит только hash. ID issue выводится из публичного
`Command.commandReceiptKey(ownerAccount, requestId)`. Повтор issue с тем же payload
возвращает metadata и `secret:null`, changed input rejected. Лимит не называется ротацией:
если сохраняется Support лимит 100, expired/revoked записи тоже считаются.

Owner authorizer проверяет owner именно переданного org в текущем state. Register/revoke
делаются native system commands; публичный owner resource повторяет ACL/lifecycle до
native команды и после await. Не копировать standalone owner service-command revoke
как доказанную защиту повторов: native service receipt возвращается до domain apply,
а generic owner allow не проверяет актуальное владение конкретным tenant. Это известная
граница `SERVICE-COMMAND-RECEIPT-ACL`; исправленная версия библиотеки — другой возможный путь.
Native HTTP service-command corridor не является публичным machine/admin API Q05.

Processing ACL отделена от human `organizationAccess/documentAccess`: key текущий,
scope точный, org существует и совпадает с key.orgId, документ не deleted и
`document.owner == product:<id>`. Другой key той же org не получает доступ к документу,
job/result или повтору его requestId. Body account/roles не принимаются: principal
выводится только native identity из bearer. Это применяется в operations, blob authorization,
runner и system import/begin/result. Human review/delete/memberRole не получают machine branch.

## Четыре операции

| Метод | Вход | Минимальный результат |
| --- | --- | --- |
| upload | RPC `{orgId,name,bytes}`; HTTP `{orgId,name,base64}` | `{id,revision}` |
| start | `{orgId,id,revision,processor,requestId}` | `{runId,documentId,state}` |
| status | `{orgId,id}` | document revision/sourceVersion/status/attempt/processor/rowCount/error и минимальный current job outcome |
| result | `{orgId,id,revision}` | `{id,revision,sourceVersion,status,table,provenance}` |

RPC bytes и HTTP Base64 используют существующие native schemas/validators и лимит
512 КиБ. HTTP — адаптер тех же операций через public `createHttpFacadeServer`, не новый
transport. Descriptor/OpenAPI описывают ровно четыре операции. Точный status DTO выводится
из первой working factory; он не возвращает raw AiRun, requests, artifacts или audit.

Result собирается из copied document snapshot с current revision guard. Human detail
не является machine result: он дополнительно читает source и содержит comments/approvals.
Machine не получает download/compare/export, source bytes, blobId, approvals или raw AI replay.
Table может быть текущей отредактированной человеком revision; это явно отражают revision
и sourceVersion, а не обещание неизменного первоначального extraction output.

Upload idempotency content-derived из `[orgId,account,normalizedName,bytes]`, без отдельного
request receipt. Retry повторяет те же имя и bytes; другое содержимое — другой upload.
Start использует native `connection.fragment.createRun` с kind extract, resourceIds `[id]`
и неизменным ProcessingRequest. Consumer сохраняет полный payload и стабильный requestId
после lost response. Current key/document проверяются до вызова, прежняя revision допускается
для native повтора именно того requestId; changed input проверяет native host.

Порядок common2 createRun подтверждён чтением установленного кода:
canCreate → request receipt → changed-input comparison → canRead. **Comparison включён
только при persistence или initial.** Поэтому durable Q05 runtime требует data directory
и native checkpoint; ephemeral fixture должен иметь публичный initial checkpoint либо
не заявлять changed-input/restart guarantees. Самодельный retry ledger не добавляется.

## Владение временем жизни

| Владелец | Что прекращает | Что продолжает жить |
| --- | --- | --- |
| Request/resource controller | queued upload, byte/read IO и выдачу ответа после close/disconnect | accepted durable run |
| Job controller | extraction данного run после timeout/key revoke/expiry | уже committed domain metadata/result |
| Authority lifecycle | все server jobs при shutdown | durable checkpoints для честного recovery |

Обычный `host.connection(account).close()` закрывает view, а не cancelRun. Успешный HTTP
start закрывает временное подключение; job работает дальше и доступен новым poll connection.
Request disconnect и timeout связаны с owned request controller, а не с job controller.
Successful response finish не означает job cancellation. Local closed flag требуется
и в productKeys, и в human/product processing resource: прямой in-process close не обязан
abort ctx.signal. Retained direct façade и retained RPC проверяются раздельно.

Минимальная terminal семантика revoke/expiry: новые операции и выдача запрещены, pending
job controller abort-ится, runner отклоняется, **native run становится failed**. Это не
обещание cancelled. Native cancelRun после live-key revoke может быть запрещён canWrite;
публичного cancel endpoint в четырёхоперационном контракте нет. Если queued run отказал
до processingBegin, document остаётся uploaded при failed job. После begin системная
processingFailure может записать failed без live key, но с activeRun/attempt guard.

Clock один для key login/roles/method guards/domain/runner. Store change revoke abort-ит
pending jobs; expiry самостоятельно Store event не создаёт, поэтому job имеет deadline
expiresAt и очищаемый timer. Fake now сам не запускает setTimeout: deadline scheduler/tick
или bounded реальная barrier deadline должны независимо доказывать expiry interruption.
Permissions snapshot не заменяет current guard на границе IO.

Проверки выполняются при dequeue, до/после blob IO, после processingBegin, extraction,
usage settlement, processingResult и перед ответом. Системные native command receipts могут
пропустить повторный apply; orchestrator повторяет current ACL независимо от receipt.
Ignoring-abort provider может физически закончиться позднее, но Promise.race/post-await guard
не допускают late successful commit/выдачу. Уже committed до revoke запись не откатывается;
последующая выдача и native runner success всё равно требуют текущего доступа.

## Restart и trusted reconciliation

Interrupted document переводится в uncertain, extractor автоматически не запускается снова.
Completed document/run и native receipts сохраняются. Native recovery.settle требует
canWrite(owner,run) и canCreate(owner,persistedRequest). Если обе policy требуют live key,
revoked/expired recovery блокирует settle и общий mount.ready. Простое копирование прежнего
recovery loop после расширения ACL ошибочно.

До consumer нужен отдельный публичный feasibility probe. Предлагаемый минимальный путь:
private host получает узкую trusted reconciliation authorization только на время
синхронного server `recovery.settle` конкретного восстановленного run, с try/finally.
Она позволяет terminal reconciliation, не resume/create нового run, extractor или consumer
доступ. Product façade продолжает требовать live key до и после native операции.
Policy не ослабляется глобально, host store не изменяется вручную.

Это **не проверенная реализация**. Если публичная композиция не позволяет доказать такую
границу без consumer bypass, оформить library task trusted terminal recovery и оставить
эту acceptance часть blocked. Нельзя принимать Q05 с readiness, сломанной одним expired run,
или скрывать blocker под успешным fresh fixture.

## Минимальные этапы без заранее построенного слоя

0. **Публичные primitives до source expansion.** Bounded native probes доказывают
   durable createRun repeat/conflict; ordinary connection close оставляет accepted job;
   abort runner → failed; revoked/expired restored run terminal settle не раскрывает данные
   и не ломает readiness второго разрешённого документа. Отдельно проверяется точный
   system receipt/owner revoke boundary. Неразрешённый public API blocker фиксируется здесь.
1. **Credentials primitive.** Optional keys, один injected clock, owner issue/list/revoke,
   native register/login/roles. Проверить one-time secret, current tenant owner, lost response,
   expiry/revoke, hash-only restart и machine no-human permissions до processing consumer.
2. **Processing ACL и один CSV run.** В existing processing factory добавить узкую machine
   authorization, private connection и только upload/start/status/result. Реальный CSV,
   content retry, durable native start repeat/conflict, copied result/revision и foreign key/org.
   Не создавать универсальный processing layer или второй host.
3. **Lifecycle/recovery.** Разделить request/job controllers, deadline, dequeue/IO barriers,
   direct/RPC close, no-consumer revoke, late provider и restart checkpoints. Проверить обе
   поверхности document status и native run state, включая честные committed-before-revoke случаи.
4. **HTTP и owner UI.** Shared four-operation schema/OpenAPI, real bearer-derived principal,
   native login, terminal poll/result; human HTTP regression. Owner UI one-time secret/copy/revoke,
   session/org key, clear при switch/logout/owner loss. DTO types выводятся из factory.
5. **Приёмка итогового дерева.** Targeted primitive/RPC/HTTP/barrier/restart/browser сценарии,
   typecheck/build и общий gate. Дизайн и accepted Support/C01 результаты не являются PASS Q05.

## Независимые доказательства перед приёмкой

- После ordinary request close accepted run завершается ровно один раз; после revoke/expiry
  прекращается job work даже без открытого consumer; новый consumer не получает старый secret/result.
- Retained direct и RPC façade закрываются; чужой org/key/document/runId и старый receipt
  не обходят current ACL. Проверяются только реально опубликованные четыре machine операции.
- Barriers перед dequeue, после upload metadata, processingBegin, input read, extraction,
  usage settlement и processingResult: честный committed state отделён от запрещённой выдачи.
- Restart на прежних secrets/data/port: active key работает, revoked/expired key denied,
  completed native receipt/result сохраняется, interrupted uncertain/failed не повторяет extractor
  и не блокирует остальные разрешённые keys/documents.
- Human review/admin/processor regression сохраняется, machine identity не получает human роли,
  raw replay/blob/result surface отсутствует в descriptor. Actual Counter остаётся Q06.

Следующее действие: сначала выполнить этап 0 и выбрать проверенный trusted recovery путь,
затем credentials primitive. Повторное чтение обоих временных аудитов для начала работ
не требуется: нерешённые public behavior и acceptance ограничения перечислены здесь.
