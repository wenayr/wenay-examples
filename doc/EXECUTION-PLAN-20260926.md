# Исполняемый план всех поручений, 26 сентября 2026

Единая очередь охватывает миграцию на наши библиотеки, повторную проверку прежней работы,
календари Organizer/Booking, UX всех приложений, безопасное упрощение, SaaS «хочу сайт, вот сервер»
и общий chat web/desktop/installed mobile с аккаунтами, workspace, plain/remote и специальными сервисами.
Основания: [стратегия](STRATEGY-2026-09.md), [план чат-продукта](AI-CHAT-PRODUCT-PLAN.md),
[аудит прежних задач](changes/previous-tasks-audit-20260926.md), [правила](CODE-RULES.md).
ID B00, Q01–Q12, G01–G04, C01–C08 сохраняются; суффикс уточняет срез, не перенумеровывает задачу.

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
Q04 принят только в исходной ветке: графический checkout основан на более раннем committed состоянии;
перенос актуального Support вместе с графиками/chat ещё не выполнен.

## Обзор всей очереди

| ID | Результат | Зависимости | Состояние и остаток |
| --- | --- | --- | --- |
| B00 | Exact published common2/react2 и адаптация потребителей | Нет | Миграция 11 потребителей на 3.1.1/5.0.0 принята; следующий release требует нового gate |
| Q01 | Browser/UX Organizer, CRM, Metering после миграции | B00 | CRM/Metering локально приняты; Organizer local в G01; полный scope и устройства отдельно |
| Q02 | Составной cold backup и старый архив | B00 | Текущий restore PASS; настоящий архив прежней версии не принят |
| Q03 | Последовательный hosting live gate | B00 | Свежий Support live принят: [отчёт](changes/hosting-live-support-20260926.md); общий 11-check gate не принят |
| Q04 | Support machine search и owner keys UI | B00 | Принят 2e159e2: runtime/runner/browser; fake usage не закрывает Q06 |
| Q05 | Documents machine upload/start/status/result | Q04 | Ожидает реализации, ACL/IO/restart и UI приёмки |
| Q06 | Настоящий Counter для двух продуктовых API | Q04, Q05 | Ожидает quota/dedup/uncertain/revoke; необходим до paid usage |
| Q07 | Metering pattern / Documents diff | B00 | Локально приняты b11a848 / affe595; интеграционный код проверяется заново |
| Q08 | Эксплуатационный сценарий каждого оставшегося продукта | B00, профильные Q/G | Bundle/lazy частично проверены; продуктовые сценарии ожидают |
| Q09 | Свежесть Catalog и настоящие screenshots | B00, G03 | Ожидает snapshot/fallback/skip приёмки |
| Q10 | Чистый scaffold с предметным расширением | Q04–Q08 | Ожидает автономной копии, ролей, restore и замера затрат |
| Q11 | Проект → сервер → HTTPS → update/rollback | Q03 | Q11-P prepared host, затем Q11-B bootstrap; внешний путь не принят |
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
| C07 | Desktop, installed mobile, общая история | C01, C03; режимные C02/C06 | Feasibility/платформы не приняты; native exports не являются RN UI |
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
Есть PASS текущего cold backup, test:backup в npm test и typecheck.
Недостаёт настоящего старого архива: fixture с прежним metadata number не доказательство.
Шаги: создать архив старого committed/released состояния в isolated copy, записать provenance/hash/версии;
восстановить копию новым кодом, сверить данные и RPC replay, negative/incomplete archives.
Зависимость B00; отчёт Q02 должен назвать старый источник и команды. Горячая копия не заявляется.

### Q03 — Hosting, полный live gate

Триггер: pinned deploy→запись данных/вложения→update→rollback→чтение через тот же route/WS,
включая lost response и restart control plane/агента. Результат: gateway/volume стабильны,
нет второго writer/deploy, durable данные доступны после rollback.
Принят только свежий Support live срез: две pinned images с dependency labels,
настоящий deploy/update/rollback, ticket/attachment и стабильный RPC route, 33.9 секунд PASS;
доказательство `work/hosting-live/report.json` исходного checkout.
Общий 11-check gate не принят: прежний aggregate skipped из-за отсутствующих labels не PASS.
Следующий gate: `docker info`, проверка image ID/digest/labels common2/react2,
последовательно все aggregate сценарии/public-address/WS, lost response/restart/durable volume.
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
Зависимость Q04; состояние ожидает. Q07 diff/Python advanced не являются машинным API.

### Q06 — Metering/Counter и два продукта

Триггер: реальные Support/Documents reserve→IO→settlement, response lost/revoke/uncertain.
Результат: retry без второй работы/списания; uncertain удерживает резерв до доказанного исхода,
revoke запрещает новую работу и закрывает выдачу после IO.
Шаги: интегрировать оба API с Counter, выделить доказанный общий adapter;
разные расходные единицы/предметные правила сохранить в продуктах.
Приёмка: настоящие процессы/клиенты, success/error/uncertain/quota exhaustion,
lost response/restart/retry/revoke, hash-only credentials/outbox recovery;
UI показывает reserve/usage/uncertain без ложного успеха.
Q04→Q05→Q06 обязательно; ожидает, требуется до paid provider usage.

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
| Q08-METERING | Owner quotas/keys → reserve/settle/outbox → uncertain/retry delivery | Remaining quota/uncertain честные, hash-only secret once, explicit retry без второго списания; Q06 интеграция и Q07 форма отдельно |

Для каждого — current-code runtime и browser нескольких ролей, console errors,
targeted typecheck/test/build, отдельный отчёт/коммит на приложение.
При полезном существующем outcome достаточно свежей приёмки и исправления конкретных находок.

### Q08-CRM

Триггер: partial import оборван, оператор продолжает после restart; клиент сравнивает предложения.
Результат: summary принятого/отклонённого/оставшегося, без duplicate contact/task;
клиент видит только свои publications и принимает current revision.
Шаги: existing import receipts/checkpoint, action продолжения, published diff и stale accept feedback.
Приёмка: restart mid-import/retry/conflicting row, две роли, current/stale accept;
browser table/search/card/keyboard/Escape/archive. Q01; продуктовый остаток ожидает,
прежний lazy browser PASS новый import lifecycle не принимает.

### Q08-FORMS

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
Q08-BUNDLE: reproducible Vite manifest полного/начального JS/CSS, lazy CRM/Organizer
без нарушения first open/selection/reconnect. Fixtures/builds/CRM browser есть;
network timing не измерен, capture отсутствует; повтор на финальной сборке.
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

1. C01 f083593 и C03 e97161a локально приняты; выполнить C-OPT-CHAT и Q05 public feasibility. Hosting SKIP не полный gate main.
2. Сверить и интегрировать Q04/Q07/G01–G04; проверить итоговый объединённый код.
3. После принятого C03 выполнить C-OPT-CHAT с повтором receipts/account switch/two clients; независимо Q02 historical и полный Q03 live.
4. Q05→Q06; профильные Q08 и оставшийся Q01/device по доступной среде.
5. Q09/Q10/Q11 после gates; C02 после release, C04/C05 по API, C06 по правам/режиму.
6. C07-F до framework, реальные C07-D/M/X; C08 по отдельным настоящим выходам.

Этап начинает progress; результат/решения/блокеры/следующий ID записываются перед сменой контекста.
По окончании долговечный отчёт остаётся, временный progress удаляется.
Одна задача — один коммит, Q07/Q08 отдельно на приложение; русский imperative по CODE-RULES.
Не push/publish/destructive cleanup/paid requests без авторизации.
После исчерпания принятой очереди вернуться к стратегии: по фактическим UX/production pain выбрать
ограниченный полезный сценарий, записать contract/deps/приёмку и продолжить работу.
Не увеличивать число приложений без новой проверяемой потребности.

Условия полного внешнего результата: настоящий старый архив, физические устройства,
Linux host/domain для HTTPS, target desktop/mobile ОС, published library fixes и настоящий video executor.
Пока среда отсутствует, завершать независимый код/локальную композицию;
соответствующий external gate остаётся skipped/ожидает, вся очередь из-за него не останавливается.



