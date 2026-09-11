# Content Studio · редакция и публикации

Самостоятельная небольшая студия на exact `wenay-common2 2.21.1` / `wenay-react2 3.5.1`. Пять типов блоков: heading/text/image/quote/button, без произвольного HTML, скриптов и универсального no-code. Authority владеет изменениями, snapshots, расписанием и файлами; serving nodes обслуживают ролевые проекции и библиотечные соединения.

## Запуск и роли

```text
npm ci
npm run typecheck
npm test
npm run build
npm start
```

Сервер `http://127.0.0.1:3817`, данные `content-data`. Переменные: SERVICE_PORT, SERVICE_HOST, SERVICE_DATA_DIR, SERVICE_TOKEN_SECRET, SERVICE_NODE_TOKEN, APP_RELEASE. Секреты стабильны и независимы, .env не загружается автоматически. Пока интерфейс создаётся отдельной задачей, backend-проверки не означают готовность build/frontend.

| Аккаунт | Пароль | Доступ Northstar |
| --- | --- | --- |
| owner | owner-pass | Все операции и роли |
| author | author-pass | Свои черновики, изображения, отправка на review |
| editor | editor-pass | Черновики организации, замечания и согласование |
| publisher | publisher-pass | Чтение редакторских версий, публикация/расписание/откат |
| reader | reader-pass | Публичные материалы, без draft/review/assets workspace |
| outsider | outsider-pass | Владелец Harbor, без редакторского доступа к Northstar |

Demo accounts предназначены для приёмки; внешняя регистрация не подключена. В Northstar исходная страница `welcome` ещё не опубликована.

## Контракт редактора

`ContentDefinition` выводится из `createContentRuntime` (`backend/runtime.ts`), `ContentWorkspace` — `contentWorkspace` (`domain.ts`). `workspace` содержит `{account,organizations,people,pages,assets,audit}`. Reader не получает редакторские страницы/активы/аудит. Author может править только собственные страницы, publisher не может присвоить себе право editor. Полные типы в `model.ts`.

Page: `{id,orgId,author,revision,draftRevision,draft,snapshots,reviews,comments,publications,schedules,publishedVersion,publicationRevision,createdAt,updatedAt}`. Draft: `{title,slug,blocks}`. Block: `{id,kind,text,assetId,href}`; поля неиспользуемого вида — пустые строки. Для image text — обязательный alt; для button href — полный HTTPS URL без credentials. Текст показывается как текст, не HTML.

| Команда | Вход |
| --- | --- |
| pageSave | `{orgId,id,revision,title,slug,blocks}`; новый id:'' revision:0 |
| reviewSubmit | `{orgId,id,revision}` → `{id,revision,version,fresh}` |
| reviewDecide | `{orgId,id,revision,version,decision:'approved'|'changes',body}` |
| commentAdd | `{orgId,id,version,blockId,body}`; blockId:'' для всей версии |
| pagePublish / pageRollback | `{orgId,id,revision,version,key}` |
| pageWithdraw | `{orgId,id,revision,key}` |
| scheduleCreate | `{orgId,id,revision,version,key,dueAt}` UTC ms, следующие 90 дней |
| scheduleCancel | `{orgId,id,revision,scheduleId}` |
| assetDescribe | `{orgId,id,revision,alt}` |
| memberRole | `{orgId,account,role:'owner'|'author'|'editor'|'publisher'|'reader'|'revoked'}`; owner only |

Изменения page increment revision, редактирование текста дополнительно increment draftRevision. ReviewSubmit создаёт immutable snapshot `{...draft,version,draftRevision,createdAt,author}`; повтор того же draftRevision возвращает тот же snapshot. Решение привязано к snapshot.version и текущему draftRevision. Комментарии относятся к конкретной версии/блоку и не меняют опубликованный текст.

Publish требует publisher/owner и последнего approved решения для текущего draftRevision. Редактирование отменяет pending расписание. Schedule сохраняется до исполнения `createReconciler`, который повторно проверяет роль создавшего издателя, approval, revision и уникальный опубликованный slug. Отмена/изменение прав/ошибка адреса не публикуют документ. Идентификатор задания становится идентификатором публикации, terminal status исключает двойное исполнение после рестарта. Rollback создаёт новую запись истории, указывает ранее опубликованный approved snapshot и не изменяет нынешний черновик.

Ключ `key` — устойчивое прикладное намерение, отдельное от command requestId. Повтор с новым transport requestId возвращает первоначальную квитанцию с `fresh:false`; другое содержание старого key отклоняется. Текущее состояние читают заново. Transport-repeat воспроизводит исходную квитанцию библиотеки.

## Публичный фасад и согласованность

`resources.open('published')` доступен любому существующему аккаунту, включая reader. Authority resource:

```ts
published.control.list(orgId)
// [{id,orgId,slug,title,version,publicationRevision}]
published.control.read({orgId,slug})
// {id,orgId,version,publicationRevision,title,slug,blocks,publishedAt}
```

Материалы публичны независимо от членства читателя. Фасад никогда не возвращает draft/snapshots/reviews/comments/schedules, аккаунты или внутренний аудит. После снятия read отказывает. Это поверхность для подключения базы знаний поддержки через reader credentials и общий common2 client. Интеграция необязательна; Content работает самостоятельно. Минимальный type-only `published-contract.ts` скопирован потребителю, а authority проверяет реальную реализацию через `satisfies PublishedFacade`.

Анонимный HTTP использует тот же published-only authority read:

- GET `/api/content/public/:orgId` — список;
- GET `/api/content/public/:orgId/:slug` — статья;
- GET `/api/content/public/:orgId/images/:assetId` — только изображение, используемое текущей публичной страницей.

HTTP `Cache-Control:no-store`, `nosniff`, no-referrer. Serving node передаёт эти чтения authority; при offline возвращает 503, а не локальную старую публикацию. Чтение после подтверждённого withdraw не возвращает снятую статью. Уже отправленные до withdraw байты и копии в памяти пользователя удалить невозможно. Публичный service view `published` обслуживается репликами и является eventual снимком для UI; при offline нельзя трактовать ранее полученный store как актуальный public read. Строгую проверку существования делайте через authority resource/HTTP.

## Изображения

`files.control.upload({orgId,name,bytes:Uint8Array})` → Asset; `download({orgId,id})` → `{bytes,mime,name}`; `remove({orgId,id})` удаляет только неиспользуемое изображение; описание меняется командой assetDescribe. Workspace содержит разрешённые метаданные. PNG/JPEG/WebP до 512 КиБ проверяются по сигнатуре; SVG/HTML не допускаются. Это не полноценный декодер, антивирус или проверка всех структур изображения. Внешние URL изображений не загружаются сервером.

Используется публичный createLocalBlobStorage. SHA256 проверяется при чтении; одинаковые байты внутри организации дают один asset. Каталог организации отделяет такие же байты другой организации. ACL проверяется до и после upload/read IO. Удаление сначала сохраняет tombstone и запрещает новые ссылки, затем удаляет байты; конкурирующие upload/remove того же asset блокируются. Любой draft или immutable snapshot удерживает свой asset, даже если снимок ещё не опубликован. Непубликованный asset не выдаётся анонимному читателю. Незавершённый upload при сбое между сохранением файла и metadata может оставить недоступные orphan bytes; общая crash-sweep очистка отсутствует и не должна удалять файлы по одному отсутствию в текущем draft.

## Предложения текста

`assistant.ai.createRun({requestId,kind:'edit',resourceIds:[id],input:{orgId,id,revision,blockId,instruction}})`. `assistant.control.source({orgId,id,revision,blockId})` проверяет актуальный текстовый блок; `result(runId)` возвращает `{orgId,id,revision,title,blockId,kind,before,after,demo,requiresConfirmation:true}` после свежей проверки авторства/роли/revision.

По умолчанию явный test executor убирает лишние пробелы и исправляет первую строчную букву; это не LLM и не семантическое выполнение инструкции. Заменяемый EditProvider получает только выбранный текстовый блок/заголовок страницы и инструкцию. До ручного принятия Page не меняется. Принятие выполняет обычный pageSave с исходной revision и заменой выбранного блока; устаревшее предложение не может перезаписать новый черновик. Отклонение просто закрывает предложение.

Публичный createAiRunHost управляет статусом/отменой/replay/checkpoint. Частный текст результата хранится отдельно, metadata задания не содержит after. Изменение страницы/отзыв роли отменяют ожидание; timeout10s, два задания глобально и одно на аккаунт, максимум100 сохранённых запусков. Поздний ответ не меняет terminal state, ошибки провайдера очищаются. Прерванное рестартом задание не повторяет исполнителя автоматически. Никаких платных запросов нет.

## Границы

До200 страниц, 30 блоков/50К символов страницы, 50 snapshots/100 decisions/200 comments/100 publications/100 schedules страницы, 200 активных изображений, 3000 semantic intents и последние1000 audit записей. Нет публичного редактирования, внешней регистрации, CDN-инвалидации, очистки snapshot history или миграции владельца файлов. Один authority остаётся автором публикации. Docker и W08 интеграция проверяются отдельно; готовность отдельных этапов фиксируется в отчёте приёмки.

## Проверка подключения базы знаний

`npm test` — самостоятельные domain/images/assistant/network проверки; выполнены настоящий authority и два serving nodes, принудительное отключение узла, отмена расписания, offline503, просроченная публикация после рестарта один раз и откат. `npm run test:integration` дополнительно запускает в исходном репозитории реальные Content и Support authority. Эта проверка импортирует соседний support/runtime, поэтому она и соответствующий npm script не должны входить в standalone копию.

W08 проверен: чтение через common2 resource с reader credentials, server-configured org mapping, отсутствие draft/review и копии в editable articles, публикация/withdraw/rollback, отказ при смене reader на editor, отзыв членства поддержки во время remote read, offline источника. UI базы знаний поддержки имеет отдельный блок чтения опубликованных материалов. Изображения там представлены описанием; автоматического копирования активов и AI-индексации CMS нет. Текущий список/статью пользователь запрашивает заново; прочитанный ранее текст остаётся снимком, пока открыт.

## Готовый интерфейс Folio

Самостоятельная редакция запускается на `/`: черновик и блоковый предпросмотр, перенос блоков клавиатурой/мышью через react2, медиатека, сравнение предложения помощника, версии и комментарии, согласование, расписание, публикация, откат и отзыв. Отдельные роли автора, редактора, издателя и читателя. Анонимный журнал открывается через `/#read=northstar`, статья — `/#read=northstar/welcome`; свежие чтения идут в authority, а публичный common2 view обновляет открытую страницу после публикации/отзыва. Подтверждения используют публичный react2 Overlay.

Живые цепочки ролей, настоящий PNG, предложение текста, v1→v2→rollback→withdraw, немедленный отзыв редакторских прав и границы проверки описаны в [приёмке UI](../../doc/internal/acceptance/CONTENT-UI-ACCEPTANCE.md). Mobile-проверка фиксируется отдельно: desktop размер окна не считается мобильным доказательством.
