# CRM: реальное размещение и откат

10 сентября 2026, `apps/hosting/backend/crm-live-check.ts` — PASS.

Проверка использует настоящий hosting authority + Docker agent и immutable image digest. Два совместимых образа first/second запускаются последовательно в одном volume через стабильный gateway. Один контейнер имеет cap256MiB, CPU0.5; builder вызван с memory768m. Выполнен first → second → rollback first, каждый этап подтверждён `/health` с APP_RELEASE.

Через библиотечный клиент owner записал private note, создал и опубликовал предложение. После обновления customer прочитал публичную версию без внутренней заметки и принял её; появилась одна рабочая задача. Owner импортировал CSV через настоящий imports resource/createAiRunHost. После отката сохранились согласование, задача, checkpoint строки и контакт. Повтор согласования не создал новую задачу. Клиенты и открытые crm/imports resources сохранялись между заменами контейнера и переподключились автоматически.

Память из docker stats в контрольных точках: 57.08 / 57.07 / 57.08MiB из256MiB. Это снимки малого сценария, не нагрузочная ёмкость. Собственные контейнеры, volume и временный архив удалены. Другие Docker workloads не изменялись.

Проверенные образы:

- first `wenay-examples.local/crm@sha256:70780bf7215d38a7b974d1be4384f3ec3e010d14922f1b5a263c65ac0745710b`
- second `wenay-examples.local/crm@sha256:8dc031f9f33c4def4b0d45ba5f031231f5877df56597b3c61042cfda8f7e2db2`

В оба включён app-level fix создания abort Promise только внутри запущенного assistant execution. Проверка не вызывает платную модель; внешний metering здесь не настроен. Отдельный тест корневой задачи проверяет metered сценарий.

Dockerfile/.dockerignore теперь входят в самостоятельную CRM-копию. `crm-live-check.ts` и test-only общий `hosted-application-check.ts` принадлежат hosting-приёмке исходного репозитория, не SDK и не обязательная зависимость нового CRM. Откат совместимой схемы не доказывает произвольную миграцию данных; один writer остаётся владельцем записи.
