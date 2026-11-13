# Последовательная live-приёмка hosting

Подготовлено 26 сентября 2026 для common2 3.1.1 / react2 5.0.0.
Это отдельный gate после `npm run check:all`: обычный hosting `npm test` проходит IO fixtures,
реальный локальный HTTP/RPC и native WebSocket gateway, но не выполняет product Docker deployment.

## Команда

Из корня репозитория:

```text
node scripts/hosting-live-gate.mjs --plan
node scripts/hosting-live-gate.mjs --only=organizer,pizzeria
node scripts/hosting-live-gate.mjs --only=organizer,pizzeria --images=C:/absolute/path/product-images.json
node scripts/hosting-live-gate.mjs
```

`--plan` только печатает команды, не обращается к Docker и не создаёт логи.
`--only` выбирает сценарии из фиксированного реестра; порядок остаётся последовательным.
`--images` принимает абсолютный путь к отдельному JSON organizer/pizzeria и передаёт его тесту
через `HOSTING_PRODUCT_IMAGES_FILE`. Прежний default `apps/hosting/data/product-images.json`
сохранён, но приёмка может работать с временным manifest без записи пользовательских `data`.
Основной gate состоит из 11 запусков: organizer, pizzeria, support, metering, documents,
crm, booking, forms, monitoring, approvals, content. `--include-runtime` добавляет двенадцатый
общий Node → Python → Node Docker-сценарий, либо его можно выбрать как `--only=runtime`.

Gate использует существующие npm-команды hosting. Для **обоих** organizer/pizzeria выполняется
`test:public-address`, с отдельным `HOSTING_APP_KIND`; это полный публичный RPC/Store/SC1 путь.
`test:stateful` включает `--rest-only` и не заменяет эту проверку. После ошибки следующих
контейнерных сценариев не запускает; недостающие предпосылки отмечает `skip` и продолжает проверять
другие доступные сценарии. Никаких параллельных контейнерных запусков нет.

Коды выхода: **0** — все выбранные сценарии прошли, **1** — ошибка сценария или параметров,
**2** — выбранный набор неполон из-за skip. Успех узкого `--only` не означает успех всех 11.
В `work/hosting-live/report.json` записываются выбранные сценарии, завершённость, pass/fail/skip,
причина, время, manifest digest/image ID, проверенная image label и fingerprints package+lock приложения и hosting.
Логи выполненных сценариев — соседние `<сценарий>.log`. Прерванный отчёт имеет `complete: false`.
Gate не изменяет STATUS и не подменяет логи `run-all`.

## Подготовка образов

Runner сам не собирает, не скачивает и не удаляет образы. Он проверяет `docker info` (Linux Engine)
и только локальный `docker image inspect`. Отсутствие Engine, образа либо manifest RepoDigest —
причина skip, а не подтверждение работающего deployment. Нужен Docker image store, сохраняющий
RepoDigests локальных сборок; image config ID не заменяет manifest digest.

Перед текущей Q03 парой собрать оба frontend пиццерии:

```text
cd apps/pizzeria
npm run build
```

Образы для gate должны нести label `org.wenay.examples.dependencies`, равную fingerprint текущих
package+lock **приложения** из `scripts/run-all.mjs`. У organizer приложение-источник — pizzeria.
У **обеих** first/second label обязательна: missing → `image dependencies not verified`, mismatch
→ `image dependencies stale`, сценарий skip и полный gate incomplete (exit 2).
Generic runtime fixtures от product label освобождены.

Пример свежей CRM пары из корня в PowerShell:

```text
$depsFingerprint = node --input-type=module -e "import('./scripts/run-all.mjs').then(({fingerprint}) => console.log(fingerprint('crm')))"
docker build --memory 768m --label "org.wenay.examples.dependencies=$depsFingerprint" --build-arg APP_RELEASE=first -t wenay-examples.local/crm:first apps/crm
docker build --memory 768m --label "org.wenay.examples.dependencies=$depsFingerprint" --build-arg APP_RELEASE=second -t wenay-examples.local/crm:second apps/crm
```

Для organizer/pizzeria вычислить fingerprint от `pizzeria`, собирать из `apps/pizzeria`, добавляя
`--build-arg APP_MODE=organizer` или `APP_MODE=pizzeria`. Получить четыре manifest RepoDigests
через `docker image inspect <tag> --format '{{index .RepoDigests 0}}'` и записать отдельный временный
JSON, переданный в `--images`: ключи `organizer-first`, `organizer-second`, `pizzeria-first`,
`pizzeria-second`, значения — полные `repository@sha256:...` references. Gate manifest не изменяет.
`prepare:products` остаётся старым standalone инструментом: он пишет пользовательский default
data-файл и не добавляет новую обязательную label, поэтому без доработки не подготавливает этот gate.

Для остальных девяти продуктов заменить имя CRM на нужный продукт, выполнять по одному.
Существующие live-check самостоятельно
разрешают теги в immutable RepoDigest. Они проверяют переход first → second → rollback first
на общем долговечном томе, а не миграцию между произвольными историческими версиями исходников.
Обе версии могут собираться из текущего дерева с разным `APP_RELEASE`.

Для дополнительного runtime-сценария готовится `npm run prepare:examples` в hosting: Node/Python
fixtures сохраняются в `data/example-images.json`. Либо использовать ранее локально установленные
digest references через `HOSTING_NODE_IMAGE` и `HOSTING_PYTHON_IMAGE`.

## Аудит Docker и точных npm-версий

Все десять product Dockerfile закрепляют одинаковый
`node:24-alpine@sha256:50c8e8ca1d27439048670df5883f32d57cf81cff6233222c893fd0d9884cbd81`.
Они копируют package+lock и выполняют `npm ci`, затем копируют backend/shared и готовый public;
frontend внутри образа не собирается. Pizzeria копирует также organizer и organizer-public.
Поэтому npm exact common2 3.1.1 / react2 5.0.0 берутся из lock, а UI требуется собрать заранее.
Нового подключения соседних библиотечных репозиториев или отдельной установки версии в образ нет.

Dockerfiles общих маленьких fixtures используют **незакреплённые base tags** `node:24-alpine`
и `python:3.13-alpine`. После подготовки runner требует digest результата; это не делает
повторную сборку fixture базового образа воспроизводимой. Этот отдельный вопрос не изменялся
в рамках runner. Compose-файла для этого gate нет: Docker ресурсы создают существующие тесты/агент.

Documents Dockerfile устанавливает `apk add python3`, задаёт `DOCUMENT_PYTHON=/usr/bin/python3`
и ограничивает Node heap. Host Python нужен native advanced-тестам documents при `check:all`,
но **не является предпосылкой hosted documents**: Node/Python CSV и реальный PDF выполняются
в контейнере. Системный Python не должен превращать Docker documents skip в ложный pass.
Версия apk Python отдельно не закреплена; base digest и image digest не фиксируют будущий apk index.

`DOCKER_BIN` поддержан preflight; для абсолютного пути его каталог добавляется в дочерний PATH,
поскольку готовые live-check вызывают `docker` по имени. `DOCKER_SOCKET` и остальные env наследуются.
Публичный адрес проверяется в локальной Linux Docker топологии; удалённый host/TLS не заявляются.
`HOSTING_APP_KIND` задаётся runner отдельно для каждой пары и не требует ручной смены окружения.

Проверка RepoDigest закрепляет выбранный образ; обязательная fingerprint label связывает его
с проверяемым npm manifest+lock. Builder ставит её при свежей сборке: runner не проверяет содержимое
node_modules независимо от доверенной label. Метка не является source fingerprint: после изменения
frontend/backend без npm-изменений всё равно следует пересобрать образ. Этот gate принимает
npm-миграцию и реальный product сценарий, не вводя доказательство идентичности всего source tree.

## Что принимают готовые сценарии

| Сценарий | Поведение |
| --- | --- |
| Organizer и pizzeria `test:public-address` | Stable advertised gateway, реальные product RPC/Store, SC1 screen/chat, durable AI receipts, reconnect исходного клиента после замены, first/second/rollback |
| Support | Сохранение support предметного состояния при deploy/update/rollback через постоянный gateway |
| Metering | Долговечные metering данные/операции и live public service при замене/откате |
| Documents | Живые сессии, Node/Python CSV, реальный PDF, approved exports и исходные байты после замены/отката |
| CRM | Взаимодействия, предложения, согласование, одна производная задача, импорт контакта после замены/отката |
| Booking/forms/monitoring/approvals/content | Независимые публичные product clients и сохранение их предметных сценариев после замены/отката |
| Дополнительный runtime | Настоящий Node → Python → Node rollback, restart агента и неуспешная readiness |

Во всех product сценариях используются лимиты приложения 256 МиБ; общий runtime fixture — 64 МиБ.
Read-only аудит не повторял замеры памяти и не подтвердил пик машины. Очистка выполняется готовыми
тестами только для своих randomly namespaced ресурсов; runner не запускает prune и общий cleanup.

Полный stateful путь имеет настоящий socket transport и reconnect, но сам сценарий не принуждает
`transports: ['websocket']`: нельзя на основании только его pass объявлять forced WebSocket upgrade
в product Docker. Существующий `test:gateway-ws` из hosting `npm test` отдельно проверяет именно
WebSocket upgrade, двусторонние сообщения, bounded drain и reconnect на новый upstream при
постоянном URL; его upstream — native локальный Socket.IO fixture. Это два различных уровня
проверки, и runner их не смешивает. Принудительный WS через product контейнер — отдельная
приёмка при требовании полного browser transport доказательства.

## Проверка самого runner

При первоначальной проверке runner выполнены только `--plan` и лёгкая проверка фиксированного выбора, отклонения неизвестных
аргументов, абсолютного пути manifest, image label missing/stale/current/runtime fixtures
и exit-code aggregation для pass/fail/skip. Docker builds, Docker tests и registry IO
не запускались. Затем свежие образы organizer/pizzeria/support подготовлены через
`scripts/prepare-live-images.mjs`; выбранный live gate прошёл 3/3.
[Отчёт с digest и границами результата](../../doc/changes/hosting-live-selected-20260926.md).
Оставшиеся восемь продуктов ещё не приняты; этот документ не объявляет весь Q03 выполненным.
