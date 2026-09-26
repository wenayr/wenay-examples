# Q05 — аудит машинного API Documents

26 сентября 2026. Read-only аудит исходного checkout, без реализации и PASS Q05.

Цель: минимальный настоящий machine consumer upload → start → status/result,
без human membership, workspace, review/admin; current tenant, expiry/revoke,
границы IO/close и durable jobs/receipts. common2 3.1.1 / react2 5.0.0, публичные API.

## Карта существующих фабрик

- `apps/documents/backend/product-http.ts`: `createDocumentProductHttp`,
  `DOCUMENT_PRODUCT_INPUTS`; четыре POST `/api/product/documents/{upload,start,status,result}`.
  Один native input schema → validator/OpenAPI, Bearer account через `authenticatedArgs`.
  Сейчас Bearer человеческой сессии; HTTP открывает обычный `processor` напрямую,
  делает операцию и закрывает connection. Это не machine API.
- `runtime.ts`: `createDocumentRuntime` собирает `documentsDefinition` и authority
  `processor`, монтирует processing с leader store/system executor.
- `processing-resource.ts`: `createDocumentProcessing` — один host/запись, blob storage,
  upload queue, native `createAiRunHost`, runner, recovery; `createDocumentProcessor` —
  Node/Python/model extraction. Машинный adapter должен использовать этот host,
  а не создавать второй job store/receipt ledger/transport.
- `domain.ts`: `organizationAccess` требует human account + org membership;
  `documentAccess` ограничивает uploader собственными документами. System import,
  begin/result/failure повторяют предметные проверки; review и memberRole отделены allow.
  `documentWorkspace` и `documentRoles` сейчас человеческие.
- `ai-checkpoint.ts`: `openAiCheckpoint` использует public `openFsReplayStorage`,
  `AiRunPersistencePort`, durable fsync; jobs переживают restart. Processing recovery
  отмечает прерванный документ uncertain и settles восстановленный run.
- `server.ts`: product Bearer проверяется leader identity/access, mounts тот же runtime.
- `product-check.ts`: human customer upload/реальная extraction/status/result,
  content-derived upload dedup, start repeat, stale revision, foreign org, membership revoke,
  exact HTTP/OpenAPI и отсутствие approve endpoint уже проверяются исходным сценарием.
  Это не доказательство machine keys, expiry, retained RPC или IO revoke.

## Основание Q04 Support

`apps/support/backend/product-credentials.ts` предоставляет `createProductCredentials`,
`requireProductKey`, `productRoles`, `verifyProductSecret`. One-time random secret,
SHA256 durable hash, `product:<id>` account, owner authority issue/list,
system schemaCommand register, owner revoke. ID выпуска выводится из native
`Command.commandReceiptKey`; повтор выпуска возвращает secret:null, конфликт rejected.
Текущий лимит 100 включает expired/revoked keys. Не выдавать эту границу за ротацию.

`runtime.ts` соединяет credentials с login, scope roles и authority `productSearch`;
`product-search.ts` повторяет текущие ACL/signal до и после usage IO.
Support helper связан с SupportState и `knowledge:search`: это образец композиции,
не готовый универсальный helper. Общий adapter выделять после второго потребителя,
как требует Q04 → Q05 → Q06, без переноса review/domain правил в инфраструктуру.

## Минимальный предлагаемый контракт

1. Optional durable `productKeys` в DocumentState для чтения прежнего state;
   metadata id/orgId/label/hash/scopes/createdBy/createdAt/expiresAt/revokedAt.
   Один минимальный scope `documents:extract` разрешает ровно четыре product операции.
   Другие scope, review/admin и human membership отсутствуют. Не добавлять machine
   в accounts/members и не давать ему signedIn/uploader/reviewer/owner.
2. Native service login проверяет `product:<id>` secret + текущие tenant/expiry/revoke;
   rolesOf отдаёт только допустимый product scope. Human login сохраняется.
   Owner authority `productKeys` issue/list + native system registration/owner revoke,
   как Q04; UI secret один раз, explicit copy, clear при org switch/logout.
3. Authority `productDocuments` предоставляет только `control.upload/start/status/result`
   с общими существующими input schemas (RPC upload может принимать bytes;
   HTTP base64 adapter сохраняет каноническую validation/лимит 512 КиБ).
   HTTP вызывает ту же предметную фабрику, а не расширенный human processor façade.
   Каждый вызов проверяет current key, bound org и ownership `document.owner == account`.
   Второй key той же org не получает чужой файл/job/receipt автоматически.
4. Processing принимает явную предметную авторизацию для machine import/read/start/result,
   которую используют resource, blob authorize, runner и system commands. Human review
   access не расширяется. Не подменять machine фиктивной human uploader membership.
5. Не отдавать raw `ai` fragment, human `detail/download/compare/export`, approvals/comments,
   audit/blobId и произвольный blob read. `start` возвращает runId/documentId/state;
   status — минимальный document/job outcome; result — текущие revision/sourceVersion,
   status/table/provenance. Native host владеет repeat/conflict и durable job receipts.
   Retry после revoke проверяет current ACL перед доступом к native repeat.

## Конкретные lifecycle пробелы до реализации

- `processing.resource.close()` очищает transfers и AI connection, но не ставит local
  closed flag и не abort-ит собственный control lifecycle. Native controller может abort
  ctx.signal, однако direct HTTP open/close этого сам не гарантирует. Retained control
  после direct close должен reject независимо от transport.
- Upload повторяет access после blob IO, затем `await execute.documentImport` и сразу
  возвращает imported. Нужна финальная current ACL/signal проверка после metadata IO;
  уже committed import не обещает rollback, выдача после revoke запрещается.
- AI policy canRead/canWrite сейчас только `run.owner == account`; canCreate проверяет
  item, но runner и методы adapter должны повторять live key/tenant/expiry перед native
  receipt и после async IO. Существующие зарегистрированные AI policy/lifecycle
  ограничения common2 нельзя считать решёнными wrapper-ом plain machine API.
- Pending listener реагирует на store changes. Expiry само по себе state change не создаёт:
  проверять injected clock на границах IO и ограничивать работающий machine job expiry
  deadline; revoke должен abort pending extraction и blob read, а поздний provider result
  не может записать успешный processingResult или выдать result.
- HTTP timeout сейчас `AbortSignal.timeout(12000)`, не связан с disconnect клиента.
  Для upload/result IO нужен owned request controller + request lifecycle; normal successful
  response finish не должен abort committed durable job. HTTP `start` закрывает временный
  connection сразу: job должен продолжать работать независимо от poll connection.
  Поэтому надо явно отделить close request IO от cancel durable job. Четыре операции
  не содержат cancel endpoint; если требуется публичная отмена, это отдельное согласованное
  расширение, иначе current key revoke/expiry отменяет job предметно. Не silently cancel
  каждый job в HTTP finally.

## Meaningful проверки Q05

- Настоящий owner RPC issue/list/repeat/conflict/revoke; reviewer/uploader/outsider denied,
  machine не открывает productKeys/workspace/processor и не вызывает review/delete/memberRole.
- Machine native login → productDocuments RPC и HTTP upload/start/poll/result одного CSV;
  exact scoped descriptor/OpenAPI, forged body account/roles rejected; human flow unchanged.
- Foreign org/id/blob/channel-like runId и другой key той же org: upload/start/status/result
  denied, включая repeat requestId другого actor; secret/hash не появляются в views/results.
- Invalid/expired/revoked key при login и retained bearer/resource; неправильный scope
  rejected при выпуске и не становится доступом из прежнего persisted state.
- Barrier tests в upload blob IO, metadata commit, input read, extraction и result read:
  revoke/expiry/close до release, pending rejects; provider, игнорирующий AbortSignal,
  завершается поздно, но не пишет successful table/не выдаёт result. Уже committed state
  проверяется честно отдельно от запрещённой последующей выдачи.
- Retained direct façade после close + настоящий native RPC close; native state/events
  keyframe/repeat не возвращают чужой/отозванный job. Проверять только реально публикуемые surfaces.
- Lost response upload/start → same stable request возвращает прежний id/runId,
  extractor call count остаётся 1; конфликт повторного input rejected, не новый run.
- Restart на тех же secrets/data/port: active keys/logins, revoked/expired denial, hashes-only
  replay; completed job/table/native receipts сохранены, running job uncertain/recovery
  отражён без ложного success и без второго бесконтрольного extraction.
- Owner browser issue/copy/revoke/org-switch/logout; machine terminal outcome/retry;
  реальный Metering Counter не принят этими тестами и остаётся Q06.

Проверки в этом аудите не запускались. Изменений apps/package/lock нет.

Следующее действие: root выбирает минимальный scope и явную семантику durable job cancel,
затем реализуется key authority + machine access перед consumer; targeted negative
RPC/HTTP/barrier/restart матрица, owner UI и итоговый runner/gate только после freeze.

## Внедряемая композиция, следующий независимый design checkpoint

Предлагаемый новый контракт — `productDocuments`, placement authority,
allow `['documents:extract']`, facade `{control: {upload, start, status, result}}`.
Результат open содержит только эту проекцию и close; private native AI connection
не попадает в RPC descriptor. Service machine account остаётся `product:<id>`.
Человеческий `processor` сохраняет allow signedIn и существующий UI-контракт.

Конкретные методы:

| Метод | Вход | Выход |
| --- | --- | --- |
| upload | `{orgId,name,bytes}` RPC; `{orgId,name,base64}` HTTP adapter | `{id,revision}` существующего content-derived upload |
| start | `{orgId,id,revision,processor,requestId}` | `{runId,documentId,state}` native createRun |
| status | `{orgId,id}` | `{id,revision,sourceVersion,status,attempt,processor,rowCount,error}` |
| result | `{orgId,id,revision}` | `{id,revision,sourceVersion,status,table,provenance}` |

Upload dedup уже выводится из `[orgId,account,name,bytes]`; вводить request store для
upload не требуется. `start` сначала проверяет live key/tenant/document, затем вызывает
тот же `connection.fragment.createRun` с kind extract, resourceIds `[id]`, прежним
ProcessingRequest input. Public native createRun проверяет policy.canCreate до поиска
receipt, и сам отклоняет changed input прежнего requestId (установленный ai-run-host.js).
Оставить `repeat` разрешение существующей policy после current document access;
не проверять stale revision перед native повтором уже выполненного start.

Result стоит получать из текущей table/provenance snapshot с revision guard;
не использовать human detail как публичный контракт. Текущий HTTP result вызывает
detail, который дополнительно читает исходник и собирает comments/approvals: эти данные
не нужны machine response. Маленький private snapshot helper может обслужить оба пути;
result не обязуется возвращать исходный файл или утверждённый export.

### Точные места изменений

1. `apps/documents/backend/model.ts`: PRODUCT_SCOPES as const, ProductKey metadata,
   optional productKeys. Existing human ROLES/DocumentItem не расширяются machine role.
2. Новый `backend/product-credentials.ts`: предметная версия accepted Support factory
   с DocumentState и documents:extract. Reuse публичные schemaCommand/buildInputValidate,
   createAsyncQueue, Command.commandReceiptKey, crypto hash/random/timingSafeEqual.
   Owner authorizer передаётся через deps; module не импортирует domain и не создаёт cycle.
   No generic infrastructure extraction до принятия второго consumer.
3. `backend/domain.ts`: сохранить organizationAccess/documentAccess human-only.
   Добавить отдельные processingOrganizationAccess/processingDocumentAccess: machine
   проверяет requireProductKey + org + document.owner, human делегирует прежним helpers.
   Эти helpers применяются только к system documentImport/processingBegin/processingResult
   и processing IO. documentRow/Approve/Reopen/Delete/memberRole остаются на прежних
   human helpers/allow. processingFailure должен уметь записать terminal failure после
   revoke: system-only, active run/attempt guard, без требования отозванного live key.
4. `backend/service.ts`: machine login branch перед human verifySecret; rolesOf machine
   только productRoles(now), human unchanged. Передать один injected now в login/roles/domain;
   сейчас runtime использует global documentsDefinition — заменить композицией
   createDocumentService({now}), чтобы fake clock tests проверяли одинаковую семантику.
5. `backend/processing-resource.ts`: reuse одного host, blobs, filesQueue, runner,
   checkpoint. Вынести внутренний openProcessingConnection(ctx) из нынешнего open;
   он создаёт private native AI connection и существующие control functions.
   Human resource проецирует прежний façade; productResource проецирует только четыре
   метода и их typed validators/current machine ACL. Оба ресурса используют один
   private implementation, не вызывают второй createDocumentProcessing.
   Reuse upload/status/matches/validateTable/persistence. Add local closed/controller,
   current проверки после upload metadata await, processing access в blob authorize/runner,
   expiry deadline и abort pending on revoked current key. Human controls также закрываются
   локально после close; human access остаётся неизменным по смыслу.
6. `backend/runtime.ts`: instantiate credentials + processing + service ровно раз;
   добавить productKeys/productDocuments resources и credentials commands;
   mount register через тот же leader corridor.system + store, close в обратном порядке.
   DocumentExecutor выводить из итогового service/runtime command surface либо сохранить
   processing executor отдельно от credentials register, избегая runtime import cycle.
7. `backend/product-http.ts`: сохранить schemas/OpenAPI/authenticatedArgs/Base64 limits;
   направить четыре метода к той же private product operation/resource с current account,
   signal lifecycle. Доступ human customer по существующему HTTP сценарию можно сохранить
   explicit human delegation; это не даёт machine human façade и не меняет identity.
   Request disconnect отменяет request IO; normal start response не отменяет durable run.
8. `backend/server.ts`: product adapter получает новую точную фабрику/resource;
   mount передаёт keys register из corridor.system. principal из bearer не принимается
   из args. Ни нового HTTP transport, ни отдельного token issuer.
9. `backend/product-check.ts` и новый bounded `backend/machine-check.ts`: сохранить human
   регрессию, добавить native owner/machine RPC + HTTP barriers/expiry/restart; подключить
   в existing test script после freeze. Heavy запуск не выполнялся в этом checkpoint.
10. После backend contract: новый `frontend/product-keys.tsx` + точечный owner-only slot
    в `frontend/main.tsx`, inferred types в `frontend/contracts.ts`, минимальный style.
    За основу UI поведения использовать Support issue/list/copy/revoke, но не копировать
    secret в persistence/browser token storage. Child key session+org, role loss unmount.

### Порядок реализации и проверяемые выходы

- A: credentials state/schema + login/roles/owner resource; meaningful issue/repeat/conflict,
  machine no human permissions, durable hash-only и no-secret replay checks.
- B: processing-specific ACL раньше product consumer; проверить чужой org/второй key того же
  org/чужой document и actor после revoke через system processing commands. Human review
  regression проверяет, что machine branch не проникла в documentAccess.
- C: один product façade и shared HTTP operation; четыре операции, real CSV, upload dedup,
  start native repeat/conflict и extractor count, stale result revision, descriptor surface.
- D: local close + clock + revoke barriers на input blob read/upload/metadata commit/extraction;
  после metadata commit возможна сохранённая сущность, но ответ выдаётся только при current
  ACL. Игнорирующий abort extractor не записывает успешный processingResult.
- E: durable restart завершённого и прерванного job: прежний completed result/receipt,
  interrupted uncertain без второго extraction, ключи active/expired/revoked восстановлены.
- F: owner UI one-time secret/copy/revoke/org switch/logout и terminal product status;
  targeted typecheck/test/build итогового дерева, затем общий gate. Actual Counter остаётся Q06.

Этот checkpoint только проектирует изменения. Source/apps не изменены, команды test/build/CUA
не запускались. Следующий конкретный шаг — согласовать four-method durable job contract:
закрытие RPC/HTTP request завершает его IO/выдачу, а уже accepted job живёт до terminal;
revoke/expiry запрещает новые операции и прекращает processing, публичный cancel требует
явного пятого метода и отдельной приёмки. Затем начать этап A перед B–F.
