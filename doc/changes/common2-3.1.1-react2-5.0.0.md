# Common2 3.1.1 / React2 5.0.0 — обновление каталога

Дата: 26 сентября 2026. Исходная пара: common2 2.21.1 / react2 3.5.1.
Источник — опубликованные npm latest, проверенные через npm view. Локальные библиотеки
использовались только для чтения документации; link, локальные архивы и сборки не подключались.

## Изменения

Точные зависимости и lock обновлены в pizzeria, hosting, support, documents, metering, crm,
booking, forms, monitoring, content и approvals. Catalog библиотек не использует.
React, TypeScript, Vite и другие версии намеренно не обновлялись вместе с библиотеками.

- useMediaSource в двух компонентах органайзера импортируется из опубликованного wenay-calls 1.0.0.
  npm build пиццерии собирает также самостоятельный UI органайзера.
- Удалены обходы STORE-NESTED-REPLACEMENT из истории статей support и истории monitoring.
  Исправление опубликовано в common2 2.21.2; на 3.1.1 проходит минимальный критерий.
  В npm test support добавлен этот сценарий с --expect-fixed.
- Приложения уже использовали canonical React subpaths, явный express и нужные ag-grid peers.
  Импорты удалённых exchange-имён, /lib/client и /lib/server не найдены.
- Исправлено устаревшее описание инфраструктуры в README пиццерии.

Основная архитектура сохраняется: публичный service host/client, библиотечные роли, ресурсы,
replay и reconnect; предметное состояние и правила остаются в приложениях.
Полная карта перехода — [API-аудит](../reports/LIBRARY-API-AUDIT-2026-09-26.md).

## Достоверность проверок

Runner записывает SHA256 текущих package.json и package-lock.json вместе с результатом.
Старые логи и логи другой пары зависимостей не дают зелёный STATUS. Пропуски и отсутствие script
записываются явно; Docker/Python требуются для test, не блокируют typecheck/build.
STATUS --verify сравнивает версии, приложения и исходы, игнорируя динамические время/размер/дату.
Генерация STATUS по-прежнему отдельная команда; verify не переписывает документы.

В check:all добавлены существующий scaffold-check и изолированная регрессия runner/status.
Команда разделена на check:apps и check:repo; check:all вызывает оба этапа. CI сначала сохраняет
результаты своего профиля через npm run status и затем запускает read-only проверку документации.
Hosting test в CI пропущен явно, типы и сборка проверяются. Workflow подготовлен локально;
запуск на GitHub без push не заявляется.
Импорты wenay-calls входят в генерируемые паспорта. Колонка «Копия» означает наличие проверки,
а не отдельную гарантию её исполнения: эта граница сохраняется в описании STATUS.

## Библиотечные дефекты

| Задача | Проверка npm 3.1.1 | Решение |
| --- | --- | --- |
| STORE-NESTED-REPLACEMENT | --expect-fixed: exit 0; snapshot и реактивная запись корректны | Два обхода удалены, минимальный repro остаётся в test support |
| AI-POLICY-INVALIDATION | Старый fragment отдаёт приватный результат новому клиенту и keyframe после изменения policy | Открыто; серверное хранение приватного текста и повторная ACL-проверка сохранены |
| AI-RESOURCE-LIFECYCLE | После revoke специализированный AI-клиент даёт unhandled replaySubscribe: logical RPC line ended | Открыто; state-only зеркало с явным onError сохранено |

Это повторная проверка прежних дефектов, не три новых обнаружения. Новый major сам по себе
не закрывает задачу. Воспроизведения и критерии — [единый пакет](../library-tasks/CURRENT-HANDOFF.md)
и [реестр обходов](../library-tasks/WORKAROUNDS.md).

## Приёмка

Проверено на Windows, Node 24.18.0, Python 3.14 и Docker Engine 29.7.2:

| Проверка | Результат |
| --- | --- |
| npm run check:all с DOCUMENT_PYTHON, указывающим на установленный Python | Exit 0; 36 шагов: 35 выполнены, catalog build не объявлен; ошибок и внешних пропусков нет |
| Приложения | 12 typecheck, 12 test, 11 build; build пиццерии включает frontend и organizer |
| Runner/status regression | Успех/провал, stale package/lock, явный skip, отсутствующий script и старый log; пройдено в изолированном fixture |
| Scaffold/sync/style/links | 9 manifests, 97 синхронных копий по 14 канонам, 437 файлов без нарушений; все ссылки исправны |
| Manifests/lock/installed | 11 потребителей имеют точные 3.1.1/5.0.0, npm resolved/integrity; вложенных common2-копий нет |
| npm run test:docker из hosting | Exit 0; реальные Node → Python → Node rollback, stable gateway, failed readiness сохраняет healthy endpoint |
| npm run test:advanced из documents с DOCUMENT_PYTHON | Exit 0; два настоящих Node/Python PID, отмена Node без вреда Python, поздний результат не применяется |
| npm run status | STATUS, версии README, импорт wenay-calls в паспорте и витрина сгенерированы по свежим логам |

Первый промежуточный прогон documents пропустил явный Python-сценарий без DOCUMENT_PYTHON.
В итоговом check:all интерпретатор указан, пропуск устранён; строка SKIP в итоговом логе отсутствует.
Остальные инструменты и paid providers не добавлялись. Docker live test использует локальные
pinned Node/Python fixture images, не принимает продуктовые образы новой версии или полноценный
stateful deployment продуктов — это Q03 следующего плана.

Изменения сохранены в ветке codex/library-upgrade-20260926; main и удалённый репозиторий
не изменялись. Обновления приложений коммитятся отдельно со ссылкой на этот отчёт.

Ручная браузерная приёмка всех ролей, физических устройств, внешний OIDC и платные AI-вызовы
не входят в автоматические результаты. Live Docker-проверки отмечаются отдельно от npm test
hosting, который использует протокольные fixtures.

## Следующая работа

[Стратегия сентября](../STRATEGY-2026-09.md) содержит очередь и критерии каждого проекта.
Основание — [продуктовый аудит](../reports/PRODUCT-AUDIT-2026-09-26.md) и
[аудит платформы](../reports/PLATFORM-AUDIT-2026-09-26.md).
Приоритет — доказательства runtime/восстановления, ограниченные машинные API support/documents,
интеграция квот, затем небольшие UX/lifecycle улучшения и контрольная автономная копия.
