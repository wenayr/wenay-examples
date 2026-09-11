# Accord · согласование заявок

Паспорт примера. Актуальные результаты проверок — [STATUS](../../doc/STATUS.md), подробности — [README](README.md).

- **Сценарий:** Черновик заявки, неизменяемая отправленная версия, решение другого сотрудника, история
- **Роли:** сотрудник, проверяющий, владелец
- **Порт:** 3818; версия примера: 0.1.0
- **Внешние зависимости:** нет
- **Топология:** authority + два обслуживающих узла
- **Проверки:** `npm test` — домен и сеть
- **Размещение:** `npm run test:approvals` из apps/hosting
- **Отчёты:** [измерение K08](../../doc/reports/K08-approvals.md), [интерфейс](../../doc/internal/acceptance/APPROVALS-UI-ACCEPTANCE.md)

## Ограничения

Внешних интеграций нет. Вход демонстрационный. Файлы не прикладываются. Организации и анкета заданы начальным состоянием.

## Механизмы библиотек

Список собирается `scripts/status.mjs` из фактических импортов приложения.

<!-- status:imports -->
`wenay-common2/server/process`, `wenay-common2/service`, `wenay-common2/service/client`, `wenay-common2/service/host`, `wenay-common2/service/server`, `wenay-react2/react`, `wenay-react2/ui`
<!-- /status:imports -->
