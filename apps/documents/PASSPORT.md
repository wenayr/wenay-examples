# Papertrail · обработка документов

Паспорт примера. Актуальные результаты проверок — [STATUS](../../doc/STATUS.md), подробности — [README](README.md).

- **Сценарий:** Загрузка CSV, TXT и текстового PDF, извлечение строк, проверка рядом с источником, утверждение и выгрузка
- **Роли:** загрузчик, проверяющий, владелец
- **Порт:** 3811; версия примера: 0.1.0
- **Внешние зависимости:** python3
- **Топология:** authority + узлы; отдельные дочерние обработчики Node и Python
- **Проверки:** `npm test` — домен, сеть, продуктовый API; `npm run test:advanced` — отмена, поздний результат, рестарт
- **Размещение:** `npm run test:documents` из apps/hosting
- **Отчёты:** [приёмка D02–D07](../../doc/internal/acceptance/DOCUMENTS-D02-D07-ACCEPTANCE.md)

## Ограничения

До 512 КиБ, 200 строк, 20 колонок, PDF до 10 страниц. OCR сканов не подключён.

## Механизмы библиотек

Список собирается `scripts/status.mjs` из фактических импортов приложения.

<!-- status:imports -->
`wenay-common2`, `wenay-common2/ai`, `wenay-common2/observe`, `wenay-common2/server`, `wenay-common2/server/blob`, `wenay-common2/server/fs`, `wenay-common2/server/process`, `wenay-common2/service`, `wenay-common2/service/client`, `wenay-common2/service/host`, `wenay-common2/service/server`, `wenay-react2/react`
<!-- /status:imports -->
