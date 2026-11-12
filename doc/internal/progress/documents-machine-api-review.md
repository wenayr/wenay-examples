# Q05 — проверка реализуемости машинного API Documents

26 сентября 2026. Read-only review исходного checkout и установленного common2 3.1.1.
Прочитан documents-machine-api-audit.md, Documents processing/domain/runtime/HTTP/checkpoint,
accepted Support credentials/runtime/product search. Apps, package, scripts и tests не изменены;
runtime проверки не запускались. Это архитектурная проверка, не PASS Q05.

## Вывод

Четыре операции productDocuments поверх одного существующего processing host реализуемы.
Машинный account product:<id>, hash-only keys, отдельная processing ACL, private native AI
connection и native createRun/receipt подходят. Перед реализацией нужны следующие уточнения:
отмена после revoke не равна ordinary resource close; trusted terminal reconciliation не может
безусловно пользоваться отозванным consumer ACL; native service command receipts не повторяют
domain apply. Публичный raw AI API машине не нужен.

## Обязательные поправки плана

1. **Не наследовать Support lifecycle без дополнения.** Support productKeys.resource.close
   и productSearch.close пустые; их direct in-process façade не получает автоматический local
   closed flag. Native RPC resource scope прикрывает закрытие транспорта, но HTTP открывает
   ресурс напрямую. Q05 credential issue/list и product upload/start/status/result требуют
   собственного closed/controller, проверки при dequeue и перед/после каждого await. Queue
   нельзя считать авторизацией. Register после commit может уже создать key, но secret после
   close/owner loss не выдаётся; retry возвращает secret:null. Дескрипторы native replay/Listen
   сохраняются, если human raw AI reader также ограждается; обычный spread теряет nonenumerable
   branding. Для machine четыре метода исключают replay surfaces из публичного façade вовсе.

2. **Разделить три владельца отмены.** Request/resource controller принадлежит временному
   RPC/HTTP consumer и прекращает upload/read/выдачу ответа. Job controller принадлежит одному
   native run и не связан с успешным HTTP finally или poll resource close. Authority shutdown
   прекращает server work и оставляет честный native recovery checkpoint. Native
   host.connection(account).close() закрывает только connection view, не cancelRun;
   host.close() отменяет provider work всего host. Нельзя использовать ни один из них как
   синоним revoke конкретного ключа. Все consumers данного key после revoke/expiry получают
   отказ, а pending extraction abort-ится независимо от того, существует ли сейчас consumer.

3. **Не обещать native cancelled без проверенного пути.** AiRunRunner context содержит
   cancelled(), но не AbortSignal: Documents уже создаёт job controller самостоятельно.
   Отказ runner после abort естественно приводит native run в failed; это допустимая
   терминальная семантика, если document processingFailure тоже failed. Если требуется именно
   cancelled, connection.fragment.cancelRun использует requireRun/canRead/canWrite и после
   live-key revoke уже может быть запрещён. Не обходить это машинным bearer и не писать
   host.store.state вручную. Минимальный вариант Q05: revoke/expiry → abort job → failed,
   без публичного cancel endpoint; explicitly document это. Queued run, ещё не начавший
   processingBegin, тоже проверяет key до работы и завершается native failed; document может
   остаться uploaded, что не является успешным processing.

4. **Restart revoked/expired recovery — реальный ACL конфликт.** Native recovery.settle
   вызывает requireRecovery, который повторяет policy.canWrite(run.owner,run) И
   policy.canCreate(run.owner,persistedRequest). Просто добавить live key в эти policy и
   сохранить существующий recovery loop нельзя: expired/revoked key блокирует settle,
   mount.ready отклоняется, а остальные документы могут перестать обслуживаться. Выбрать
   заранее: узкая trusted reconciliation authorization в private host policy, доступная
   только во время синхронного server recovery.settle конкретного run (try/finally), без
   исполнения extractor и без consumer доступа; либо документировать library blocker для
   trusted terminal settle. Consumer wrapper всё равно проверяет live key до native retry
   и после результата. Не ослаблять policy глобально и не выдавать машине raw connection.
   Recovery никогда не возобновляет extraction автоматически.

5. **Service command receipt ACL не исправляется checks внутри apply.** Native commandHost
   execute возвращает previous receipt до schema/validate/apply. System processingBegin,
   processingResult и documentImport поэтому требуют current processing ACL в orchestrator
   перед вызовом и после await; domain apply остаётся второй защитой первого исполнения.
   После processingResult await повторить job signal/current key до native runner success.
   Уже committed result не откатывается, но late success/output после revoke не выдаётся.
   Копирование Support productKeyRevoke с allow owner оставляет тот же exact-tenant retry
   риск: владелец другой org может получить old receipt после потери owner нужной org.
   Native REST corridor также возвращает receipt до domain allow. Для Q05 не объявлять
   этот путь принятым: revoke через guarded owner resource + native system command, либо
   уже опубликованное исправление SERVICE-COMMAND-RECEIPT-ACL. HTTP продуктовые четыре
   операции должны вызывать guarded product resource, не service command REST corridor.

6. **Expiry — не Store event и не окончание consumer signal.** now() должен быть единым
   для login/roles/key guard/system processing ACL/runner/recovery. Нужен отдельный job
   deadline expiresAt с явной очисткой timer и abort pending на key revoke/store changes;
   проверки current key после blob read, processingBegin, extraction, usage settlement и
   processingResult обязательны. Roles permissions могут оставаться устаревшими без store
   изменения, поэтому они не заменяют method guard. Fake now скачок сам не запускает
   setTimeout: тестируемый deadline scheduler/tick либо реальная короткая barrier deadline
   нужен для доказательства прерывания заблокированного extractor, а не только нового отказа
   на следующем status(). Не обещать provider rollback при игнорировании AbortSignal;
   Promise.race и post-await checks запрещают late commit/выдачу, сам provider может закончиться.

7. **Native start conflict зависит от persistence.** В ai-run-host createRun порядок
   canCreate → request receipt → compareDeepValues → canRead действительно подтверждён.
   Но compareDeepValues исполняется только при deps.persistence || deps.initial. Documents
   openAiCheckpoint без directory возвращает {}, поэтому неперсистентный runtime не
   гарантирует changed-input conflict. Q05 durable runtime/тесты обязаны иметь directory
   и native checkpoint; либо публичный initial checkpoint даже для ephemeral fixture.
   Не вводить второй receipt map. Retry проверяет current document/key до createRun,
   допускает прежнюю revision только для native того же requestId; changed target/input
   отклоняет сам host. Upload является content-derived idempotency, а не requestId receipt:
   HTTP caller повторяет те же нормализованное имя и bytes; изменение содержимого создаёт
   другой документ и не является конфликтом start requestId.

## Минимальный скорректированный контракт

- Одна processing factory, один AiRunHost/checkpoint, один blob storage/files queue.
  Human resource сохраняет свой контракт и human-only review/domain проверки.
  Product resource публикует только control.upload/start/status/result с typed schemas.
- Processing ACL отдельно от human membership: key текущий, scope ровно documents:extract,
  organization существует, document.owner равен полному product:<id> account. Второй key
  той же org не читает чужие file/job/result и не повторяет его native request receipt.
- status/result — copied minimal document snapshot. Result требует current revision;
  human detail/download/comments/approvals/blobId не входят в machine API.
- Успешный start сохраняет run до ответа. Resource close/disconnect прекращает request IO
  и выдачу, но accepted durable job продолжает работать. Revoke/expiry прекращает job с
  failed outcome; interrupted restart — uncertain document и native failed reconciliation,
  completed document/run остаются committed, повторная выдача требует current key.
- Owner issue/list/revoke также проходят guarded resource lifecycle/current org owner,
  system commands не являются публичным machine/user способом администрирования.

## Дополнения к acceptance до source changes

Barrier отдельно перед dequeue, после processingBegin и после processingResult commit;
revoke/expiry при отсутствующем consumer; ordinary close после accepted start не прекращает
job; restart с revoked/expired running run не ломает readiness других keys/documents;
same requestId другой tenant/key и owner loss retry ключевой команды; durable changed-input
start conflict; прямой façade close для keys и четырёх операций отдельно от RPC scope.
Проверять native run state и document status как две согласованные, но разные поверхности,
а не считать uploaded + failed run успешным либо требовать несуществующий rollback.

Следующее действие: root уточняет failed семантику revoke/expiry и trusted recovery policy,
закрывает receipt ACL путь owner revoke, затем начинает credentials/ACL primitive.
Общий machine-key helper пока не выделять: Support остается reference composition,
а принятие второго consumer требует собственных IO/job/recovery доказательств.
