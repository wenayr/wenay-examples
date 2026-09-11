# Печь · пиццерия

Паспорт примера. Актуальные результаты проверок — [STATUS](../../doc/STATUS.md), подробности — [README](README.md).

- **Сценарий:** Заказы, рецептуры, FEFO-склад и сеть заведений с независимой записью
- **Роли:** клиент, повар, курьер, менеджер, владелец
- **Порт:** 3500; версия примера: 0.10.0
- **Внешние зависимости:** нет
- **Топология:** независимые writer-заведения и узлы чтения; отдельные архивы и ключи
- **Проверки:** `npm test` — аккаунты, склад, host, сеть, органайзер, peer, доска, чат, холст, ИИ
- **Размещение:** `npm run test:stateful` из apps/hosting (organizer и pizzeria)
- **Отчёты:** [оценка библиотек](../../doc/reports/pizzeria-library-assessment.md)

## Ограничения

Платежи и рассылка не подключены. Медиа блюд хранится локально. Реальные устройства принимаются отдельно.

## Механизмы библиотек

Список собирается `scripts/status.mjs` из фактических импортов приложения.

<!-- status:imports -->
`wenay-common2`, `wenay-common2/ai`, `wenay-common2/conversation`, `wenay-common2/listen`, `wenay-common2/media`, `wenay-common2/observe`, `wenay-common2/peer`, `wenay-common2/rpc`, `wenay-common2/server/auth`, `wenay-common2/server/blob`, `wenay-common2/server/fs`, `wenay-common2/server/http`, `wenay-common2/server/process`, `wenay-common2/service`, `wenay-common2/service/client`, `wenay-common2/service/host`, `wenay-common2/service/server`, `wenay-react2/communication`, `wenay-react2/react`
<!-- /status:imports -->
