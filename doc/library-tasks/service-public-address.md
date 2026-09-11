# H3 — публичный адрес service host за proxy/NAT

**Закрыто в 2.20.0.** `SERVICE_PUBLIC_URL` подключён агентом, оба реальных Docker-приложения проходят RPC/Store/SC1 и повторную выдачу AI receipts после update/rollback. Браузерная пиццерия также проверена. [Принятие релиза](../changes/common2-2.20.0.md). Ниже сохранена исходная постановка 2.19.0; прежнее падение теперь должно стать положительным `test:public-address`.

Версии: common2 2.19.0/react2 3.3.0. Подтверждено реальным Docker-развёртыванием органайзера через наш хостинг. Это общая возможность service host, без Docker-логики внутри библиотеки.

## Сценарий и результат

Приложение слушает внутри контейнера порт 8080. Docker публикует другой локальный порт; gateway предоставляет стабильный третий адрес. HTTP/REST, readiness и фактический WebSocket tunnel работают. `createServiceClient({url: gatewayUrl})` получает roster с внутренним адресом authority и пытается открыть недоступный endpoint. Итог — `no eligible endpoint in the roster`.

`createServiceLeaderHost` сам создаёт `createHostResource` и передаёт в `createServiceLeader` `selfUrl: () => url`, где url — адрес локального слушателя. `LeaderProcessDeps`, `ServiceHostOptions`, `leaderEnv` не позволяют задать advertised/public URL отдельно. В нижнем публичном `createServiceLeader` selfUrl есть, но переход потребителя на ручную сборку всего host lifecycle/архивов/RPC повторит уже предоставленный библиотекой runtime. В публичном ServiceClientDeps нет адресного преобразования roster. Ослабление CORS этого не исправляет.

Последний повтор 10 сентября: gateway `http://127.0.0.1:63977`, roster `[{id:'leader', url:'http://localhost:8080'}]`, ошибка `no eligible endpoint in the roster`. Порты временные; тест удалил только собственный контейнер и том.

## Воспроизведение

1. `apps/pizzeria`: `npm run build`, `npm run build:organizer`. Затем `apps/hosting`: `npm run prepare:products` — последовательно создаёт локальные неизменяемые образы обоих приложений и `data/product-images.json`.
2. `apps/hosting`: `npx tsx backend/stateful-live-check.ts`. Один временный контейнер, лимит 256 МиБ, собственные данные и очистка. Сценарий печатает gateway и advertised roster при ошибке.
3. `npx tsx backend/stateful-live-check.ts --rest-only` проверяет сохранение задачи, замену и rollback через публичный REST. Его успех не закрывает H3.
4. `npx tsx backend/gateway-ws-check.ts` доказывает двусторонний Socket.IO WebSocket upgrade, смену upstream и reconnect независимо от service roster.

## Минимальная задача

Добавить поддерживаемое разделение адреса слушателя и адреса, сообщаемого клиентам, в leader/node host wrappers (и process env при необходимости). Публичный адрес задаётся доверенной конфигурацией оператора, не произвольными входящими Host/X-Forwarded-* заголовками. Библиотека не создаёт reverse proxy, сертификаты, Docker/VM или балансировщик.

Проверить взаимодействие с CORS: внешний origin можно разрешить текущим API; изменение адреса публикации не должно автоматически разрешать любые origins. Описать, какие адреса authority и serving node должны быть достижимы для клиента и межсерверного подключения.

## Приёмка

- Разные listen/advertised порты, подключение клиента только через gateway, команды/Store/SC1 ресурсы работают без обхода gateway.
- Два serving nodes с собственными опубликованными URL, размещение, drain и reconnect; не превращать все URL в один адрес без сохранения идентичности маршрутов.
- Перезапуск и обновление приложения за прежним адресом сохраняют подтверждённые данные и ресурсные границы; старый scope недействителен.
- Проверка некорректного URL и отсутствие влияния поддельных входящих заголовков; сохранение прежнего поведения при отсутствии настройки.
- Публичные импорты, пример reverse proxy/NAT, точная версия. После публикации повторить `stateful-live-check` без `--rest-only`.

Пока это блокирует полноценную браузерную приёмку размещённого приложения. Независимые локальные экран/чат/ИИ, REST-проверки архива и проверки gateway продолжаются.
