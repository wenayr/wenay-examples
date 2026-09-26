# Рядом · общий чат

Первый этап C01 [плана Q12](../../doc/AI-CHAT-PRODUCT-PLAN.md): одна история
разговора на нескольких web-клиентах. Обычная отправка сохраняет сообщение;
тестовый помощник отвечает только после отдельного нажатия.

<!-- status:versions -->
Текущие зависимости: **common2 3.1.1 / react2 5.0.0**.
<!-- /status:versions -->

## Запуск

```text
npm ci
npm run typecheck
npm test
npm run build
npm start
```

Откройте `http://127.0.0.1:3819` в двух окнах. Войдите как Алиса и Боб
(`alice` / `alice-pass`, `bob` / `bob-pass`). «Общий разговор» виден обоим;
«Личный разговор» доступен только Алисе. Отправьте сообщение и проверьте
другой клиент. Кнопка «Ответ тестового помощника» добавляет законченный
демонстрационный ответ без обращения к внешней модели.

Для разработки: `npm start`, затем `npm run dev`. Vite использует backend
из `SERVICE_UPSTREAM`, по умолчанию `http://127.0.0.1:3819`.
`SERVICE_PORT`, `SERVICE_HOST` и `SERVICE_DATA_DIR` меняют адрес и каталог данных.
По умолчанию сервер слушает loopback, данные записывает в `chat-data`.

## Как устроено

Сервис common2 определяет identity и выдаёт authority-ресурс `chat`.
Один conversation host хранит разговоры, каналы, сообщения и receipts.
Persistence port записывает библиотечные event и receipt вместе в журнал
с `fsync`; при перезапуске восстанавливает историю и время обновления.
Незавершённая последняя запись останавливает запуск с явной ошибкой.

React владеет service, resource и conversation client через `useOwnedClient`.
`useClientStore` читает библиотечное состояние. Replay и reconnect обеспечивает
common2; отдельной клиентской копии протокола нет. Черновик очищается после
подтверждения, повтор использует сохранённые payload и requestId.

На узком экране список чатов открывается отдельно от истории; «Чаты» возвращает
к списку. Enter отправляет, Shift+Enter добавляет строку. История прокручивается
независимо от формы; текст сообщений сохраняет переносы строк.

## Проверки и границы

`npm test` проверяет настоящие сетевые клиенты, доступ, receipts и перезапуск.
Typecheck/test/build нового продукта прошли; автоматический reconnect проверен
на тех же клиентах после server restart. [Отчёт C01](../../doc/changes/chat-c01-20260926.md)
фиксирует browser сценарии и ограничения. [Паспорт](PASSPORT.md) и [STATUS](../../doc/STATUS.md).

Это один локальный писатель и две демонстрационные учётные записи. Нет
внешнего provider, semantic streaming, удалённого агента, workspace management
или установленного desktop/mobile. Эти требования сохраняются отдельными
этапами C02–C08. Адаптивная страница не закрывает установленный mobile-клиент.

## Механизмы библиотек

<!-- status:imports -->
`wenay-common2/conversation`, `wenay-common2/observe`, `wenay-common2/service`, `wenay-common2/service/client`, `wenay-common2/service/host`, `wenay-react2/react`
<!-- /status:imports -->
