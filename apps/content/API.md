# Folio — устройство и контракт

Справочник к [README](README.md): контракт редактора и команды, публичный фасад с правилами согласованности, изображения и предложения текста.

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
