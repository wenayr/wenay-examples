# Counter · учёт потребления

Паспорт примера. Актуальные результаты проверок — [STATUS](../../doc/STATUS.md), подробности — [README](README.md).

- **Сценарий:** API-ключи и scopes, квоты, резерв, расход, освобождение и неопределённый результат, webhook
- **Роли:** владелец, API-клиент, аудитор
- **Порт:** 3812; версия примера: 0.1.0
- **Внешние зависимости:** нет
- **Топология:** authority + узлы; очередь webhook на reconciler
- **Проверки:** `npm test` — домен, webhook, сеть; `npm run test:integration` — реальные потребители
- **Размещение:** `npm run test:metering` из apps/hosting
- **Отчёты:** [интерфейс](../../doc/reports/metering-ui.md), [интеграция](../../doc/SAAS-METERING-INTEGRATION.md)

## Ограничения

Единицы тестовые, денег не списывает. Адрес webhook только из списка оператора. Платёжный провайдер не настроен.

## Механизмы библиотек

Список собирается `scripts/status.mjs` из фактических импортов приложения.

<!-- status:imports -->
`wenay-common2`, `wenay-common2/observe`, `wenay-common2/server/process`, `wenay-common2/service`, `wenay-common2/service/client`, `wenay-common2/service/host`, `wenay-common2/service/server`, `wenay-react2/grid`, `wenay-react2/react`
<!-- /status:imports -->
