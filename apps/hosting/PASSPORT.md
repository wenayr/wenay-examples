# Хостинг · размещение приложений

Паспорт примера. Актуальные результаты проверок — [STATUS](../../doc/STATUS.md), подробности — [README](README.md).

- **Сценарий:** Проекты, окружения, релизы; развёртывание, обновление, откат в Docker и LXD
- **Роли:** админ, агент
- **Порт:** 3700; версия примера: 0.4.0
- **Внешние зависимости:** docker
- **Топология:** управляющий authority, агенты на машинах, gateway с постоянным томом и одним writer
- **Проверки:** `npm test` — docker, gateway, агент, LXD, оркестрация, WebSocket; отдельные `test:<app>` разворачивают реальные продукты
- **Размещение:** —
- **Отчёты:** [оценка](../../doc/reports/hosting-library-assessment.md), [план](../../doc/HOSTING-PLAN.md)

## Ограничения

Реальный Kubernetes не заявляется. LXD-протокол проверен без настоящей VM. Автоматических миграций схемы нет.

## Механизмы библиотек

Список собирается `scripts/status.mjs` из фактических импортов приложения.

<!-- status:imports -->
`wenay-common2`, `wenay-common2/observe`, `wenay-common2/service`, `wenay-common2/service/client`, `wenay-common2/service/host`, `wenay-react2/react`
<!-- /status:imports -->
