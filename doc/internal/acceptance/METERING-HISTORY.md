# Counter — приёмка и история

Перенесено 11 сентября 2026 из `apps/metering/README.md` (задача R04 [плана 3](../../PLAN3-TASKS.md)). Это результат приёмки на указанные даты, а не действующая инструкция. Текущее состояние проверок — [STATUS](../../STATUS.md).

## Развёртывание через пример хостинга

Сначала собрать интерфейс в `apps/metering`, затем последовательно построить два образа:

```text
npm run build
docker build --memory 768m --build-arg APP_RELEASE=first -t wenay-examples.local/metering:first .
docker build --memory 768m --build-arg APP_RELEASE=second -t wenay-examples.local/metering:second .
```

Dockerfile использует закреплённый digest Node 24 Alpine, пользователя `node`, `/data` для архива и готовый `public`. Python/PDF/OIDC не нужны. `.dockerignore` допускает только package/lock, backend, shared, public и Dockerfile; проверочные исходники исключены. `.env.example` описывает опциональные server-only настройки. `/health` возвращает `application`, `release` из APP_RELEASE и `billing: test-units-only`.

Из `apps/hosting` запустить:

```text
node --import tsx backend/metering-live-check.ts
```

Приёмка использует RepoDigest, один stateful writer с ограничением 256 MiB/0.5 CPU и стабильный gateway. Она размещает first, second и откатывает first; сохраняет резерв 20, подтверждает 12 после деплоя, проверяет повтор без удвоения после отката и запрещённый запрос после отзыва. Новый вход первоначальным секретом после смены контейнера подтверждает, что сохранённый хеш ключа работоспособен. Сам секрет остаётся только в памяти теста и не выводится. Прежний workspace и ресурс владельца восстанавливаются; command-only клиент без views переподключается лениво через публичный `ready()` перед следующей командой.

Финальный цикл 10 сентября 2026 после пересборки интерфейса: 54.47 / 55.32 / 54.44 MiB по `docker stats`, лимит каждого контейнера подтверждён через inspect. Это моментальные измерения, не максимум под нагрузкой. Тест удаляет только свой контейнер, volume со случайным префиксом владельца и свой временный каталог. Образы остаются для повторной проверки. В интерфейсе API-клиента есть явное «Переподключить» для command-only сессии после смены контейнера.
