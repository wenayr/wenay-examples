# Daylight · запись и расписание

Паспорт примера. Актуальные результаты проверок — [STATUS](../../doc/STATUS.md), подробности — [README](README.md).

- **Сценарий:** Услуги и ресурсы, вместимость, временное удержание, подтверждение, перенос, очередь ожидания
- **Роли:** клиент, сотрудник, владелец
- **Порт:** 3814; версия примера: 0.1.0
- **Внешние зависимости:** нет
- **Топология:** authority владеет вместимостью и удержаниями; узлы обслуживают проекции
- **Проверки:** `npm test` — домен и гонки, помощник, сеть
- **Размещение:** `npm run test:booking` из apps/hosting
- **Отчёты:** [backend](../../doc/reports/booking-backend.md), [интерфейс](../../doc/internal/acceptance/BOOKING-UI-ACCEPTANCE.md)

## Ограничения

Депозит и напоминания локальные тестовые. Помощник только заполняет предложение; подтверждает человек.

## Механизмы библиотек

Список собирается `scripts/status.mjs` из фактических импортов приложения.

<!-- status:imports -->
`wenay-common2`, `wenay-common2/ai`, `wenay-common2/observe`, `wenay-common2/server/fs`, `wenay-common2/server/process`, `wenay-common2/service`, `wenay-common2/service/client`, `wenay-common2/service/host`, `wenay-common2/service/server`, `wenay-react2/react`
<!-- /status:imports -->
