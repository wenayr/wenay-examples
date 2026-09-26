# Q05: Documents machine API

26 сентября 2026. ORIGINAL checkout, codex/library-upgrade-20260926.
Точные опубликованные зависимости: wenay-common2 3.1.1 / wenay-react2 5.0.0.
Backend/API targeted runtime и полный Documents type/test/build runner прошли.
Этот отчёт не принимает Q06 Counter, owner UI Q08 или весь репозиторий.

## Рабочий контракт

Владелец организации открывает native authority resource `productKeys`:

| Метод | Вход | Результат |
| --- | --- | --- |
| control.issue | {requestId,orgId,label,scopes:['documents:extract'],days} | {id,account:'product:<id>',secret,expiresAt} |
| control.list | {orgId} | Только metadata ключей этой организации, без hash/secret |
| control.revoke | {orgId,id} | {id} конкретного отозванного ключа |

Срок 1–90 дней, label до 100 символов, до 100 сохранённых ключей включая expired/revoked.
Secret — random 32 bytes/base64url, выдаётся один раз; state/native registration journal
содержит SHA-256 hash. Повтор issue requestId с исходным содержимым возвращает прежние
id/account/expiresAt и `secret:null`; конфликт содержимого отклоняется. Потерянный secret
требует нового выпуска, а не восстановления исходного секрета из журнала.

Machine login использует existing native `/api/documents/login`:
{account:'product:<id>',password:secret}. Native identity/token сохраняются; своего auth
transport/JWT нет. Ключ получает только `documents:extract`; accounts/human members
не пополняются. В descriptor/runtime доступны только `productDocuments` для машины:
workspace, human processor/raw AI, review/admin и owner resource ей не разрешены.

Native `productDocuments.control` имеет четыре операции. HTTP authority маршруты
`POST /api/product/documents/{upload,start,status,result}` вызывают те же операции.
Bearer identity задаёт account; запрос содержит ровно `{args:[input]}`, без account/org
credential spoofing. Схемы public buildInputValidate/inputJsonSchema задают validation
и OpenAPI `/api/product/openapi.json`; второго HTTP транспорта нет.

| Метод | Вход RPC / отличие HTTP | Выход |
| --- | --- | --- |
| upload | {orgId,name,bytes:Uint8Array}; HTTP canonical base64 вместо bytes | {id,revision} |
| start | {orgId,id,revision,processor:'node'|'python'|'model',requestId} | {runId,documentId,state} |
| status | {orgId,id} | {id,revision,sourceVersion,status,attempt,processor,rowCount,error,runId,runState} |
| result | {orgId,id,revision} | {id,revision,sourceVersion,status,table:{headers,rows},provenance:null|object} |

Upload: UTF-8 CSV/TXT либо PDF, 1 byte–512 KiB, имя до 160 символов. Dedup использует
existing content/name/org/account identity; metadata import возвращается только после
актуальной проверки returned id/owner/blob. Result — копия разрешённой текущей таблицы/
provenance, без source bytes/blob metadata/comments/approvals. Machine ключ видит только
свои документы своей организации; другой ключ той же организации не наследует доступ.
Human reviewer/owner сохраняют прежние права документов организации.

## Current access и durable job authority

Owner issue/list/revoke проверяют текущего owner **конкретной организации**, а не наличие
owner где-либо. Native registration/revoke commands разрешены только system; внешним
boundary служит owner resource, с проверкой до native receipt и после await/returned target.
Mount epoch и captured store/executor не дают старому facade ожить при remount, stale
disposer не очищает новый mount. Closed/context AbortSignal также закрывают операцию.

Product операции копируют вход до async границы; start/issue payload фиксируется.
Current key scope/tenant/expiry/revoked и document owner проверяются до IO и после await.
До native createRun проверяется credential, после — returned run owner/target. Consumer
сохраняет requestId и исходный start payload для retry; native AI checkpoint сохраняет
request/receipt. Новый requestId — новая явная попытка, не способ скрыто повторить работу.

Внутренний createAiRunHost/connection остаётся единственным processing runtime. Для
machine job его policy использует persisted key-owner/tenant/document привязку, отдельно
от live credential ACL. Эта private native connection не выдаётся машине; внешний ресурс
содержит только четыре guarded метода. Recovery может terminal settle старого run после
expiry/revoke, а новая внешняя операция/выдача по этому ключу запрещены. One-use policy
ordering permit из feasibility fixture **не используется в production**.

Running job имеет собственный controller/10s deadline, независимый от consumer resource.
Store hook прерывает работу после revoke; key expiry timer действует без новой записи
или открытого HTTP клиента. Поздний executor response не сохраняет результат. Resource
expiry корректно учитывает Node timer ceiling для 90-дневных ключей.

Обычное закрытие HTTP response/RPC resource прекращает pending upload/выдачу, но не
accepted durable job. HTTP request IO ограничен 12s: outer Promise.race с локальным
AbortSignal возвращает ошибку даже при продолжающемся внутреннем await; finally убирает
listener и закрывает IO-resource. AsyncLocalStorage переносит lifetime только как
локальную серверную metadata, не через RPC/HTTP argument codec. Уже committed metadata
не выдаётся как успешный ответ после timeout и не откатывается вымышленной отменой.

Revoke/expiry job terminal — `failed`, не `cancelled` лишь из-за закрытия consumer.
Authority shutdown оставляет unfinished checkpoint для existing recovery. При рестарте
processing metadata становится `uncertain`, native recovery terminal `failed`, executor
не воспроизводится. Если processingResult уже подтверждён, recovery отмечает completed.
Reject readiness остаётся отказом операций, а не скрытым ready. Metadata journal и AI
checkpoint — две записи с reconciliation, без заявления об общей транзакции.

## Фактические проверки

- Третий последовательный root `npm run test:machine`: **PASS, exit 0**.
- Реальный native owner RPC issue/list/repeat/conflict/tenant, hash-only state, scope,
  machine login, no human memberships/views/commands; forbidden processor/productKeys
  native resource и отсутствующие review/raw AI RPC пути отклоняются.
- Четыре реальные RPC/HTTP операции, binary/base64 upload, own-document/tenant isolation,
  native start receipt/frozen payload conflict, repeated start без второй работы.
- Executor barriers: ordinary RPC/HTTP close сохраняет accepted job; revoke и timer expiry
  abort его, late result не заполняет table. Context abort/direct closed facade отказывают.
- Native metadata post-import barrier + revoke не выдаёт late upload result. Unreferenced
  blob cleanup после удаления прошёл через существующий storage/cleanup.
- Настоящий ~12s HTTP post-import deadline: error/no value до release, committed metadata
  сохраняется, следующий queued upload после release подтверждает finally/queue cleanup.
- Durable restart с expired product key: login запрещён, document uncertain, actual native
  checkpoint failed/no pending recovery, executor counter не растёт. Active key/issue repeat/
  completed start receipt сохраняются; old facade/remount/stale disposer checks PASS.
- Fresh genuinely granted owner session понижает прежнего owner; retained owner resource
  повторно отказывает перед прежним native revoke receipt. Permission не ослаблялась.
- Автор: Documents typecheck PASS, style 34 files/0, targeted diffcheck PASS. Heavy tests
  запускал root последовательно. Root полный Documents type/test/build: **3/3 PASS**,
  exit 0, соответственно 0.663 / 41.727 / 1.699 с. DOCUMENT_PYTHON указывал на реальный
  Python 3.14.7: `C:\Users\wenay\AppData\Local\Python\pythoncore-3.14-64\python.exe`.
  npm test включает domain/check/product/machine/backup: существующие human processing/
  review/export, authority+два serving процесса/failover/restart, human HTTP и backup
  прошли; machine-check повторно PASS. Отдельный `test:advanced` этим runner не запускался.
- После runner root отдельно выполнил `npm run test:advanced`: **PASS, exit 0, 2.876 с**,
  тот же реальный Python 3.14.7. Проверены cancellable upload/private transfer token,
  field/source version и immutable comparison; два настоящих Node/Python PID одновременно,
  cancel Node при продолжающемся Python, поздний результат Node не принят. Это отдельный
  actual запуск, не предположение о составе npm test и не paid extraction.

Фактические заголовки root логов final frozen source прогона:

```text
documents-typecheck.log: code=0 status=ok seconds=0.663 at=2026-09-26T18:44:39.611Z
documents-test.log:      code=0 status=ok seconds=41.727 at=2026-09-26T18:45:21.340Z
documents-build.log:     code=0 status=ok seconds=1.699 at=2026-09-26T18:45:23.040Z
fingerprint=8e00cc190d487d61fde40e6155dd0ea3026c858a924b4caa84b7cb3fd3b92e4b
```

Заголовки прочитаны из `work/run-all/documents-{typecheck,test,build}.log`; fingerprint
общий для трёх runner шагов, source после targeted fixes оставлен frozen. Точные строки:
`PASS Documents machine RPC/HTTP: scoped identity, hash-only keys, four methods, receipts,
close/revoke/expiry, 12s deadline, cleanup and restart` и human topology PASS (7115 ms).
Build output предупреждает о chunk >500 kB и outDir; это успешная сборка, не новая
приёмка bundle optimization. Отдельный advanced подтверждён последующим root запуском;
свежий Docker image/live Q05 gate ожидает отдельного результата root.

Тест учитывает два native contract свойства: RPC path proxy не перечисляет методы через
Object.keys, а command facade pruned при создании сессии; после нового owner grant нужен
новый owner login, чтобы получить ранее отсутствовавшую command. Это свойства public
API, а не production permission workaround. Первые fixture отказы исправлены, факт PASS
выше относится к третьему фактически выполненному прогону.

## Границы приёмки

Human raw AI canRead/canWrite по-прежнему owner-only, как до Q05. Текущий document
membership проверяется человеческими document IO/processing paths, но строгая live ACL
для всей human AI history/replay и прямого retained raw AI facade после close не заявлена.
Открытые common2 AI-POLICY-INVALIDATION/AI-RESOURCE-LIFECYCLE ограничения не объявляются
исправленными этим machine boundary. Machine raw AI вообще не доступен.

Q05 не вводит actual Counter acceptance: machine fixture использует локальный deterministic
CSV executor, без paid provider. Существующий Metering adapter/ledger не заменён fake
counter, но Q06 real machine reserve/receipt/uncertain/restart и product receipt linkage
должны быть проверены отдельно. Известный negative native REST login может вернуть
HTTP500 с body.ok=false; это наблюдавшийся refusal, не успешный login и не новая ошибка Q05.

Owner keys UI не добавлен: управление доступно native API. Browser Q08 и live image gate
нового Q05 не заявляются. Общий root check:all/merge/main также не принят этим отчётом.

## Точный набор файлов этапа

Q05 source/docs, без vite/Q08 изменений:

```text
apps/documents/backend/product-credentials.ts
apps/documents/backend/machine-check.ts
apps/documents/backend/model.ts
apps/documents/backend/domain.ts
apps/documents/backend/service.ts
apps/documents/backend/runtime.ts
apps/documents/backend/processing-resource.ts
apps/documents/backend/product-http.ts
apps/documents/backend/server.ts
apps/documents/backend/product-check.ts
apps/documents/frontend/contracts.ts
apps/hosting/backend/documents-live-check.ts
apps/documents/package.json
apps/documents/scaffold.json
apps/documents/API.md
apps/documents/README.md
doc/changes/documents-machine-q05-20260926.md
```

Две frontend/cross-app правки только специализируют inferred resources.open<'processor'>
после появления нескольких ресурсов; UI behavior не меняют. Progress task
`doc/progress/documents-product-api.md` временный, до завершения root gate. Vite,
Q08/UI, shared canonical, locks, root plan/STATUS и Q06 audit не входят в Q05 source set.
