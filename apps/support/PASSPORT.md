# Northstar · поддержка команды

Паспорт примера. Актуальные результаты проверок — [STATUS](../../doc/STATUS.md), подробности — [README](README.md).

- **Сценарий:** Обращения, закрытые заметки, база знаний с версиями, вложения, помощник, уведомления
- **Роли:** клиент, агент, руководитель, владелец
- **Порт:** 3810; версия примера: 0.1.0
- **Внешние зависимости:** нет
- **Топология:** authority + обслуживающие узлы; продуктовый HTTP API поиска
- **Проверки:** `npm test` — продуктовый API, переписка, индекс статей, домен, органайзер, уведомления, ресурсы, сеть, OIDC, идентичность
- **Размещение:** `npm run test:support` из apps/hosting
- **Отчёты:** [интерфейс](../../doc/reports/support-ui.md)

## Ограничения

Помощник подбирает опубликованные источники без модели. Email — локальный журнал. Внешний OIDC требует настройки.

## Механизмы библиотек

Список собирается `scripts/status.mjs` из фактических импортов приложения.

<!-- status:imports -->
`wenay-common2`, `wenay-common2/ai`, `wenay-common2/observe`, `wenay-common2/server`, `wenay-common2/server/blob`, `wenay-common2/server/fs`, `wenay-common2/server/process`, `wenay-common2/service`, `wenay-common2/service/client`, `wenay-common2/service/host`, `wenay-common2/service/server`, `wenay-react2/react`
<!-- /status:imports -->
