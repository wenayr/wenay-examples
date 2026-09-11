# Signal · мониторинг сервисов

Паспорт примера. Актуальные результаты проверок — [STATUS](../../doc/STATUS.md), подробности — [README](README.md).

- **Сценарий:** HTTP-проверки своих сервисов, инциденты, задачи дежурных, уведомления, публичная страница состояния
- **Роли:** владелец, дежурный, наблюдатель, посетитель
- **Порт:** 3816; версия примера: 0.1.0
- **Внешние зависимости:** нет
- **Топология:** authority + узлы; два отдельных probe-процесса с подхватом работы
- **Проверки:** `npm test` — домен, probe, встроенный probe, помощник, сеть
- **Размещение:** `npm run test:monitoring` из apps/hosting
- **Отчёты:** [интерфейс](../../doc/internal/acceptance/MONITORING-UI-ACCEPTANCE.md), [упаковка](../../doc/reports/monitoring-packaging.md)

## Ограничения

Только разрешённый оператором список URL и IP. Автоматических команд хостингу нет: помощник показывает факты.

## Механизмы библиотек

Список собирается `scripts/status.mjs` из фактических импортов приложения.

<!-- status:imports -->
`wenay-common2`, `wenay-common2/ai`, `wenay-common2/observe`, `wenay-common2/server/fs`, `wenay-common2/server/process`, `wenay-common2/service`, `wenay-common2/service/client`, `wenay-common2/service/host`, `wenay-common2/service/server`, `wenay-react2/react`, `wenay-react2/ui`
<!-- /status:imports -->
