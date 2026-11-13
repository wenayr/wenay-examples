# Orbit · продажи и согласования

Паспорт примера. Актуальные результаты проверок — [STATUS](../../doc/STATUS.md), подробности — [README](README.md).

- **Сценарий:** Компании и контакты, воронка сделок, версии предложений, кабинет клиента, импорт CSV
- **Роли:** менеджер, руководитель, клиент, владелец
- **Порт:** 3813; версия примера: 0.1.0
- **Внешние зависимости:** нет
- **Топология:** authority + узлы; связанные задачи через общий task-домен
- **Проверки:** `npm test` — домен, импорт, помощник, сеть
- **Размещение:** `npm run test:crm` из apps/hosting
- **Отчёты:** [интерфейс](../../doc/internal/acceptance/CRM-UI-ACCEPTANCE.md), [размещение](../../doc/internal/acceptance/CRM-HOSTING-ACCEPTANCE.md)

## Ограничения

Суммы условные, оплаты нет. ИИ-сводка на тестовом исполнителе. Число записей ограничено для лёгкого стенда.

## Механизмы библиотек

Список собирается `scripts/status.mjs` из фактических импортов приложения.

<!-- status:imports -->
`wenay-common2`, `wenay-common2/ai`, `wenay-common2/observe`, `wenay-common2/server/fs`, `wenay-common2/server/process`, `wenay-common2/service`, `wenay-common2/service/client`, `wenay-common2/service/host`, `wenay-common2/service/server`, `wenay-react2/grid`, `wenay-react2/react`, `wenay-react2/ui`
<!-- /status:imports -->
