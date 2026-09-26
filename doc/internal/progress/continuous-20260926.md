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

Следующая контрольная точка: C-OPT-CHAT принят и сохранён 140d464 в managed checkout;
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
