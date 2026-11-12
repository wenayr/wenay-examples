# Исполняемый план всех поручений, 26 сентября 2026

> 12 ноября 2026: актуальная очередь вынесена в [REMAINING-TASKS](REMAINING-TASKS.md).
> Объединение `3019765` + `db0ecac` подготовлено и приостановлено пользователем до
> полной проверки; merge ещё не закоммичен. Контекст — [NEXT-CHAT](internal/NEXT-CHAT.md).
> Checkpoints ниже исторические и не принимают текущие объединённые исходники.

Единая очередь охватывает миграцию на наши библиотеки, повторную проверку прежней работы,
календари Organizer/Booking, UX всех приложений, безопасное упрощение, SaaS «хочу сайт, вот сервер»
и общий chat web/desktop/installed mobile с аккаунтами, workspace, plain/remote и специальными сервисами.
Основания: [стратегия](STRATEGY-2026-09.md), [план чат-продукта](AI-CHAT-PRODUCT-PLAN.md),
[аудит прежних задач](changes/previous-tasks-audit-20260926.md), [правила](CODE-RULES.md).
ID B00, Q01–Q12, G01–G04, C01–C08 сохраняются; суффикс уточняет срез, не перенумеровывает задачу.

Текущий полный checkpoint — raw27106 PASS EXIT0 source9d47359:38actual/39,
Catalog build absent, no environment SKIP, scaffold10/sync101/15/style498/0/links852/0.
Исторические raw53023/95073 ниже имеют свои source basis. После27106 приняты Forms
copy abef339→5616e92 и ORIGINAL Support machine019268b→11e9de0; INTEGRATION Support
target64391 PASS type0.8/test33.6/build1.6с; proof37d462 EXIT0 5.0608с. Этот перенос не новый full PASS.
Performance baseline0645a89 — actual initial/dynamic bytes, не runtime acceleration.
Support bounded merged subset принят: target64391 EXIT0 type0.8/test33.6/build1.6с,
proof37d462 EXIT0 5.0608с; ports57777/57797/58210/58218/58224 listener0/own dirs absent.
Repo0dd605 EXIT1 только missing Support scaffold entry; metadata482390e→faa3e3f,
repo936304 EXIT0 7.643с scaffold10/sync101/15/style500/0/links869/0/generated status verify.
Latest full raw27106 не покрывает later Forms5616e92/Support11e9de0/faa3e3f;
fresh full raw перед main pending. Parent Q06 не закрыт.

## Готовность и доказательства

«Реализовано» — есть код; «проверено» — названные проверки завершены на данном состоянии;
«принято» — выполнен контракт конкретной границы. Частичная приёмка не закрывает родительский ID.
Skipped, прерванный запуск, fixture и read-only review не записываются как live PASS.
Тестовый provider принимает поведение тестового исполнителя, не платную модель или semantic stream.

Исходный checkout — `codex/library-upgrade-20260926`; графики приняты отдельно.
Свободный managed checkout `C:/Users/wenay/.codex/worktrees/work-calendar/wenay-examples`
теперь используется `codex/unified-chat`: C01 локально принят и сохранён `f083593`.
Итог C01: 37 PASS / 39 шагов, hosting SKIP; Catalog build отсутствует по контракту.
Это не полный общий PASS перед main. C03 локально принят и сохранён `e97161a`:
runtime runner 3/3, repository checks и browser account/workspace/revoke/regrant,
Chrome 360×500 PASS. Изменения checkout не переносятся автоматически.
Q04 принят в исходной ветке; актуальный Support вместе с графиками/chat уже перенесён
в отдельную integration ветку. Самостоятельные ORIGINAL/GRAPH checkout не переключать.

Ниже локальные checkpoints отделены от приёмки будущего объединённого дерева.
В ORIGINAL сохранены Q02 `fffa851`, три Q03 selections `18801fd`/`0e385c1`/`96828ea`,
Q05 backend `5755acb`, Q06-A `272f704`, Q06-B `71c9d8c`, Q08 accounting `661a870` и Q11 `b14bece`.
Documents owner keys принят `58d0aeb`: browser, свежие typecheck 0.760 s/build 1.5 s
и независимый source review PASS. Q06-B принят: Counter/Documents fixture 5.5255 s,
Documents full/advanced с настоящим Python PASS; весь Q06 ещё pending.
В GRAPH сохранены G01–G04, C-OPT-CHAT `140d464` и C07 technical `e1669c1`:
actual Electron 44.4.5 PASS 2.192 s; installed HTTPS/menu/mobile не приняты.
Root создал `codex/examples-integration-20260926` в
`C:/Users/wenay/.codex/worktrees/examples-integration/wenay-examples` от `58d0aeb`.
Семь graph commits применены: `b627c4e`, `cf06b6e`, `25bb12a`, `9be324a`,
`2bdd6b3`, `a378d2f`, `3569bcf`; integration baseline `e4944c3` включает Q06-B.
Последовательный npm ci 13 приложений PASS; 38 app checks PASS. Первый raw check:all
завершился exit 1 только на трёх doc links; они исправлены, check:repo PASS, 807 links/0 errors.
Raw check:all session 4956 завершился **PASS exit 0, 38/39** на `e4944c3`;
Catalog build отсутствует по контракту, environment SKIP нет. Baseline acceptance
сохранена в INTEGRATION `98146ad`. npm views в 19:32 UTC подтвердил latest
common2 3.1.1/react2 5.0.0 без изменения версий.
Merged all-11 Docker gate PASS exit 0 на exact source `e4944c3` в 19:26:40.573Z;
generic runtime исключён, external TLS/bootstrap не приняты. Затем перенесены
Support UX `b16c0da`→`53f5224`, Q11 artifact `a6f7201`→`19f4487`, C07
`e1669c1`→`b1ac4f2`; эти три изменения появились **после** baseline full gate.
Post-transfer raw18952 завершился EXIT1 только из-за отсутствующего Chat desktop scaffold
metadata; repair сохранён `14d0276`. Новый raw95073 после repair завершился **PASS EXIT0**:
38 actual app checks/39 шагов, Catalog build отсутствует по контракту, environment SKIP нет;
scaffold10, sync101/15, style494/0, links814/0. Intentional fake fail/skip runner regression
не является app failure/skip. Catalog footer уточнён `c6390f1` в INTEGRATION
(`9ea82f7` ORIGINAL) до Catalog checks, без изменения app runtime.
Fresh Support-only live после новой истории PASS36.666s:
[отчёт](changes/support-history-live-20260926.md); прежние остальные images сохраняют e4944c3 basis.
Root package union сохраняет bundle/hosting-live и status перед verify;
root Chat manifest включён в свежие repository checks. Main/push не выполнялись.
Последующий raw53023 **PASS EXIT0** относится к exact source `392170d`: 38 actual/39,
Catalog build absent, no environment SKIP, scaffold10/sync101/15/style496/0/links835/0.
Затем перенесены CRM label `745ba88`→`e40062a` и Q06 native proof `7264bfd`→`b2b447b`;
их bounded evidence записано ниже, INTEGRATION target99016 PASS EXIT0 type1.2/test23.2/build2.0с.
Raw53023 не выдаётся за full gate этих последующих изменений.
Documents narrow producer slice принят `53f3a8d`→`9d47359`: ORIGINAL proof0dd006
PASS3.9421s и type/test/build9254 PASS0.9/45.7/1.9с; INTEGRATION repeat e18bd3
EXIT0 5.8218s. Full raw27106 **PASS EXIT0 COMPLETE** на source9d47359:
38 actual/39, Catalog build absent по контракту, environment SKIP нет;
scaffold10/sync101/15/style498/0/links852/0. Native Python/Docker доступны.
Intentional fake fail/skip runner regression не является actual app failure/skip.
Metering bounded quota browser принят report34b2195; Forms browser c0fa1c2 принят отдельно.
Последующий c0fa1c2 — docs-only Forms report, не новый app source basis этого gate.

## Обзор всей очереди

| ID | Результат | Зависимости | Состояние и остаток |
| --- | --- | --- | --- |
| B00 | Exact published common2/react2 и адаптация потребителей | Нет | Миграция 11 потребителей на 3.1.1/5.0.0 принята; следующий release требует нового gate |
| Q01 | Browser/UX Organizer, CRM, Metering после миграции | B00 | CRM/Metering локально приняты; Organizer local в G01; полный scope и устройства отдельно |
| Q02 | Составной cold backup и старый архив | B00 | fffa851: два genuine old 2.21.1/3.5.1 архива → current PASS, schema 5→5; schemas 1–4 и hot backup не приняты |
| Q03 | Последовательный hosting live gate | B00 | Merged all-11 Docker PASS на e4944c3; generic runtime исключён, external HTTPS отдельно |
| Q04 | Support machine search и owner keys UI | B00 | Принят 2e159e2: runtime/runner/browser; fake usage не закрывает Q06 |
| Q05 | Documents machine upload/start/status/result | Q04 | Backend 5755acb и owner keys 58d0aeb приняты; merged baseline и post-transfer raw95073 PASS |
| Q06 | Настоящий Counter для двух продуктовых API | Q04, Q05 | Q06-A 272f704, Documents receipt Q06-B 71c9d8c, bounded native checkpoint7264bfd→b2b447b и Documents producer53f3a8d→9d47359 приняты; Support/lost-settle/reconciliation pending, до paid usage |
| Q07 | Metering pattern / Documents diff | B00 | Локально приняты b11a848 / affe595; интеграционный код проверяется заново |
| Q08 | Эксплуатационный сценарий каждого оставшегося продукта | B00, профильные Q/G | Accounting 661a870: 11 builds/12 Vite manifests/check:repo PASS; human journeys и fresh full app gate отдельно |
| Q09 | Свежесть Catalog и настоящие screenshots | B00, G03 | Ожидает snapshot/fallback/skip приёмки |
| Q10 | Чистый scaffold с предметным расширением | Q04–Q08 | Bounded own Support-copy native subset PASS de64a4a→27eb75b; full journey/browser/backup-format pending |
| Q11 | Проект → сервер → HTTPS → update/rollback | Q03 | Origin/artifact и Ubuntu candidate runtime subset PASS80327be→98ce6a3; clean-host/external HTTPS pending |
| Q12 | Общий chat web/desktop/installed mobile | B00, C01–C08 | C01 f083593 и C03 e97161a локально приняты; остальные границы самостоятельны |
| G01 | Графический Organizer | B00 | b03eabf локально принят; touch/два физических устройства не приняты |
| G02 | Графический Booking | G01 | e9dae43 локально принят; browser DST и physical touch остаются |
| G03 | Общая проверка графиков | G01, G02, OPT-G | 1fa38a2, check:all 35/36 PASS; Catalog build отсутствует по контракту |
| G04 | Документирование графического этапа | G03 | 4ff49d2 локально принят; main/push не выполнялись |
| C01 | Plain web, два клиента, durable receipts/restart | B00 | f083593 локально принят; 37 PASS / 39 шагов, hosting SKIP, Catalog build отсутствует; не полный gate main |
| C03 | Account/workspace и владение ресурсами | Принятый C01 | e97161a: runtime 3/3, repository и browser PASS; fixed workspace registry, installed clients не приняты |
| C02 | Semantic AI stream/cancel/approval/checkpoints | C01, published AI fix | Требует repro→release→повтор; старые AI обходы не принимают stream |
| C04 | Chat ↔ Support knowledge | C03, Q04 | Ожидает настоящего адаптера tenant/expiry/revoke |
| C05 | Chat ↔ Documents jobs/files | C03, Q05 | Ожидает файла, job/cancel/restart и отрицательных прав |
| C06 | Plain/AI remote agent с ограниченным grant | C03; C02 для AI | Ожидает typed operations/lease/paths; screenshare не закрывает контракт |
| C07 | Desktop, installed mobile, общая история | C01, C03; режимные C02/C06 | GRAPH e1669c1→integration b1ac4f2 Electron 44.4.5 technical PASS; installed HTTPS/menu/mobile/matrix не приняты |
| C08 | Design/Site/App/Video сервисы | C03; C02 для AI; Q03 для deploy | Нужны отдельные настоящие артефакты и исполнители |

## Волна 0: интеграция и честная повторная проверка

1. Сверить branch, HEAD, `git status` и diff обоих checkout. Сохранить пользовательский
   `apps/facade-map/TASK.md` и незавершённые изменения; исходный checkout не переключать ради графиков/chat.
2. Составить перечень нужных коммитов/рабочих изменений по ID и перенести в интеграционную ветку,
   разрешая конфликты по текущему контракту. Старый PASS не принимает объединённый код.
3. Последовательно выполнить целевые typecheck/test/build затронутых приложений, критичные browser сценарии
   и итоговый `npm run check:all`. После смысловой правки повторить затронутый gate.
   Перед main нужен завершённый общий PASS. Это планирование main/commit/push не выполняет.
4. Сгенерировать STATUS через `npm run status`, не править генерируемые секции вручную.
   Логи привязать к HEAD/diff, exact package/lock, команде и среде: package fingerprint не доказывает
   идентичность исходников после изменения.

B00 доказал миграцию 11 потребителей; Catalog библиотек не использует. Следующее обновление:
проверить public API → exact published npm/lock отдельно на приложение → повтор tests/build/typecheck
и профильного пользовательского сценария. Не вводить новый transport/reconnect/replay/typing,
когда механизм уже есть в common2/react2. npm link/локальный архив/соседний исходник не заменяют release.

## Волна 1: завершение текущих границ и календарей

### Q01/G01 — Organizer внутри Pizzeria

Триггер: назначить/перенести/растянуть интервал в дне/неделе, отфильтровать исполнителя,
отменить жест либо выполнить ту же команду формой/клавиатурой.
Результат: schedule независим от due; задачи вне сетки не теряются; atomic RPC проверяет роль/revision.
Приёмка: pointer/keyboard/Escape/cancel/форма, readonly/nonowner, author с чужим assignee,
requestId retry, reconnect/replay/restart и обе UI сборки Pizzeria. Отказ не оставляет фиктивный интервал.
G01 b03eabf принят: интеграции 9/9 и повторный browser исправленной P2 foreign-assignee PASS.
Доказательство — `doc/changes/work-calendar-organizer.md` в managed checkout.
Остаток: physical touch, экран/микрофон/два устройства и сеть по [device acceptance](DEVICE-ACCEPTANCE.md).
После этого отдельный архив завершённых задач с ACL поиска и restore; он не закрывает Q02 старого архива.
Медиа/revoke и SC1 generation проверяются как отдельная lifecycle граница.

### G02/Q08-BOOKING — Booking

Триггер: сотрудник переносит бронь, второй клиент скрыто занимает слот; пользователь выбирает timezone/DST;
hold истекает или сервер перезапускается. Результат: перенос атомарен, duration/deposit/client/payment
сохранены, отказ обновляет availability. Сервер использует epoch/IANA, не browser local time.
G02 e9dae43 принят локально: test/typecheck/build, domain DST/Temporal, browser pointer/keyboard/форма,
create/client/mobile width и повтор race скрытого слота PASS. Остаток G02 — browser DST и physical touch:
missing/repeated local times, разные browser timezone и объяснение невозможного переноса.
Q08-BOOKING отдельно принимает hold/reminders: expiry→retry→restart, одна бронь и одно напоминание,
корректное освобождение capacity, старый attempt после cancel не отправляет сообщение.
Проверки: domain/RPC двух клиентов, контролируемые часы/restart и понятный browser outcome.
Зависимость B00/G02; этот lifecycle не закрыт календарным UI.

### G03/G04 — общий итог графической ветки

Check:all 35/36 PASS, отсутствие Catalog build указано честно; две P2 исправлены и повторно приняты.
После финального UI повторены нужные typecheck/build/check:repo. OPT-G удалил дубли clock/localDay;
Organizer calendar minutes и Booking epoch/IANA сохраняют разные контракты.
G03 1fa38a2/G04 4ff49d2 подтверждают локальный этап, не физическую приёмку и не итоговую интеграцию.
При переносе повторить общий gate и browser критичных отказов, записать точный код и пропуски среды.

### C01 — локально принятый plain chat

Триггер: Алиса/Боб открывают общий разговор; сообщение отправляется, ответ теряется и запрос повторяется;
сервер фактически останавливается/запускается на том же журнале. Помощник вызывается отдельно.
Результат: одна история, одна запись/receipt, draft очищается после подтверждения;
retry сохраняет payload/requestId, private conversation недоступен Бобу.
Код/README `apps/chat` существуют в `codex/unified-chat`; npm test PASS: два настоящих RPC клиента,
retry, фактический restart и revoke; build PASS. Conversation/persistence/reconnect/replay — публичные библиотеки.
Малый native client adapter требует review фасада/lifecycle; это не новый протокол.
Root browser принял обмен Alice/Bob, Enter/Shift+Enter multiline, demo reply, новый shared conversation,
private conversation недоступный Bob, reload и console errors []. Review исправил domain queue
payload/capacity race; повторный RPC тест root PASS. Version/rootTitle добавлены.
Отдельная Chrome приёмка на фактических 390×844 и 360×500 PASS: список→история→назад,
длинное слово без горизонтального overflow, composer остаётся внутри высоты экрана.
Отправленное сообщение появилось у Bob в независимом IAB табе; logout убрал историю; console errors [].
IAB viewport override сам оставил innerWidth 1280 — он не является narrow-width доказательством;
узкий экран подтверждён отдельным Chrome сценарием. Физическая мобильная клавиатура и установленный
mobile-клиент не проверены. C01 локально принят и сохранён `f083593`, включая финальную
проверку plain сценария; 37 PASS / 39 шагов, hosting SKIP, Catalog build отсутствует.
Перед main остаётся полный gate итогового интегрированного дерева; ширина экрана не подменяет C07 installed mobile.
Application guard не закрывает библиотечный receipt defect; C01 не принимает полноценный C03 workspace.
Python/Documents не являются зависимостью обычного web chat и тестового помощника.

## Волна 2: runtime и настоящие продуктовые API

### Q02 — Pizzeria, старый составной архив

Триггер: оператор открывает архив предыдущего опубликованного состояния новой версией.
Результат: order/task/receipt/photo/chat/attachment/AI сохраняют порядок/связи,
повтор заказа не создаёт второй эффект; оригинал архива неизменён.
Текущий cold backup и genuine historical restore приняты в `fffa851`:
[отчёт](changes/pizzeria-historical-q02-20260926.md). Старый source `2345729` с exact
2.21.1/3.5.1 создал два самостоятельных composed archives; current 3.1.1/5.0.0 restore,
следующий cold restart, receipts/bytes/completed AI/member revoke прошли, originals неизменны.
Это schema 5→5 library archive compatibility, не migration business schemas 1–4;
старый metadata number не использовался как historical proof. Hot backup и inflight AI
recovery этим срезом не принимаются. Зависимость B00 сохраняется; на merged code повторить critical gate.

### Q03 — Hosting, полный live gate

Триггер: pinned deploy→запись данных/вложения→update→rollback→чтение через тот же route/WS,
включая lost response и restart control plane/агента. Результат: gateway/volume стабильны,
нет второго writer/deploy, durable данные доступны после rollback.
Local Docker product modes приняты **11/11** в трёх свежих selected runs:
`18801fd` [selected3](changes/hosting-live-selected-20260926.md),
`0e385c1` [seven](changes/hosting-live-seven-20260926.md),
`96828ea` [Documents](changes/hosting-live-documents-20260926.md).
Actual image IDs/digests/dependency labels, deploy/update/rollback и durable product paths
проверены на их соответствующем code checkpoint. Прежний aggregate skipped не заменён
заявлением единого merged PASS. Теперь отдельный current merged all-11 gate принят:
exact source `e4944c3`, exit 0 в 19:26:40.573Z. Generic runtime исключён из этой матрицы.
После изменения relevant source/package/lock нужны свежие image ID/digest/labels и повтор
затронутого aggregate/public-address/WS/lost-response/restart/durable-volume сценария.
Merged Docker не принимает внешний HTTPS/DNS/Linux bootstrap либо final raw check:all.
Результаты записывать по сценарию; отсутствие Docker — skipped. Fixtures/LXD не принимают VM/Kubernetes/внешнюю сеть.
Не запускать тяжёлый кластер/docker prune и не трогать чужие контейнеры; RAM цель 1–2 GiB, максимум 3.
Необходимая Q03 deployment граница принимается до Q11 и фактического размещения C08.

### Q04 — Support

Триггер: owner выдаёт key, machine ищет published knowledge, owner отзывает доступ во время IO.
Результат: one-time secret/hash-only storage, tenant/scope/expiry/revoke на сервере,
нет human membership/admin; retained bearer/open resource перестают читать.
Принят 2e159e2: owner RPC issue/list/repeat/conflict/revoke, bearer expiry/revoke, RPC close during IO,
durable replay/restart, runner 3/3 и browser issue/copy/revoke/org switch/logout/relogin,
nonowner gating, console errors [] PASS.
Следующее Q05→Q06; fake UsageGate не принимает Counter. Отдельный backlog — rotation/cleanup expired/revoked keys
с audit/receipts: текущий предел 100 включает такие keys.
Поиск показывает applied query/count/loading/empty/clear; перенос UI требует повторного browser.
C04 использует настоящий machine API, secret не копируется в browser.

### Q05 — Documents

Триггер: machine upload→start→status/result, retry после lost response; key отзывается во время IO.
Результат: только scoped upload/start/status/result; review/approve/admin/чужой tenant/file запрещены;
close/cancel прекращает IO/выдачу, job/receipt переживает restart.
Шаги: authority/common2 ресурс и ACL раньше потребителя, typed commands/status/files, затем owner UI.
Общий adapter выделить после второго настоящего потребителя; document/review правила оставить в продукте.
Приёмка: owner/machine RPC и retained bearer, negative scope/tenant, expiry/revoke до/после IO,
late result, retry/restart, human login, browser keys и terminal status; текущие typecheck/test/build.
Backend принят `5755acb`: actual targeted/full/advanced PASS,
[отчёт](changes/documents-machine-q05-20260926.md). Owner keys UI теперь имеет
[browser PASS](changes/documents-product-keys-ui-20260926.md), fresh typecheck 0.760 s,
build 1.5 s и independent review приняты в `58d0aeb`; baseline merged full PASS,
повтор после последних transfers запланирован отдельно.
Зависимость Q04 сохраняется; Q07 diff/Python advanced
не подменяют машинный API, а browser snapshot не принимает дальнейшие source changes.

### Q06 — Metering/Counter и два продукта

Триггер: реальные Support/Documents reserve→IO→settlement, response lost/revoke/uncertain.
Результат: retry без второй работы/списания; uncertain удерживает резерв до доказанного исхода,
revoke запрещает новую работу и закрывает выдачу после IO.
Шаги: интегрировать оба API с Counter, выделить доказанный общий adapter;
разные расходные единицы/предметные правила сохранить в продуктах.
Приёмка: настоящие процессы/клиенты, success/error/uncertain/quota exhaustion,
lost response/restart/retry/revoke, hash-only credentials/outbox recovery;
UI показывает reserve/usage/uncertain без ложного успеха.
Q06-A `272f704` принят отдельно: настоящий native typed value+Counter receipt,
immutable input/event dedup и late abort после commit; legacy integration 3.948 s и
machine fixture 2.706 s PASS. [Отчёт](changes/usage-q06-typed-handoff-20260926.md).
Q06-B `71c9d8c` принят: actual native Documents receipt сохраняется в processingResult,
guarded status/result переживают restart без reexecution. Counter/Documents machine fixture
5.5255 s PASS; Documents npm test/full и отдельный advanced с настоящим Python PASS.
[Отчёт](changes/usage-q06-documents-receipt-20260926.md).
Bounded native AI checkpoint + actual Counter receipt proof принят `7264bfd`→`b2b447b`:
root repeat PASS2.489s, exact retry/restart/full-input conflict/current policy,
controlled refusal до terminal write после двух distinct committed Counter events.
Первый85242 EXIT1 сохранён: native run IDs host-local ai-1, fixture event namespace
исправлен stable checkpoint name + run ID. Port52920=0/own fixture absent после repeat.
[Отчёт](changes/usage-ai-checkpoint-q06-proof-20260926.md). Это не production identity,
не atomic commit/crash/lost-response reconciliation и не приёмка всего Q06.
INTEGRATION repeat chunkd42aa7 PASS EXIT0 6.158s на b2b447b; root подтвердил own port/
fixture cleanup. Prefixes completed/gap различают fixture checkpoints,
но не доказывают независимость двух production producers.
Q06-PRODUCER-D принят `53f3a8d`→`9d47359`: public randomUUID и два production Documents
archives с одной Counter org/ключом дают distinct native events/cost2, restart сохраняет
exact receipt без extraction; changed payload требует exact native conflict.
Legacy ai-1 persisted plain completed snapshot full deepEqual после production reopen,
синтетический seed отдельно от двух billed CSV runs. ORIGINAL proof0dd006 PASS3.9421s,
Documents9254 type/test/build PASS0.9/45.7/1.9с; INTEGRATION e18bd3 EXIT0 5.8218s.
[Отчёт](changes/documents-producer-id-q06-20260926.md). Data reset/lost checkpoint
не принимается за restart или exactly-once; Support code этим slice не изменён.
Parent Q06 остаётся pending: Support machine handoff, lost reserve/settle response и
reconciliation/crash gap. Null не означает no-cost, rerun/refund запрещены без доказанного исхода.
Q06-S-MACHINE ORIGINAL принят019268b→11e9de0: guarded durable search resource,
native private checkpoint/UUID/actual settled receipt; strengthened proof4c11ef EXIT0
4.0141с, target41567 type0.8/test30.5/build1.8с, source review/5ports0/own directories absent.
[Отчёт](changes/support-machine-search-q06-20260926.md). INTEGRATION target64391 EXIT0 type0.8/test33.6/build1.6с,
repo936304 EXIT0; bounded merged acceptance подтверждена. Старые published
array и human assistant не менялись; human UUID/old published namespace unresolved.
Pending-restart runtime и postcommit race matrix, lost reserve/settle/crash gap не приняты.
Q04→Q05→Q06 обязательно; полный контракт требуется до paid provider usage.

## Волна 3: отдельный UX/lifecycle контракт для каждого продукта

Каждый Q08 срез — отдельный отчёт и коммит на приложение. Bundle optimization не закрывает продуктовый сценарий.

### Q07-M/Q07-D

Metering: valid ID принят, invalid отклонён реальной HTML формой без regex console error; b11a848.
Documents: разные approved revisions по умолчанию, смена document сбрасывает выбор,
late response не рисует старый diff; affe595, browser v4/v7 с изменением цены PASS.
На объединённом коде повторить форму/выбор/late response и целевые typecheck/build.

### Q08-HUMAN — полезность четырёх существующих продуктов

Это отдельные суффиксные срезы Q08, сначала проверяющие существующий контракт,
а не требующие нового engine. Machine API/backup/diff не заменяют human user journey.

| Срез | Пользовательский путь | Приёмка |
| --- | --- | --- |
| Q08-PIZZERIA | Заказ → кухня/курьер → конечный исход, отмена/повтор | Несколько ролей, atomic stock/order limits, понятный отказ, формы/очередь/карточка, reconnect/restart; Q02 backup отдельно |
| Q08-SUPPORT | Customer ticket+attachment → staff answer/private note → customer outcome | Private/foreign ticket denied, attachment current ACL после IO, retry/reconnect/restart; Q04 machine search и Q03 deployment отдельно |
| Q08-DOCUMENTS | Upload → extraction terminal → reviewer edit/approve → immutable revision/export | Failed/cancelled/uncertain видимы, старое approval неизменно, uploader не approve, stale revision/revoke/download; Q05/Q07 отдельно |
| Q08-METERING | Owner quotas/keys → reserve/settle/outbox → uncertain/retry delivery | Bounded quota owner save/discard/reopen, auditor readonly и actual360px PASS report34b2195; keys/uncertain/retry/Q06 остальной scope отдельно |

Для каждого — current-code runtime и browser нескольких ролей, console errors,
targeted typecheck/test/build, отдельный отчёт/коммит на приложение.
При полезном существующем outcome достаточно свежей приёмки и исправления конкретных находок.

Booking transfer UX subset принят отдельно после raw95073: targeted20383 type0.7/test20.4/
build0.9с PASS; browser70919 cancel сохранил27сент10:00, реальный move на4окт09:00,
повторный вход показал обе даты периода4октября, cancel сохранил новое время, console[].
Measured360×640: scrollWidth345, panel312.8, cancel264.98px. Screenshots desktop/mobile
и cleanup двух own fixtures записаны в [отчёте](changes/booking-transfer-ux-20260926.md).
Это responsive web, не installed mobile; held-response org/role/logout browser matrix,
browser conflict/retry и отдельный DST переход остаются непроверенными. Parent Q08 не закрыт.

### Q08-CRM

Триггер: partial import оборван, оператор продолжает после restart; клиент сравнивает предложения.
Результат: summary принятого/отклонённого/оставшегося, без duplicate contact/task;
клиент видит только свои publications и принимает current revision.
Шаги: existing import receipts/checkpoint, action продолжения, published diff и stale accept feedback.
Приёмка: restart mid-import/retry/conflicting row, две роли, current/stale accept;
browser table/search/card/keyboard/Escape/archive. Q01; продуктовый остаток ожидает,
прежний lazy browser PASS новый import lifecycle не принимает.
Минимальный progress label subset принят `745ba88`→`e40062a`: ORIGINAL target32866
PASS type1.2/test21.9/build1.7с; root fresh browser89843 completed «Проверено4/4»,
allchecked status/no resume, counters2/1/1 и mobile360px scroll345/cleanup PASS.
[Отчёт](changes/crm-import-progress-ux-20260926.md). INTEGRATION target99016 PASS EXIT0 type1.2/test23.2/build2.0с;
этот subset после raw53023 не принимает весь import lifecycle/publication scope.

### Q08-FORMS

Bounded Forms browser принят `c0fa1c2`: v1/v2/publication/old response history,
auditor и actual360px; [отчёт](changes/forms-publication-browser-20260926.md).
Respondent copy slice принят abef339→5616e92: ORIGINAL type1.18/build1.884с и fresh
closed-link browser/staff error preserved; INTEGRATION56033e EXIT0 type0.7/build1.0с.
[Отчёт](changes/forms-public-link-copy-20260926.md). Он после raw27106; whole Q08-FORMS не закрыт.

Триггер: old version link, export и retention/compaction. Результат: старая ссылка имеет явный исход,
export проверяет текущие права, данные не удаляются до срока и ответы не переписываются.
Шаги: проверить existing version/retention, показать old/closed/expired states;
cleanup проверять isolated data и объяснять outcome UI.
Приёмка: old/current/revoked link, export after revoke/during IO, retention boundary/restart/retry,
две роли и download. B00; ожидает доказательства текущего сценария.

### Q08-MONITORING

Триггер: worker теряет lease, другой принимает probe, late old attempt возвращается.
Результат: старый result не заменяет новый; экран показывает last seen/age/reason/current attempt,
история хранится по явной политике.
Шаги: existing workers/lease и server diagnostic facts, retention/history view.
Приёмка: реальный kill/disconnect worker, late attempt/reassignment/restart/history boundary,
live UI нескольких workers и снятие stale status. B00; ожидает, fixtures не заменяют live workers.

### Q08-CONTENT

Триггер: scheduled publish с attachment, retry/revoke/delete old blob.
Результат: public не выдаёт draft, publish один, действующая version сохраняет файл;
schedule/revoke после restart имеют явный исход.
Шаги: existing scheduler/public resource/blob references, schedule/revoke UI,
cleanup только доказанно unused files по принятому контракту.
Приёмка: controlled time, repeat/restart, revoke during IO, public/author ACL,
download после смены version. B00; ожидает.

### Q08-APPROVALS

Триггер: управляемая анкета и решение по revision, затем новая версия автора.
Результат: старое решение неизменно; current role/revision проверяются сервером при команде.
Шаги: useful question configuration на existing contract, version/required fields UI,
сохранение старого решения без переписывания.
Приёмка: две роли, invalid/required answer, stale revision/revoke/retry/restart,
browser old/new decision. B00; ожидает; не создавать заранее общий forms engine.

### Q08-BUNDLE/Q09 — Catalog

Триггер: открыть продукт/таблицу и понять свежесть приёмки.
Q08-BUNDLE accounting сохранён `661a870`: свежие 11 app builds, все 12 Vite UI manifests
(Pizzeria имеет два UI), regression/check:repo PASS; [отчёт](changes/bundle-accounting-q08-20260926.md).
Static/dynamic JS/CSS graph даёт initial/full raw bytes; manifest проверяет artifacts,
не source freshness. Это не свежий full typecheck/test/build всех приложений и не Q08 human journey.
Lazy CRM/Organizer first open/selection/reconnect имеют собственные Q01 checkpoints;
network timing не измерен. После интеграции пересобрать и повторить accounting финального дерева.
Q09: exact version/check date/scope/skip, реальные screenshots нужной роли и fallback;
схема не называется снимком UI. Использовать generated STATUS.
Приёмка: mismatch/missing/skipped не зелёные, status --verify/links/browser fallback/keyboard/mobile cards.
B00/G03; ожидает; Catalog build отсутствует по контракту.

### Q10 — автономный scaffold

Триггер: чистая копия и небольшое предметное расширение принятого шаблона.
Результат: npm ci/checks, роли/reconnect/replay/restore без переписывания библиотечной инфраструктуры.
После Q04–Q08 создать isolated copy, выполнить конкретное расширение, записать elapsed/files/обвязку/API gaps.
Приёмка: exact deps, несколько ролей, restart/restore/browser полный путь, исходные data не изменены.
Ожидает; отчёт затрат не выдаёт количество строк за качество. Затем OPT-REUSE.
В ORIGINAL подготовлен `scripts/scaffold-runtime-check.mjs`: own Support copy,
urgent SLA30min, public current-role/private/dedup/failover/restart/cold directory restore.
Independent SOURCE PASS после bounded phase/IPC/npm config fixes. Первый55452 EXIT1 после
npmci выявил generated optional types; explicit dueAt guards/disconnect?.() сохраняют assertions.
Повтор15011 EXIT0: npmci/type/build/domain/conversation/native PASS, current roles/private/
receipt retry/failover/restart/cold directory restore и own cleanup подтверждены.
Сохранено ORIGINALde64a4a→INTEGRATION27eb75b; [отчёт](changes/scaffold-runtime-q10-20260926.md).
Это не full donor/browser/backup-format/machine proof; timeout escalation runtime branch не заявлен.

## Волна 4: Q11 — «хочу сайт, вот сервер»

Первый срез — подготовленный Linux-хост с Docker/агентом, один проект/домен.
Триггер: выбрать template/проект и указать согласованный server/domain.
Результат: reproducible build→pinned image→deploy→реальный HTTPS URL→update→rollback,
route/data сохранены, error видима, retry не создаёт второй deploy.
Шаги: принять нужный Q03; typed project/server/domain/image/requestId contract;
соединить scaffold/build, agent/readiness/DNS/TLS/volume; preview, deployment action и terminal progress.
Приёмка: external URL/HTTPS/WS, invalid host/domain/image, lost response/restart/update/rollback/data.
Без внешнего host/domain закончить local composition/instruction; внешняя приёмка skipped.
Секреты вне repo. Чистый сервер bootstrap — следующий срез; domain purchase/HA не обещаются.
C08-SITE переиспользует этот путь после creation/preview/конкретного разрешения публикации.

Q11-P — этот первый срез prepared host: новый пользователь проходит UI/инструкцию
без незадокументированных ручных поправок; invalid image/domain, agent offline,
lost response и restart agent/control plane дают понятный исход без второго deploy/writer.
Локальный origin backend/UI/browser принят в `b14bece`:
[отчёт](changes/hosting-public-origin-20260926.md). Он не закрывает фактические
external HTTPS/DNS/proxy и bootstrap; Q11-P внешний путь и Q11-B остаются pending.
Artifact foundation: реальный source/assets tar + separate SHA/target verify и immutable
checked-byte snapshot прошли fixture/review; root повтор PASS 5.543 s.
Q11 artifact `a6f7201`→integration `19f4487`: default fresh Vite pack PASS 4.195 s,
отдельный verify PASS; manifest freshness=true, installedRuntime=false.
Source `2163a0f`, собственный `work/hosting-installation/hosting-2163a0f.tar.gz`, digest
`2db1137cbb77ca2819ac07a9629cb548587c842d988f29be8dffae901b9ae0a7`.
Linux npm/install/readiness не приняты; перенос был после baseline full gate.
Следующий ORIGINAL `scripts/hosting-linux-runtime-check.mjs` source-reviewed после canonical
extraction path guard: candidate Ubuntu24.04/amd64/glibc2.39/Node24.18.0, own bounded Docker
runtime/public authority fixture. Первый63344 EXIT1 после npmci из-за readonly /tmp;
TMPDIR own tmpfs fix сохранил security limits. Повтор25390 EXIT0 подтвердил Ubuntu24.04/
amd64/glibc2.39/Node24.18.0, real npmci/native authority/receipts/dashboard/static assets
и own container/volume/directory cleanup. Сохранено80327be→98ce6a3;
[отчёт](changes/hosting-linux-runtime-q11-20260926.md). Это candidate runtime subset;
agent/socket/SSH/systemd/TLS/clean-host installation и Q11 целиком не приняты.
[Граница артефакта](changes/hosting-q11-artifact-foundation-20260926.md).
Q11-B — следующий срез bootstrap чистого согласованного Linux-хоста после Q11-P:
поддерживаемые distro/architecture/permissions/network проверены preflight,
reviewable план установки → агент/зависимости → readiness → тот же Q11-P путь.
Приёмка: идемпотентный повтор, occupied port/unsupported host/failed install,
секреты вне repo/logs, чужие сервисы/тома сохранены. Внешний host не предоставлен —
external gate skipped; universal installer, domain purchase и HA не заявляются.

## Волна 5: Q12 — аккаунты, plain/remote и платформы

### C03 — после принятого C01, перед полным C02

Триггер: A/workspace1→B/workspace2→logout при выполняющейся старой операции.
Результат: foreign history/blob/job/result закрыты сервером; old resource/stream/callback
не попадает в новый экран, draft/cache привязан к контексту.
Шаги: session/workspace facades, server membership/roles, resource ownership,
selectors/account switch/cleanup/logout/reacquire после reconnect.
Приёмка: две сессии аккаунта, membership/revoke during IO, retained bearer/resource,
late callback/restart/browser back; A→B→logout. Demo accounts не принимают внешний OIDC.
C03 `e97161a` локально принят: runner 3/3, repository checks и browser прошли.
Team/Personal изолированы; A→B→logout, revoke/regrant и 360×500 проверены.
Динамический workspace registry, внешний OIDC и installed clients в этот срез не входят.

### C02 — semantic AI stream

Триггер: delta/tool/approval/input, cancel/revoke, reconnect/checkpoint restart.
Результат: semantic events в двух клиентах; close/cancel пресекают позднюю выдачу,
current policy/ACL соблюдены, restart без второго side effect.
Сначала minimal AI repro→published fix→exact npm update→--expect-fixed→исходный scenario;
затем run facade/test provider и delta/tool/approval/input/cancel UI.
Приёмка: revoke during delta/tool, close before callback, reconnect after cancel,
late result/checkpoint/restart/current policy/two clients. State-only mirror/onError не принимает stream.
Ожидает исправлений; paid AI и реальные платежи не настроены.

### C04/C05 — сервисы знаний и документов

C04 trigger: вопрос к Support knowledge в workspace. Серверный scoped Q04 adapter возвращает
published results/sources; tenant/scope/expiry/revoke during IO/open resource,
отсутствие private notes и secrets в browser, result/requestId/current ACL — обязательная приёмка.
C03/Q04; обычный chat Support не требует.
C05 trigger: attachment→processing→job/status/result/file, cancel/retry/restart.
Настоящий Q05 consumer, forbidden review/admin/tenant, IO revoke/late result,
download файла/terminal UI/receipt без второй работы — приёмка C03/Q05.
Python нужен только соответствующему Documents executor.
Общую service orchestration выделять после двух настоящих адаптеров.

C05-CANCEL-FILE: до consumer уточнить scoped cancel и downloadable result artifact.
Минимальные Q05 upload/start/status/result сами по себе этого контракта не принимают.
Добавить явную service capability/метод, сохраняя один native job/receipt host;
не выдавать raw human processor/AI fragment. Приёмка: настоящее вложение → job →
usable файл с MIME/size/revision/current workspace ACL, cancel/revoke/expiry во время IO,
late provider и retry/restart без второй работы. Закрытие request прекращает его IO,
accepted durable job живёт до terminal по отдельному контракту отмены.

### C06 — настоящий remote agent

Триггер: явно выбрать remote/project/agent, выдать ограниченный grant, отменить/revoke либо потерять lease.
Результат: backend выполняет allowed typed operations/paths, сохраняет receipts/results,
проверяет grant после IO, stale attempt не исполняет работу.
Шаги: plain remote с deterministic executor, затем AI после C02; registry/grant/lifecycle/lease,
typed read/edit/run, operation/approval/result UI.
Приёмка: allowed/denied path, expired lease, disconnected agent/restart,
cancel/revoke/late callback/lost response retry и фактический эффект в test project.
Screenshare вспомогателен; workspace/grant выбирается отдельно от переключателя plain/remote.

C06-P — plain typed executor до C02; C06-A — AI orchestration после C02.
C06-P-TYPED: минимальные read/edit/run с явными project/agent/account/workspace,
bounded operations/roots/expiry, revision для edit и реальным file/exit/output результатом.
Переключатель remote не разрешает произвольный процесс. Отрицательная приёмка:
foreign account/workspace/project/agent; read-only grant против edit/run;
absolute/relative traversal/symlink escape; concurrent edit revision;
expired/revoked grant во время IO/process; stale lease/attempt перед эффектом;
closed resource/late output; lost response/restart с одним эффектом/receipt.
Отдельная remote машина и local fixture имеют разные доказательства.

### C07 — installed desktop/mobile

В GRAPH сохранён technical slice `e1669c1`: actual Electron 44.4.5 PASS 2.192 s.
Это технический runtime proof; installed HTTPS/backend/menu/mobile ещё не приняты.
Он не закрывает C07-D/M/X и не переносит Codex tray preference на продукт Chat.

C07-F: до framework проверить published client/runtime/native exports, teardown/suspend/resume,
package build/secure session/updater/real devices минимальным прототипом.
React2 `/native` содержит headless columnState/columnDots, это не готовые RN UI/hooks;
DOM hooks нельзя переносить по предположению совместимости.
C07-D: установленный desktop на общем backend, login/workspace/chat/receipt,
close/minimize/tray/quit и update lifecycle. C07-M: фактически установленный package на target ОС,
keyboard/background/suspend/reconnect/session/logout/files.
Adaptive web/PWA shortcut не закрывает installed mobile.
C07-X: web↔desktop↔mobile одна история, retry/cancel/logout/revoke без дублей,
update/reconnect сохраняют контракт, cache не второй writer; режимы проверяются после C02/C06.

C07-F-MATRIX: отчёт feasibility фиксирует target desktop OS/architecture и mobile OS/device,
точные published imports, secure session storage, prototype build→install→launch→update→uninstall.
C07-D/M сохраняют package version, backend endpoint, installation commands и реальные outcomes:
desktop X/minimize/tray/quit/relaunch без orphan processes; mobile keyboard/background/
suspend/resume/network switch/files/denied permission/logout. Build без install не PASS.
C07-X-MATRIX: три настоящих клиента одного journal, post из каждого виден двум другим
один раз; независимые workspace, lost response/reconnect/restart и retained payload retry,
A→B/logout/revoke очищают history/draft/pending/results. Plain matrix не ждёт C02/C06;
AI/remote matrix повторяется после их gates. LAN proof и production HTTPS отмечаются отдельно.

Отдельная эксплуатационная проверка установленного Codex: X прерывал local run.
Code capability close-to-tray существует и требует ready tray; причина на этой установке пока не доказана.
Minimize — временный способ. Проверить setting/readyTray/tray errors/version/logs и оформить repro issue;
бинарники установленного Codex не исправлять. Это не C07-D нового продукта.

## Волна 6: C08 — Design/Sites/Apps/Video

Каждый срез имеет typed job/status/cancel/retry, workspace ACL/requestId/receipt/restart,
настоящий артефакт и отчёт. UI показывает шаг/error/cancel/результат, не текст «готово».
Для AI generation C02; free deterministic runner принимается отдельно. Paid usage требует Q06.
Публикация — после конкретного reviewable результата и разрешения пользователя.

- C08-DESIGN: brief/reference→bitmap/vector/design artifact→preview/export;
  проверить file/size/format, revoke/cancel/late result и две сессии.
- C08-SITE: brief→sources/build→preview→разрешение→deploy;
  Q03 до фактического размещения, Q11 server/domain/image reuse; HTTPS/WS/update/rollback/data.
- C08-APP: brief→project/sources→reproducible build→полный пользовательский сценарий;
  typed runner/build error/retry/cancel/exact dependencies/export; native builds после C07.
- C08-VIDEO: scenario/assets→настоящий runner→playable mediafile/export;
  codec/duration/resolution/audio по контракту, cancel/retry/restart и проверка файла.
  Runner пока не принят: fixture/текстовый ответ не являются видео.

Сервисные зависимости назначаются по функции: ordinary chat не ждёт всех сервисов.
Provider/machine secrets остаются на сервере.

## Библиотечные дефекты и release gates

Minimal scenario/exact versions/expected-actual/public API/команда/вывод/teardown/приёмка
записываются в `doc/library-tasks`. Сначала отделить bug библиотеки от adapter/UI.
Не патчить node_modules/пример вместо release; временный guard небольшой, отмечен и проверен negative test.
После published fix — отдельный dependency commit на приложение, существующий --expect-fixed либо native repro и исходный runtime/browser;
workaround удаляется только после доказанного заменяющего публичного механизма.

- STORE-NESTED-REPLACEMENT исправлен, обходы удалены, Support --expect-fixed в test.
- AI-POLICY-INVALIDATION/AI-RESOURCE-LIFECYCLE повторены на 3.1.1 и блокируют безопасную приёмку C02.
- CONVERSATION-RECEIPT-POLICY: public repro на 3.1.1 подтверждён; retained retry выдаёт прежнюю private
  entity после policy=false, fresh requestId запрещён, keyframe уже фильтруется.
  Обычный repro PASS, --expect-fixed FAIL. Требуется API решение/release: dedup сохраняется,
  current ACL закрывает private result; post/createChannel/createConversation/durable receipts/две сессии.
  Upsert/retract fact этим repro не проверялись — доказанный дефект по ним не заявляется.
- CONVERSATION-RESOURCE-LIFECYCLE подтверждён minimal public repro: close/revoke дают fatal exit 1,
  early-dispose control exit 0. Это новая библиотечная задача с отдельным release gate.
  Приёмка: нативные client/server close и revoke, late events и teardown без fatal error;
  после published fix exact dependency update, повтор тех же native close/revoke repro и исходных
  C01/C03 lifecycle сценариев. Режим --expect-fixed в lifecycle repro пока не реализован;
  не записывать его как существующую команду или выполненную проверку.

Application guard не означает исправление библиотеки. C01 может принять ограниченный защищённый plain
сценарий с явным остатком; C03/revoke не принимаются без необходимых отрицательных проверок.

## Регулярное безопасное упрощение

OPT-G уже прошёл: helpers clock/localDay, повтор календарей.
OPT-API после Q04/Q05: доказанный общий adapter при неизменных tenant/scopes/revoke/IO.
OPT-UX после Q07/каждого Q08: убрать лишний state/branch/subscription, повтор choice/cancel/stale/roles.
OPT-REUSE после Q10: убрать доказанную обвязку, сохранить public API/replay/reconnect.
C-OPT-CHAT после C01/C03: session/conversation facades, subscriptions/draft, retry/two clients/account switch.
C-OPT-RUN после C02: удалить только исправленные обходы, повтор delta/tool/cancel/checkpoint/policy/close.
C-OPT-SERVICES после двух adapters: общая минимальная orchestration, предметные jobs/ACL остаются в сервисах.
C-OPT-PLATFORMS после C07-X: общие модели/client и явные lifecycle отличия платформ.
Каждый checkpoint фиксирует contract/diff/причину/повторные checks/эффект.
«Безопасное упрощение не требуется» допустимо; меньше строк без поведения не результат.
Изменение после final gate требует нового gate на окончательном состоянии.

## Ближайший порядок и продолжение

Текущая практическая последовательность:

| Шаг | ID и работа | Когда можно переходить дальше |
| --- | --- | --- |
| 1 | B00/merged validation: сохранять exact npm/locks и доказательства уже перенесённых изменений | raw95073 PASS; новые изменения имеют свои targeted/runtime/browser gates |
| 2 | Q06: после принятого Documents producer subset проверить Support machine handoff | одинаковый request не повторяет работу, другой input конфликтует; lost-settle/crash gap остаются явным unknown |
| 3 | Q08: законченные journeys Organizer/Booking/остальных продуктов; оптимизация по фактическому initial/total graph | выбор, отмена, ошибки, роли и narrow UI проверены; уменьшение измерено, поведение сохранено |
| 4 | Q09/Q10: реальные screenshots, fresh/unknown badges, самостоятельная копия и изменение бизнес-правила | не только structural copy: установка, сборка, native journey и восстановление реально проходят |
| 5 | Q11-P/B: artifact → Linux runtime → согласованный host → HTTPS → update/rollback | artifact и Linux subset приняты; внешний DNS/TLS/systemd/agent требуют отдельного live proof |
| 6 | Q12/C03/C06/C07: аккаунты и plain chat → права remote → установленные клиенты web/desktop/mobile | две реальные сессии/устройства, reconnect/history/switch/revoke; C07 source probe не заменяет installed matrix |
| 7 | C02/C04/C05/C08: исправленная AI библиотека → специализированные сервисы → создание/размещение сайтов и прочие jobs | published fix/repro, current ACL, cancel/receipt/artifact и живой executor каждого сервиса |

Шаги3–4 идут параллельно независимому Q06 proof. Платный AI начинается только после
контракта расхода и восстановления; существующий plain chat не ждёт AI release.
Внешняя среда не останавливает независимые локальные этапы.

1. Q06-B 71c9d8c и Documents owner keys 58d0aeb приняты; следующий Q06 срез — Support handoff/lost-settle/reconciliation.
2. Integration baseline e4944c3: npmci13/13, raw4956 PASS38/39, Docker11 PASS, acceptance98146ad. Post-transfer raw18952 EXIT1 только Chat desktop metadata; repair14d0276 и actual raw95073 PASS38/39, scaffold10/sync101/15/style494/0/links814/0. ORIGINAL/GRAPH checkout не переключать.
3. Fresh Support live36.666s покрывает новые Support assets отдельно от baseline Docker11. Q10repeat15011/Q11repeat25390 bounded native runtime proofs приняты, parent stages pending; Booking targeted/browser UX subset принят после raw95073. npm views19:32UTC подтвердил3.1.1/5.0.0 без новых версий; generic runtime/external HTTPS отдельно.
4. После принятого Support merged subset — Q06 lost reserve/settle response и reconciliation/crash fault boundary, до paid usage. Performance baseline0645a89 задаёт один candidate с measured before/after, не общий rewrite; профильные Q08 journeys/Q01/device остаются отдельно.
5. Q09/Q10/Q11 после gates; C02 после release, C04/C05 по API, C06 по правам/режиму.
6. C07 technical e1669c1→b1ac4f2 не закрывает installed HTTPS/menu/mobile/matrix; продолжить реальные C07-D/M/X и C08 по самостоятельным выходам. Q11 fresh pack и bounded Linux runtime приняты; установка чистого host/systemd/HTTPS pending. Support history browser owner/customer/outsider/append PASS, UX сохранён b16c0da→53f5224.

Этап начинает progress; результат/решения/блокеры/следующий ID записываются перед сменой контекста.
По окончании долговечный отчёт остаётся, временный progress удаляется.
Одна задача — один коммит, Q07/Q08 отдельно на приложение; русский imperative по CODE-RULES.
Не push/publish/destructive cleanup/paid requests без авторизации.
После исчерпания принятой очереди вернуться к стратегии: по фактическим UX/production pain выбрать
ограниченный полезный сценарий, записать contract/deps/приёмку и продолжить работу.
Не увеличивать число приложений без новой проверяемой потребности.

Настоящий старый архив уже принят ограниченным Q02 schema 5→5 срезом;
условия полного внешнего результата по остальным границам: физические устройства,
Linux host/domain для HTTPS, target desktop/mobile ОС, published library fixes и настоящий video executor.
Пока среда отсутствует, завершать независимый код/локальную композицию;
соответствующий external gate остаётся skipped/ожидает, вся очередь из-за него не останавливается.



