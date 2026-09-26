# Непрерывное развитие примеров, 26 сентября 2026

Поручение пользователя: продолжать после каждого этапа; развивать удобство, внешний вид, оптимизацию и проверки, возвращаться к стратегии после исчерпания очереди.

Основание: doc/STRATEGY-2026-09.md, точные common2 3.1.1 / react2 5.0.0, предыдущий check:all прошёл.
Ветка: codex/library-upgrade-20260926. Пользовательский apps/facade-map/TASK.md не изменять. Не push, не paid AI, не тяжёлые кластеры.

Текущий этап:
- Q07: metering HTML pattern и documents выбор отличающейся версии.
- Q01: браузерная приёмка organizer, CRM/metering, выявленные UX/визуальные дефекты.
- Q02: составной backup пиццерии с независимой приёмкой.
- Далее Q03 и Q04–Q06; при завершении очереди пересмотреть план по фактическим сценариям.

Агенты работают в непересекающихся областях, тяжёлые проверки выполняются основным агентом последовательно. Один коммит на задачу/приложение с документацией.

Выполнено в рабочем дереве:
- Q07 metering: pattern исправлен; typecheck/build и браузер valid/invalid ID прошли, console errors отсутствуют.
- Q07 documents: автоматический выбор отличающейся копии, сброс выбора на другой документ и защита позднего ответа;
  typecheck/build прошли. Браузер: sample → extract → approve v4 → reopen/edit price → approve v7;
  по умолчанию v4 vs v7, 45000→46000 подсвечено; ручная v7 объясняет отсутствие различий.
- Q02 pizzeria: новый составной test:backup прошёл, включён в npm test; typecheck прошёл.
- Оптимизация: CRM таблица и встроенный organizer вынесены в lazy chunks; typecheck обоих прошёл, UI ещё принимается.
- Q08 метрики: manifest полного/начального JS/CSS графа, meaningful fixtures прошли; реальные сборки ещё выполняются.
- Support: подпись применённого поиска, счётчик выдачи, очистка и loading подготовлены; браузерная приёмка впереди.

Первый последовательный `npm run check:apps` с DOCUMENT_PYTHON завершён: 36 шагов,
35 проверок прошли; catalog build отсутствует по контракту.
Q03 aggregate live gate hosting подготовлен; Q04 backend машинного поиска Support реализован.

Поручение уточнено пользователем: графический календарь работ в отдельной ветке;
оба приложения — начать с органайзера, затем Booking. Создаётся отдельный managed worktree
от текущего committed HEAD с обновлёнными библиотеками; незавершённые Q03/Q04 в этом checkout сохранены.
После DeferredPanel повторные typecheck/build pizzeria/metering/CRM прошли.
Второй checkpoint после Q04 и правок hosting: `node scripts/run-all.mjs typecheck test build --only=support,hosting`
прошёл — 6 проверок, 0 ошибок; hosting test 11.1 с, Support test 31.4 с. `npm run status` обновил STATUS и витрину.
Первая попытка `npm run check:repo` остановилась на единственном style ternary в `scripts/hosting-live-gate.mjs:176`;
run-all/status fixtures, bundle graph fixtures, scaffold (9 приложений) и sync (100 копий / 15 канонов) уже прошли.
По разрешению основного агента вложенный ternary заменён таблицей outcome с прежним fallback.
Повторный `npm run check:repo` прошёл: runner/status fixtures, bundle graph fixtures, scaffold, sync,
style (449 файлов / 0 нарушений), links (728 / 0 битых) и status --verify; exit 0.
Docker/live gate не запускался в рамках checkpoint, новой приёмкой размещения это не является.

Q04 Support backend готов к review: отдельный `product:<id>` через стандартный login common2,
scope `knowledge:search`, tenant, срок 1–90 дней, hash-only секрет с однократной выдачей,
authority-ресурсы `productKeys` и `productSearch`, одна операция HTTP/RPC с ACL после settlement.
Открытый ресурс и старый bearer прекращают чтение после expiry/revoke; человеческий login сохранён,
машинная ветка не отключается при demo:false. API/README/scaffold обновлены; UI управления ключами ещё нет.
Целевые `typecheck` и `tsx backend/product-check.ts` прошли; также весь Support npm test/build принят повторным runner.
Product-check проверяет реальный machine login/RPC, отсутствие человеческого членства и административных прав,
one-time/conflict/tenant/scope/expiry, отзыв во время reserve/settlement, закрытый signal и durable replay после рестарта.
Отрицательный login common2 REST печатает `login refused` с HTTP 500; проверяется `body.ok=false`, библиотека не менялась.

Validation checkpoint второй партии завершён. Далее: root review Q04 перед коммитами;
UI ключей и браузерная приёмка Support остаются отдельным шагом.
Графический календарь развивается отдельно в managed worktree ветки `codex/work-calendar`:
сначала органайзер, затем Booking. Этот checkout не переключать; текущие изменения здесь сохранены без новых коммитов.
CRM browser: lazy table открылся, выбор строки/клавиатурная сортировка/поиск/карточка/Escape/архив работают;
ошибки консоли отсутствуют. Утверждать network timing нельзя: браузер не предоставляет network capture.

Повторная проверка по поручению пользователя: doc/changes/previous-tasks-audit-20260926.md.
Q02 исторический архив прежней версии и Q03 aggregate Docker live всё ещё не приняты.
Q04 тесты расширены настоящим owner RPC, retained HTTP bearer и закрытием ресурса во время IO;
target product-check и Support runner typecheck/test/build 3/3 PASS. UI ключей реализован;
следующий шаг — browser owner issue/list/copy/revoke, смена org/logout и отсутствие раздела у nonowner.
Графический check:all 35/36 прошёл в отдельной ветке, UI review выявил и исправил две P2;
Booking browser race после скрытого занятия слота PASS; Organizer повторная приёмка завершается.
Пользователь добавил направление единого AI-чата web/desktop/mobile; архитектурная инвентаризация готова,
doc/AI-CHAT-PRODUCT-PLAN.md составляется со стадиями C01–C08 и проверками публичных библиотечных API.
Закрытие окна Codex несколько раз прерывало local run. Прерванные проверки не считать PASS;
журналы, исходники и завершённые runner-логи сохраняются, исчезнувшие process sessions не опрашивать.

Q04 после read-only review: дополняется product-check настоящим owner-client RPC выпуска/list/повтора/conflict/отзыва,
сохранённым HTTP bearer после expiry/revoke и закрытием настоящего RPC-ресурса во время IO.
Metering остаётся тестовым UsageGate: реальная quota/dedup/uncertain интеграция относится к Q06.
Целевой runtime-прогон пока не выполняется параллельно общей проверке другого worktree.
Тест расширен: issue/list/repeat/conflict идут через owner productKeys RPC, revoke — owner command RPC;
expiry использует сохранённый настоящий machine remote и заранее выданный bearer, revoke — прежний bearer.
Настоящий resource.close вызывается при удержанном settlement; тест ждёт server signal.aborted и отказ pending RPC.
Support typecheck прошёл после изменения; целевой `npx tsx backend/product-check.ts` ожидает последовательного запуска основным агентом.

Q04 UI: начат owner-раздел машинных ключей через настоящий productKeys resource; только frontend/README/scaffold, без backend и тяжёлых проверок.

Q04 UI реализован в frontend/product-keys.tsx: owner-only раздел, list/issue productKeys, command revoke, explicit copy, one-time secret и retry requestId. README/scaffold обновлены. Target checks и браузерная приёмка ожидают основного агента; временный doc/progress/support-product-keys.md содержит следующий шаг.

Q12: создан doc/AI-CHAT-PRODUCT-PLAN.md и добавлены ссылки в STRATEGY/NEXT.
Новый результат пользователя — общий чат web/desktop/installed mobile, account switch, plain/remote,
специализированные дизайн/сайты+deploy/видео/приложения на public common2/react2.
План C01–C08 фиксирует deps: C01 plain/testprovider, C03 identity, C02 published AI fix/repro;
Q04/Q05 только адаптеры, Q03 deployment, Q06 перед paid usage. Native headless не равен RN UI,
installedmobile и remote typed agent требуют самостоятельной реализации и реальной приёмки.
Код нового продукта не написан; существующие PASS не принимают C01–C08.

Актуальная точка 26 сентября 17:45 MSK: Q04 runtime/runner/browser приняты и сохранены 2e159e2.
Issue/copy/revoke, org switch, logout при открытом секрете и повторный вход, lead/customer gating,
console errors [] прошли. Текущий fixture штатно остановлен/удалён; старые каталоги после auto-review
отказа не тронуты, причина отказа не предоставлена. Q06 fake usage не принимает.
Q07 сохранён отдельными b11a848 (Metering) и affe595 (Documents), lazy/vite изменения отделены.
G01/G02/G03/G04 сохранены b03eabf/e9dae43/1fa38a2/4ff49d2; полная проверка и повтор UI PASS.
Свободный managed checkout графиков переведён в новую ветку codex/unified-chat для C01.
Backend/UI агенты реализуют apps/chat на native public conversation с durable journal и two-client/restart tests.
Обычный web и тестовый помощник не принимают C02 stream/C07 installed mobile; paid requests нет.

Актуальное продолжение: составлен единый EXECUTION-PLAN-20260926 с устойчивыми Q/G/C ID, зависимостями и приёмкой каждого продукта. Три Sol high подагента проверили план, concurrent payload/capacity и native ownership/reconnect. C01 targeted 3/3 PASS, те же клиенты автоматически reconnect после restart, Chrome 390/360 browser PASS; общий gate выполняется в отдельной ветке. Два common2 conversation defects с public repro там документированы, библиотека не объявлена исправленной. Q03 Support fresh images live 33,925 s PASS сохранён в долговечном отчёте; остальные десять сценариев ещё требуют свежих образов.

Актуальное продолжение 26 сентября: C01 локально принят и сохранён f083593 в codex/unified-chat.
Итог 37 PASS / 39 шагов, hosting SKIP, Catalog build отсутствует по контракту;
это не полный общий PASS перед main. C03 runtime runner 3/3 PASS, browser выполняется,
этап ещё не принят. Q04 Support 2e159e2 и исходный checkout сохранены без подмены.
Read-only полнота поручений перенесена в EXECUTION-PLAN/AI-CHAT-PRODUCT-PLAN/NEXT:
Q11-P prepared host и Q11-B clean bootstrap; C07-F-MATRIX/X-MATRIX installed platforms;
C06-P-TYPED/C06-A remote operations/negative paths; C05-CANCEL-FILE scoped cancel/artifact;
Q08-PIZZERIA/SUPPORT/DOCUMENTS/METERING human acceptance отдельно от machine/backup/diff.
IDs не перенумерованы, смыслосохраняющая оптимизация и current-code повторные checks обязательны.
Временный doc/progress/plan-completeness-review.md оставлен до root review;
Documents machine audit подготовлен отдельно, реализация и Q05 PASS не заявлены.
Изменены только четыре долговечных doc файла, apps/STATUS не тронуты; heavy tests/CUA/commit не выполнялись.
Следующее действие: root review docs и закончить pending C03 browser/final evidence;
затем независимые Q05/C07-F/Q03 по доступной среде без скрытой зависимости plain chat от всей очереди.

C03 локально принят в managed graph checkout и сохранён e97161a: targeted3/3, repository checks, browseraccount/workspace/revoke/regrant/360x500PASS. Original план дополнен cleanbootstrap/platformmatrix/typedremote/scopedfile/humanjourneys. Q05 design выявил recovery/receipts/lifecycle ограничения; publicfixture готовится до machine реализации. C-OPT-CHAT отложенная native загрузка выполняется отдельно с измерением. Main/push нет, Docker skip не принят.

Историческая промежуточная контрольная точка до Q05/Q06-B/integration: C-OPT-CHAT принят и сохранён 140d464 в managed checkout;
targeted и browser повторены, начальный JS меньше на 58,9% raw bytes, общий JS больше на 1 921 байт.
Это размеры сборки, не время загрузки. Q01 сохранён 9fed00b после 9/9 проверок;
Q02 current cold backup сохранён 5584ea8, настоящий старый архив отдельно ожидает приёмки.
Q05 public recovery probe сохранён 0fb02a1; machine API реализован, но runtime ещё ожидает.
Docker Engine 29.7.2 доступен: свежие organizer/pizzeria/support deploy/update/rollback прошли
3/3, отчёт и runner сохранены 96828ea. Следующие семь свежих образов собраны и проходят live gate;
Documents будет собран после финальной проверки нового API. Полный Q03 ещё не принят.
Q11 publicOrigin backend/UI прошли проверки и реальные browser owner/admin/negative roles,
retry после потерянного ответа, два клиента и смену контекста. Последнее устранение дублирующей ACL
через hasProject требует повторного targeted gate; DNS/TLS/внешний deployment не заявляются.
Случай временного remount формы наблюдался, причина не установлена: reconnect draft UX не принят.
Windows Electron каркас общего чата подготовлен и прошёл source review; runtime/installed ещё нет.
Все результаты остаются на отдельных ветках; main/push/платный ИИ не выполнялись.

## Актуальное продолжение после Q06-B и merged Docker gate

Q06-B принят и сохранён 71c9d8c в ORIGINAL: actual Counter/Documents machine fixture
PASS exit0 5.5255 s, native receipt/status/result переживают Documents restart без
reexecution. Documents npm test/full и отдельный advanced PASS с настоящим Python
pythoncore-3.14-64; overall elapsed не замерялся. Q06-A 272f704 сохранён ранее.
Parent Q06 остаётся pending Support machine receipt handoff, lost reserve/settle response
и reconciliation/crash gap. Null не доказывает no-cost; rerun/refund не добавлены.

C07 technical slice сохранён GRAPH e1669c1: actual Electron 44.4.5 технический PASS
2.192 s. Это уже не dirty skeleton; installed HTTPS/backend/menu/mobile/platform matrix
не приняты. Source/runtime proof не заменяет installed product/device acceptance.

Managed integration codex/examples-integration-20260926 baseline e4944c3 включает
Q06-B/GRAPH union. npm ci 13 приложений PASS; 38 app checks PASS. Первый raw check:all
завершился exit1 только на трёх doc links errors, исправленных затем; check:repo PASS,
807 links/0 errors. Raw check:all session4956 завершился PASS exit0 38/39 на e4944c3;
Catalog build отсутствует по контракту, environment SKIP нет. Acceptance сохранена
98146ad в INTEGRATION. npm views19:32UTC подтвердил latest3.1.1/5.0.0 без новых версий.
Original/GRAPH checkout не переключать, main/push не выполнены.

All-11 merged Docker gate exact source e4944c3 завершился PASS exit0 в 19:26:40.573Z.
Generic runtime исключён; actual product deployment matrix не принимает external
TLS/DNS/bootstrap/Linux host. Baseline raw gate принят отдельно своей evidence.

Support history browser owner/customer/outsider/append PASS; UX сохранён ORIGINAL
b16c0da→integration53f5224. Q11 artifact foundation source/assets + separate SHA/target verify
прошли snapshot TOCTOU fix/review: все tar reads идут по private checked bytes,
controlled original replacement и cleanup success/failure PASS. Root повтор fixture
PASS exit0 5.543 s. Default fresh Vite pack actualPASS exit0 4.195s + separate CLI verify:
manifest freshness=true/installed=false/source2163a0f, own work artifact
work/hosting-installation/hosting-2163a0f.tar.gz, SHA256
2db1137cbb77ca2819ac07a9629cb548587c842d988f29be8dffae901b9ae0a7.
Q11artifact сохранён a6f7201→integration19f4487. Linux npm/install/readiness не приняты,
OS/SSH/TLS/publish действий не было.

После baseline full gate перенесены три отдельных stage: SupportUX53f5224,
Q11artifact19f4487 и C07 e1669c1→b1ac4f2. На том checkpoint новый final raw был
запланирован после freeze continuation docs; baseline4956 не выдавался за новый PASS.
Последующие actual outcomes записаны ниже отдельно.

Следующие шаги сохраняют ID/deps: independent Linux preflight/install после fresh Q11 pack;
Q06 Support handoff и lost-response design до paid usage. Q08 human journeys/Q09/Q10,
C02 release-bound stream и installed C07-D/M/X остаются самостоятельными границами.

## Final post-transfer checkpoint после Chat metadata repair

Исторический post-transfer raw18952 на b1ac4f2 завершился **EXIT1** только на Chat
desktop scaffold metadata. Actual app checks проходили; этот EXIT1 не переименован
в success. Root исправил manifest commit14d0276 и выполнил новый raw check:all95073:
**PASS EXIT0**, 38 actual app checks/39 шагов, Catalog build absent по контракту,
environment SKIP нет. Repository: scaffold10, sync101/15, style494/0, links814/0.
Intentional fake fail/skip runner regression не является настоящим app fail/skip.
Catalog footer c6390f1 INTEGRATION/9ea82f7 ORIGINAL изменён до Catalog checks.

Root пересобрал затронутый Support first/second и выполнил отдельный fresh live gate:
PASS36.666s, complete/code0 at2026-09-26T19:44:34.530Z;
[отчёт](../../changes/support-history-live-20260926.md). Stable gateway/RPC/durable ticket/
attachment пережили deploy/update/rollback. Этот новый Support asset proof дополняет
baseline all11 e4944c3, не изменяет его22 image records и не принимает
external HTTPS/bootstrap/server peak. C07 installed/backend/menu/mobile остаются pending.

В ORIGINAL подготовлены следующие bounded drivers, independent source review PASS:
Q10 scripts/scaffold-runtime-check.mjs — own Support-copy urgent SLA30/native current roles/
retry/failover/restart/cold directory restore; Q11 scripts/hosting-linux-runtime-check.mjs —
Ubuntu24.04/amd64/glibc2.39/Node24.18.0 own Docker candidate authority fixture.
Q10 phase/IPC/npm config и Q11 canonical extraction fixes внесены до final source freeze.
Actual drivers/npmci/build/generated TS/native Ubuntu/copy/timeout cleanup ещё pending root;
source-review не runtime proof, они не входили в raw95073. Donor full-suite/browser/backup-format,
agent/socket/SSH/systemd/TLS/clean-server acceptance не заявляются.
На том checkpoint next был actual driver run; его последующие outcomes записаны ниже.
Q06 Support/lost-settle/reconciliation и Q09/product
screenshots остаются самостоятельными IDs; main/push/paid usage не выполнялись.

## Actual bounded Q10/Q11 и Booking UX subsets

Q11 первый63344 EXIT1 после successful Ubuntu/npmci: native tsx cache /tmp absent на
readonly root. Узкий TMPDIR=/run-fixture сохранил own tmpfs/nonroot/ROroot limits.
Root repeat25390 EXIT0: actual Ubuntu24.04/amd64/glibc2.39/Node24.18.0/npmci,
authenticated native authority/project receipt repeat/dashboard/static assets PASS;
own labels containers/volume/directories absent. ORIGINAL80327be→INTEGRATION98ce6a3,
[report](../../changes/hosting-linux-runtime-q11-20260926.md). Clean-server install/SSH/
systemd/agent/socket/TLS/external URL/Q11 parent остаются непринятыми.

Q10 первый55452 EXIT1: independent npmci PASS, generated TS optional dueAt/disconnect
type errors до native run. Explicit assert dueAt!=undefined и disconnect?.() под connected
guard сохраняют смысл; quick source re-review новыхP1/P2 не нашёл. Root repeat15011 EXIT0,
npmci7575/type631/build1347/domain3065/conversation2150/native11895ms PASS.
Urgent30min/currentroles/private/history/receipt retry/sameStore failover/restart/cold
directory restore подтверждены; обе own temp absent/user TASK unchanged. de64a4a→27eb75b,
[report](../../changes/scaffold-runtime-q10-20260926.md). Full donor/browser/backup format/
machine/paid processing и timeout escalation runtime branch этим subset не приняты.

Booking targeted20383 all3 PASS type0.7/test20.4/build0.9с после source freeze.
Root browser70919: cancel оставил27сент10:00; realmove4окт09:00→Reservations, reopen
обе даты периода4октября; следующий cancel сохранил4окт09:00, console[].
Measured360×640: document scroll345/panel312.8/cancel264.98px. Два finalactual screenshots
desktop/mobile сохранены в [report](../../changes/booking-transfer-ux-20260926.md).
Оба own70919/18468 fixtures stop EXIT0, own temps/ports отсутствуют. Source UX subset
принят; held-response org/role/logout browser matrix, occupied/revision/retry/DST и
installed mobile остаются pending. Эти subsets выполнены после raw95073, не расширяют
его исторический source scope; whole Q08/Q10/Q11 не объявлены завершёнными.

Next сохраняет IDs/deps: bounded Q06 research существующих current receipt handoff,
lost reserve/settle response и reconciliation/crash gaps. До доказательства не добавлять
paid usage или автоматический rerun/refund. Root сохраняет docs отдельно; main/push нет.

Root: final raw53023 на integration392170d RUNNING после Q11Linux/Q10copy/Booking UX.
Pizzeria и Hosting actual checks продвигаются; до completion новый PASS не заявлять.
Booking fresh selected Docker97387 PASS39.528s, exact2digests/source5f8a2c1 сохранены
в Booking report. Q06 native Counter+AI checkpoint sourceproof в ORIGINAL проходит
independent review deadlines/cleanup перед serial runtime. UI выполняет bounded CRM
CSV human journey на собственном local fixture; lazy split без измеримой пользы не принят.

Root53023 завершился PASS EXIT0 source392170d:38actual/39 Catalogbuildabsent,
noenvSKIP, scaffold10/sync101/15/style496/0/links835/0. Actual timings сохранены в
examples-post-transfer report, STATUS сгенерирован штатно. Q06 firstactual85242 EXIT1
на controlledpersistence refusal timeout после terminal/restart части; собственный
child завершён, port61219=0/ownfixtures absent. Backend исследует причину, fullQ06 не принят.
CRMbrowser desktop import actual2added/1duplicate/1invalid и singlejob retry PASS;
SOURCElabel fix в ORIGINAL (4line UI diff), reviewerSOURCEPASS, target32866 RUNNING.
Этот новый slice не входит в53023; послеactualUX будет свой scopedcheckpoint.

## Current bounded Q06 proof и CRM labels после raw53023

Raw53023 PASS EXIT0 source392170d остаётся неизменным историческим full checkpoint:
38actual/39, Catalog build absent, no environment SKIP, scaffold10/sync101/15/style496/0/links835/0.
Последующие два scope перенесены отдельно, INTEGRATION target99016 PASS EXIT0 type1.2/test23.2/build2.0с.

Q06 первый85242 EXIT1 объяснён host-local native IDs ai-1: два checkpoint host попали
в один Counter eventId. Fixture использует stable checkpoint name + native run ID,
без synthetic receipt; Counter assertions проверяют ровно два distinct expected events.
Independent corrected source review новых P1/P2 не нашёл. Root repeat actual PASS2.489s,
port52920=0/own fixture absent; ORIGINAL7264bfd→INTEGRATIONb2b447b,
[отчёт](../../changes/usage-ai-checkpoint-q06-proof-20260926.md).
INTEGRATION native repeat chunkd42aa7 PASS EXIT0 6.158s на b2b447b; root cleanup check
pending. Completed/gap prefixes — fixture namespace, не independent producer proof.
Принимается bounded exact receipt/restart/retry/conflict/current-policy и controlled
before-terminal-write failure после actual committed Counter, не crash/lost-response
или atomic reconciliation. Parent Q06 Support machine handoff/production identity,
lost reserve/settle response и reconciliation/crash gap остаётся pending до paid usage.

CRM minimal progress labels ORIGINAL745ba88→INTEGRATIONe40062a: target32866 all3 PASS
type1.2/test21.9/build1.7с. Root fresh browser89843 confirmed completed «Проверено4/4»,
allchecked status/no resume, counters2/1/1, mobile360px scroll345 и own cleanup.
[Отчёт](../../changes/crm-import-progress-ux-20260926.md). Independent source review
подтвердил сумму disjoint nonpending row statuses и native completed/no-pending guard;
callbacks/resources/native payload/ACL unchanged. Full Q08-CRM import/publication journey
не закрыт этим labels subset. INTEGRATION target99016 PASS EXIT0 type1.2/test23.2/build2.0с.

Next: bounded Q06-PRODUCER-D public UUID IDs и два independent Documents host с одним
Counter org/cost2/restart same checkpoint/no reexecution; source/runtime пока pending.
Затем scoped Support machine receipt handoff и lost-response/crash-gap contract. Main/push нет;
два новых subsets не расширяют source basis raw53023 или прежних Docker reports.
