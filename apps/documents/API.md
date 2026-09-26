# Papertrail — интерфейсы и устройство

Справочник к [README](README.md): продуктовый HTTP-фасад с OpenAPI, правила доступа и восстановления, отменяемая загрузка, подключаемый порт извлечения, сравнение версий и независимость обработчиков.

## Узкий продуктовый HTTP API и OpenAPI

Authority предоставляет `/api/product/openapi.json` и четыре POST-метода `/api/product/documents/{upload,start,status,result}`. Реализация использует публичные `createHttpFacadeServer`, `createHttpFacadeOpenApi`, `buildInputValidate` и `inputJsonSchema`: одна библиотечная input-схема задаёт серверную проверку и OpenAPI. Нет дублирующего HTTP transport или Zod. Утверждение, удаление и управление пользователями в эту поверхность не входят.

Заголовок `Authorization: Bearer <service-session-token>` использует native сессию, полученную через `/api/documents/login`. Вход поддерживает прежние human credentials и машинные `{account:'product:<id>',password:secret}`. Аккаунт извлекается authority identity и никогда не принимается из args. Middleware принимает ровно один входной объект `{args:[input]}`; все операции заново проверяют текущую организацию/владельца документа. Это ключ Documents с правом `documents:extract`, отдельный от ключей Metering.

| Метод | input |
| --- | --- |
| upload | `{orgId,name,base64}`; canonical Base64, decoded 1..512КиБ, CSV/TXT/PDF |
| start | `{orgId,id,revision,processor:'node'|'python'|'model',requestId}` |
| status | `{orgId,id}` → метаданные текущей попытки/версии, без исходных байтов |
| result | `{orgId,id,revision}` → table/provenance текущей разрешённой версии |

Успех `{ok:true,value}`, ошибки используют библиотечный envelope; отсутствие/невалидность сессии даёт401. Для start повторите прежний requestId с прежним содержанием после потерянного ответа; AI run не создаётся повторно. Upload имеет существующую дедупликацию файла. Утверждение новой таблицы остаётся отдельным действием reviewer через сервисный фасад; HTTP result не означает, что извлечение проверено человеком.

## Машинный ресурс и ключи организации

Владелец открывает native ресурс `productKeys`. Его `control.issue({orgId,label,days,scopes:['documents:extract'],requestId})` возвращает `{id,account,secret,expiresAt}`. Срок 1–90 дней, до 100 сохранённых ключей включая отозванные. Secret показывается один раз, в состоянии и native command journal остаётся только SHA-256 hash. Повтор выпуска с прежним requestId/полями возвращает прежний id и `secret:null`; потерянный secret следует заменить новым ключом. `control.list({orgId})` не возвращает hashes, `control.revoke({orgId,id})` отзывает конкретный ключ. Текущий owner этой организации проверяется перед native system receipt и после ответа: роль owner в другой организации не разрешает управление этим ключом.

Machine principal не создаётся в accounts/members и получает только `documents:extract`. Через native RPC ему доступен только `productDocuments.control.{upload,start,status,result}`. RPC upload принимает `{orgId,name,bytes:Uint8Array}`, остальные входы совпадают с HTTP. Workspace, processor/raw AI, human review/admin и owner keys недоступны. Ключ читает только созданные им документы своей организации, другой ключ той же организации не наследует доступ. Human reviewer/owner сохраняют прежние правила проверки документов организации.

Клиент сохраняет requestId и неизменное содержимое start до получения ответа и повторяет именно этот вход. Приложение копирует/фиксирует вход перед async границами, native AI checkpoint хранит исходный request и receipts. Задание ограничено десятью секундами, продуктовый IO — двенадцатью. Local signal/closed, текущий ключ и возвращённый target проверяются на границах IO. Отмена HTTP-запроса либо закрытие RPC-ресурса отменяет незавершённую загрузку, но уже принятый durable start продолжает работу.

Отзыв ключа или наступление expiresAt прерывает его выполняющееся задание независимо от открытого HTTP/RPC ресурса. Late executor result не сохраняет таблицу. Терминальный сбой отзыва/expiry имеет state `failed`; обычное resource.close не означает `cancelled`. Private job authority отделена от credential ACL: машинная native AI connection не выдаётся наружу, её persisted owner/tenant/document привязка позволяет восстановлению завершить старый run после expiry/revoke. Human policy сохраняет прежнюю текущую membership ACL. One-use policy permit, второй журнал работ и собственные receipts не используются.

После аварийного рестарта метаданные незавершённого документа становятся `uncertain`, native recovery — terminal `failed`, без повторного запуска executor. Если таблица уже зафиксирована основной записью, native recovery отмечает run completed. Ошибка recovery сохраняет rejected readiness и блокирует операции, а не маскируется как готовность. Это две записи с явным reconciliation, не единая транзакция.

`npm run test:machine` проверяет native RPC/HTTP login и четыре метода, hash-only keys, scoped permissions, retry payload, resource/context close, live revoke/expiry, поздний executor, ответ upload после отзыва, cleanup и восстановление. Эти проверки добавлены в общий `npm test`; факт runtime приёмки фиксируется отдельным отчётом.

Рабочий пример без секретов в исходнике (Node22+, токен уже в окружении):

```js
const origin = process.env.DOCUMENT_URL ?? 'http://127.0.0.1:3811'
const headers = {'content-type': 'application/json', authorization: 'Bearer ' + process.env.DOCUMENT_TOKEN}
async function call(method, input) {
    const response = await fetch(origin + '/api/product/documents/' + method, {
        method: 'POST', headers, body: JSON.stringify({args: [input]})
    })
    const body = await response.json()
    if (!body.ok) throw new Error(body.error?.message ?? 'Request failed')
    return body.value
}
const file = await call('upload', {orgId: 'northstar', name: 'example.csv', base64: Buffer.from('name,amount\nExample,42').toString('base64')})
const job = await call('start', {orgId: 'northstar', id: file.id, revision: file.revision, processor: 'node', requestId: crypto.randomUUID()})
const status = await call('status', {orgId: 'northstar', id: file.id})
// Если status.status == 'review' или 'approved', прочитайте result с status.revision.
```

Маршруты не кешируют данные (`no-store`) и существуют только на authority origin. Serving nodes возвращают404 для этой дополнительной HTTP-поверхности; библиотечный SC1 processor resource остаётся доступен через обычную топологию. `product-check.ts` входит в `npm test`: реальный login/HTTP extraction, OpenAPI surface, spoofed args, base64/size, tenant privacy, upload/run repeats, revision и live revoke. `test:advanced` отдельно требует DOCUMENT_PYTHON и сохраняется в standalone копии. Новые исходники явно внесены в scaffold manifest.

## Данные, права и восстановление

У загрузчика видны только собственные документы организации, у проверяющего/владельца — документы своей организации. Команды повторно проверяют текущие права и ревизию; старое подключение не даёт сохранить доступ после отзыва роли. Внутренние команды `documentImport` и `processing*` разрешены только системной части сервиса, недоступной обычному сетевому пользователю.

В общей подписке находятся только сведения о документе. Таблица, комментарии и исходный файл читаются отдельным вызовом с актуальной проверкой доступа. Состояние AI-запуска содержит только признак готовности результата, без таблиц и исходных байтов. Конкретный результат привязан к текущему документу и попытке; поздний результат отменённой попытки не перезаписывает повторный запуск.

После рестарта незавершённый документ получает состояние `uncertain`. Приложение не воспроизводит обработку автоматически: разрешена новая явная попытка. Если таблица уже была подтверждена основной записью до сбоя AI-checkpoint, восстановление отмечает запуск завершённым. Отдельные журналы AI и метаданных не выдаются за единую распределённую транзакцию.

При удалении содержимое немедленно исчезает из разрешённых представлений. Невостребованные байты удаляются последовательно; общий blob сохраняется, пока существует другой доступный документ с теми же байтами. После рестарта проводится очистка неприкреплённых файлов.

## Дополнения D02/D05/D06/D07

### Отмена загрузки

UI начинает операцию через `processor.control.beginUpload(orgId)` и передаёт полученный `uploadId` в обычный `upload({orgId,name,bytes,uploadId})`. `cancelUpload(uploadId)` принадлежит только этому открытому ресурсу/аккаунту и заново проверяет организацию. Отмена останавливает очередь и байтовый IO до записи метаданных; cleanup сохраняет общие востребованные blobs. Закрытие ресурса также отменяет незавершённые загрузки. Прочитанные браузером байты уже могли покинуть память браузера: отмена не является стиранием сети.

Если метаданные уже записываются, ответ `committing` честно сообщает, что граница отмены пройдена; `completed` означает существующий документ. UI не обещает отмену уже сохранённого файла. Тогда удалить документ можно отдельной обычной командой. До восьми незавершённых transfer tokens на ресурс, срок ожидания60сек; окончательные tokens удаляются при следующем begin. Прежний upload без uploadId сохранён для программных потребителей, отмена ему доступна закрытием ресурса.

### Подключаемый OCR/модельный порт

`ExtractionProvider.extract({name,bytes,sourceVersion,signal})` в `backend/model-extraction.ts` возвращает `{table,fields,provider,demo}`. Каждому полю таблицы соответствует `{row,column,page,line,quote}`: ссылка на страницу либо строку исходника и цитата. Проверяются диапазоны, уникальность/полнота источников, тип и размер результата. Authority дополнительно проверяет sourceVersion и текущую попытку. Происхождение не является гарантией правильности модели: человек сверяет цитаты с оригиналом.

Передайте `extractor` в `createDocumentRuntime` либо `createDocumentProcessor`; выбор `processor:'model'` использует этот порт, сохраняя прежние UI/AI lifecycle/команды проверки. По умолчанию `createTestExtractionProvider` разбирает только TXT со строками «Поле: значение». Это детерминированный локальный fixture, **не OCR и не языковая модель**, без внешних вызовов. Другой локальный fake OCR fixture в advanced-check принимает PDF и доказывает заменяемость порта/привязку версии, а не качество распознавания скана.

Происхождение хранится в document.provenance и неизменной утверждённой копии, читается вместе с detail, включено в JSON-экспорт утверждённой версии. Оно не передаётся со всем workspace. После ручной правки цитата остаётся свидетельством исходного извлечения; UI прямо предлагает сравнить с ней изменённое значение. Старые сохранённые документы без provenance читаются как раньше.

### Сравнение версий

Вкладка «Сравнить версии» выбирает сохранённую утверждённую revision, показывает её ячейки рядом с текущими и выделяет изменения/отсутствующие ячейки. `processor.control.compare({orgId,id,revision,approvedRevision})` требует свежую текущую revision и ACL, возвращает только две проверенные таблицы и метаданные утверждения. Этот вызов не изменяет документ. Утверждённая таблица и её provenance не меняются после reopen/исправлений. Отдельная история comments сохраняется.

### Реальная независимость обработчиков

`npm run test:advanced` требует заданный DOCUMENT_PYTHON и не делает вид, что Python проверен без него. В тесте одновременно запущены настоящий Node PDF и Python CSV, подтверждены разные живые PID и два processing документа. Маленький test-only processFactory задерживает доставку уже вычисленных настоящими дочерними процессами результатов, чтобы детерминированно проверить отмену. Отмена Node завершает только его процесс; Python остаётся живым и принимает собственный результат. Поздний результат Node не превращает отменённый документ в review. Затем оба процесса закрыты.

Это два независимых дочерних исполнителя одного authority, не удалённый кластер worker-серверов. Публичный createProcessResource владеет запуском/отменой/закрытием, createAiRunHost — попытками. Основной `npm test` дополнительно проверяет ошибки пакета, поздние ответы, тайм-аут, рестарт, роли, файлы и настоящую authority/serving топологию. Docker-результаты выше относятся к предыдущим образам до этих дополнений; новый образ требует отдельной повторной приёмки.
