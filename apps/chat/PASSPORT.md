# Рядом · общий чат

Паспорт реализации C03; приёмка C03 отдельно от принятого C01.
Текущие проверки — [STATUS](../../doc/STATUS.md), сценарии — [README](README.md), контракт — [API](API.md).

- **Сценарий:** Общая история клиентов, смена аккаунта, независимый выбор workspace, сообщения, явный тестовый помощник, повтор и перезапуск
- **Роли:** текущие workspace owner/member и участник разговора; обе серверные проверки обязательны
- **Порт:** 3819; версия примера: 0.1.0
- **Внешние зависимости:** нет
- **Топология:** один authority; два native conversation host с отдельными журналами; web-клиенты читают библиотечный replay
- **Проверки:** `npm test` — реальные сетевые клиенты, receipts, persistence, доступ
- **Размещение:** самостоятельный Node-процесс, loopback по умолчанию
- **Отчёты:** [C01](../../doc/changes/chat-c01-20260926.md), [этапы Q12](../../doc/AI-CHAT-PRODUCT-PLAN.md)

## Ограничения

Две демонстрационные учётные записи и два статических workspace. Team сохраняет C01
журнал целиком, включая private-alice; Personal — новый host, автоматического переноса
старой личной истории нет. Native bound owner-команды меняют membership и защищают
последнего owner. Logout локален и не обещает глобального отзыва токенов.

Полный native REST отключён; остаётся native credential login. Ограничение связано с
[SERVICE-COMMAND-RECEIPT-ACL](../../doc/library-tasks/SERVICE-COMMAND-RECEIPT-ACL.md).
C03 требует собственной runtime/browser приёмки и не наследует PASS C01.
Тестовый ответ не вызывает внешнюю модель. Streaming, remote agent, установленные
desktop/mobile и реальное размещение остаются отдельными непринятыми этапами.

## Механизмы библиотек

<!-- status:imports -->
`wenay-common2/conversation`, `wenay-common2/observe`, `wenay-common2/service`, `wenay-common2/service/client`, `wenay-common2/service/host`, `wenay-common2/service/server`, `wenay-react2/react`
<!-- /status:imports -->
