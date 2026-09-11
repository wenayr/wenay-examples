# Petal · формы и обратная связь

Паспорт примера. Актуальные результаты проверок — [STATUS](../../doc/STATUS.md), подробности — [README](README.md).

- **Сценарий:** Версии форм, условные вопросы, публичная ссылка и iframe, ответы, агрегаты, экспорт и группировка
- **Роли:** автор, участник, аналитик, владелец
- **Порт:** 3815; версия примера: 0.1.0
- **Внешние зависимости:** нет
- **Топология:** authority + узлы; публичное поколение доступа отдельно от сотрудников
- **Проверки:** `npm test` — домен, ресурсы, группировка, сеть
- **Размещение:** `npm run test:forms` из apps/hosting
- **Отчёты:** [интерфейс](../../doc/internal/acceptance/FORMS-UI-ACCEPTANCE.md), [упаковка](../../doc/reports/forms-packaging.md)

## Ограничения

До 20 вопросов и 20 версий, 5000 ключей приёма. Группировка — детерминированное демо без модели.

## Механизмы библиотек

Список собирается `scripts/status.mjs` из фактических импортов приложения.

<!-- status:imports -->
`wenay-common2`, `wenay-common2/ai`, `wenay-common2/observe`, `wenay-common2/server/blob`, `wenay-common2/server/fs`, `wenay-common2/server/process`, `wenay-common2/service`, `wenay-common2/service/client`, `wenay-common2/service/host`, `wenay-common2/service/server`, `wenay-react2/react`, `wenay-react2/ui`
<!-- /status:imports -->
