# Content Studio: backend и интеграция

10 сентября 2026. Exact common2 2.21.1/react2 3.5.1. Docker, платные модели и внешние аккаунты не использовались.

## Завершённые проверки

`apps/content npm test` PASS: domain, images resource, assistant, реальная сеть. Backend typecheck проходил до параллельного frontend; владелец frontend отдельно сообщил итоговые typecheck/build PASS, браузерная приёмка в его задаче.

- Домен: tenant/owner/author/editor/publisher/reader/outsider, атомарный revision guard, immutable snapshots, комментарии к версии, устаревшее согласование, безопасные типы блоков/ссылок, публичная приватность, semantic repeat, schedule/cancel/late/revoke, rollback и withdraw.
- Изображения: public createLocalBlobStorage, PNG/JPEG/WebP signatures, 512KiB cap, SHA256 read, same-file dedupe, разные организации с одинаковыми байтами, защита draft/snapshot ссылок, анонимное чтение только текущих опубликованных ссылок, tombstone/remove retry/reupload, отзыв прав на открытом ресурсе.
- Assistant: public createAiRunHost/checkpoint; явная локальная нормализация текста, before/after, неизменность документа до ручного pageSave, stale revision guard, приватный результат вне AI metadata, disk restart, cancel/timeout/late/source change/revoke, очищенные provider errors. Реальной LLM нет.
- Сеть: authority + два настоящих serving процесса; редактор действительно подключён к serving node; его принудительная остановка переводит прежний store на другой узел. Публичный anonymous view сходится с публикацией/withdraw. HTTP обеих serving nodes читает authority/no-store, не возвращает draft/review. При offline authority возвращает503. Просроченное сохранённое расписание выполняется после restart один раз; старые client/resource переподключаются. Semantic repeat старой публикации не заменяет новую; rollback восстановлен.

## W08: Support ↔ Content

`apps/content npm run test:integration` PASS на двух настоящих service leader hosts. Поддержка открывает public-only Content resource через configured reader credentials с помощью common2 client/SC1. Authority проверяет реализацию через `satisfies PublishedFacade`; копируемый тип `published-contract.ts` идентичен у двух приложений, проверяется тестом.

Поддержка проверяет собственный tenant ACL до и после async IO, не разрешает клиенту выбирать upstream/reader/Content tenant. Writer/editor credentials отвергаются. Publication/withdraw/rollback видны при свежем чтении; draft/review не передаются, локальные editable articles не изменяются. Отзыв customer в Northstar во время задержанного remote read запрещает результат, хотя customer остаётся членом Harbor. Offline источника отказывает без старого cached content. UI имеет отдельный блок read-only публикаций с временем чтения и явным обновлением; изображения представлены alt-текстом. Browser этого добавленного блока отдельно не заявлен.

Support после добавления интеграции: typecheck/build и полный npm test PASS, включая домен, organizer, notices, real SC1/files/AI, authority+2nodes, state-only revoke, local OIDC protocol и identity provisioning. Последующая H02 доработка поддержки принадлежит корневой задаче и имеет собственную регрессию.

## Остаточные границы

Реплицируемый public view — eventual snapshot; strict-current чтение выполняет authority resource/HTTP. Уже отправленные пользователю байты не отзываются. Один writer остаётся владельцем публикаций и файлов. Image signature test не декодирует весь файл и не является антивирусом. Crash между blob commit и metadata может оставить недоступные orphan bytes; удаление живых assets защищено ссылками всех snapshots. Ограничения объёма и отсутствие cleanup истории перечислены в README.

Публикация расписания, редакторские полномочия, версии контента и ссылки на активы остаются предметными правилами. Нового подтверждённого дефекта библиотек этот этап не выявил. Общая файловая и AI инфраструктура использована через опубликованные механизмы; маленький read-only контракт двух реальных потребителей не превращён в глобальный SDK.

Все тестовые процессы остановлены, собственные временные файловые каталоги удалены. Превью3817 запускает владелец frontend для браузерной приёмки. Упаковка Content/Docker и scaffold — следующий отдельный этап. Межпроектный integration-check и test:integration должны быть исключены из standalone копии.
