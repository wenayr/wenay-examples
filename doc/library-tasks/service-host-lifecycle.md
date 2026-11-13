# C4 — lifecycle хоста и согласованный CORS

common2 2.17.0; потребитель — пример 0.8.0. Это задача Node-хоста, не механизма лидерства или глобального HA.

**Факт.** `backend/leader.ts` содержит локальные HTTP CORS middleware, `mount` с возвращаемым disposer и вызов unmount при shutdown. Published `examples/pizzeria/leader.ts` этих дополнений не имеет: mount возвращает void. При обновлении 2.17.0 пришлось сохранять их вручную. `backend/main.ts` использует disposer для часов автоматических задач; загрузка фотографий обращается к authority отдельного заведения по HTTP. `backend/node.ts` отдельно содержит запуск сервера и shutdown.

**Проверено.** `runLeaderProcess`/`runNodeProcess` — source scaffold; public `server/http` даёт HTTP facade/OpenAPI, но не этот контракт владения host resources. Socket.IO origin policy сама по себе не добавляет заголовки к Express endpoint.

**Работа.** В общем host API C3/C4 предоставить mount/dispose, общую явную политику разрешённых origins для HTTP и WS, идемпотентный shutdown с ожиданием асинхронных cleanup и ограниченным бюджетом. Отделить закрытие созданного ресурса от установки process signal handlers/`process.exit`, чтобы host можно было использовать в тесте или композиции серверов. Чужие переданные ресурсы закрывать только при оговорённом ownership.

**Воспроизведение.** Подключить UI с origin другого порта и выполнить bearer upload/JSON request к authority. Установить mount с таймером, запустить/закрыть host дважды. Сравнить с published scaffold и текущими локальными дополнениями. Это сценарий приёмки; отдельная новая проверка CORS в этом аудите не запускалась.

**Приёмка.** Разрешённый HTTP preflight/запрос работает, запрещённый origin не получает разрешающие заголовки; WS использует ту же policy. Cleanup вызывается один раз при штатном закрытии, ошибке запуска и сигнале; таймеров/сокетов после shutdown нет. Тестовый host закрывается без завершения процесса тестов. Origin allowlist и продуктовые mount-ресурсы задаёт приложение. Не включать разрешение всех origins или credentials по умолчанию.
