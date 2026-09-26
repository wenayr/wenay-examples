# Рядом · общий чат

Паспорт C01. Текущие проверки — [STATUS](../../doc/STATUS.md), сценарии — [README](README.md).

- **Сценарий:** Общая история двух клиентов, обычные сообщения, явный тестовый помощник, повтор и перезапуск
- **Роли:** участник разговора; доступ определяется серверной учётной записью
- **Порт:** 3819; версия примера: 0.1.0
- **Внешние зависимости:** нет
- **Топология:** один authority владеет conversation и журналом; web-клиенты читают библиотечный replay
- **Проверки:** `npm test` — реальные сетевые клиенты, receipts, persistence, доступ
- **Размещение:** самостоятельный Node-процесс, loopback по умолчанию
- **Отчёты:** [C01](../../doc/changes/chat-c01-20260926.md), [этапы Q12](../../doc/AI-CHAT-PRODUCT-PLAN.md)

## Ограничения

Две демонстрационные учётные записи, локальный журнал одного писателя. Тестовый ответ
не вызывает внешнюю модель. Streaming, remote agent, workspace switching, установленный
desktop/mobile и реальное размещение относятся к последующим этапам и здесь не приняты.

## Механизмы библиотек

<!-- status:imports -->
`wenay-common2/conversation`, `wenay-common2/observe`, `wenay-common2/service`, `wenay-common2/service/client`, `wenay-common2/service/host`, `wenay-react2/react`
<!-- /status:imports -->
