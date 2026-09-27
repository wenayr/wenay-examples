# Контекст продолжения wenay-examples

## Уточнение задачи 27 сентября 2026

Новое поручение: сначала суперподробный план, затем запуск GPT-6 Sol.
Подготовлены [82 задания](../SHELL-EXECUTION-PLAN.md),
[contracts v0](../SHELL-CONTRACTS.md) и [постановки W0](../SHELL-AGENT-BRIEFS.md).
Каркас теперь явно поддерживает разделы/подразделы/views/blocks; chat-first является
одним профилем, video-first может работать без chat. Целевой отдельный repo —
`C:/Users/wenay/WebstormProjects/wenay-shell`; первая волна S00.03/04/05 запускается
только после сохранения/проверки плана.

План сохранён в commit `da54a06`. Отдельный `wenay-shell` создан, ветка
`codex/shell-foundation`, bootstrap commit `7c23065`. Установлены точные публичные
common2 3.1.1 / react2 5.0.0 с lock; common2 deduped. Запущены GPT-6 Sol high:
`shell_native_foundation` (S00.03), `shell_composition` (S00.04),
`shell_platform_probe` (S00.05). Их write scopes не пересекаются; проверки и коммиты
выполняет root. Канонические план и статусы теперь находятся в
`C:/Users/wenay/WebstormProjects/wenay-shell/docs/EXECUTION-PLAN.md` и `docs/BOARD.md`.
F0 принят в shell `2633efe`: native `c3d777d`, composition `5a9e812` (14/14),
web `437ac6c` (build + browser subscriptions/cleanup). На root runtime портах
50890/54991 listeners отсутствуют. Новая W1 уже назначена тем же трём Sol high:
S01.01 identity, S03.01/02 lazy views, S07.01 AI boundary repro.
W1 проверена root: lazy registry `c960d41`, 12/12; identity `afb2fe3` — новый
IDENTITY-REVOKE-RELOGIN (старый токен после revoke + fresh login снова принимается),
fixed gate EXIT 1, S01.01 blocked-library. AI `7f7633e`: оба прежних дефекта
воспроизведены, classifier 2/2, fixed gate EXIT 1. Общий typecheck EXIT 0.
Следующая зависимость — опубликованное исправление identity, затем membership/client;
независимо доступен CAD artifact/host contract. Актуальные scopes/статусы и команды —
в shell/docs/BOARD.md. Не начинать другие examples. F0 не является готовым приложением
или mobile install; diagnostic EXIT 0 не закрывает identity/AI gates.

Предыдущая итерация планирования (до нового поручения выше):
пользователь запросил план нового общего каркаса backend/web/установленного mobile/CLI
на наших библиотеках, с чатами и подключаемыми модулями вроде wenay-cad.
Подготовлен [APP-SHELL-PLAN](../APP-SHELL-PLAN.md): S00–S10, связь с C01–C08,
общая модель документов и аккаунтов, отдельные этапы CAD bridge и editor embedding.
Уточнение интерфейса: чат является основной областью; слева список разговоров,
справа открывается модульная рабочая область из блоков. Два режима компоновки
сохраняют один разговор и документ; на телефоне области сменяют друг друга.
Соседний CAD найден в Dynamic, private wenay-cad 0.14.0 с common2 2.21.2/react2 3.5.1;
его локальный MCP host не предоставляет SaaS tenancy. Исследование было read-only.
На той итерации новый репозиторий ещё не создавался; теперь этот статус заменён
сведениями выше. Прежняя очередь и доказательства ниже сохраняют свои границы.

Обновлено 26 сентября 2026. Эта сводка актуальнее исторических статусов в старых отчётах и контрольных точках.

## Сначала читать: текущая контрольная точка

Последний полный raw `npm run check:all`27106 PASS EXIT0 COMPLETE source9d47359:
38actual/39, Catalog build absent, no environment SKIP,
scaffold10/sync101/15/style498/0/links852/0. Intentional runner-regression fake fail/skip
не является app failure/skip. Python/Docker доступны. Последующие изменения ниже
не выдаются за этот full gate; main/push нет.

После него Forms copy принят abef339→5616e92: ORIGINAL type1.18/build1.884с,
fresh closed-link browser с сохранением staff error, INTEGRATION56033e EXIT0 type0.7/build1.0с.
[Отчёт](../changes/forms-public-link-copy-20260926.md).
Support Q06-S-MACHINE ORIGINAL принят019268b→11e9de0: strengthened proof4c11ef EXIT0
4.0141с, target41567 type0.8/test30.5/build1.8с, source review/5ports0/own directories absent.
[Отчёт](../changes/support-machine-search-q06-20260926.md). INTEGRATION64391 EXIT0 type0.8/test33.6/build1.6с;
proof37d462 EXIT0 5.0608с и repo936304 EXIT0; bounded merged acceptance подтверждена.
Own ports57777/57797/58210/58218/58224 listener0, own directories absent.
Первый repo0dd605 EXIT1 только missing Support scaffold entry; required metadata
482390e→faa3e3f исправила его. Repo936304 EXIT0 7.643с:
scaffold10/sync101/15/style500/0/links869/0/generated status verify.
Full raw27106 НЕ покрывает later Forms5616e92/Support11e9de0/faa3e3f metadata;
перед main fresh full raw pending, сейчас broad повтор не заявляется.
Performance baseline0645a89 фиксирует actual initial/dynamic bundle sizes:
[отчёт](../changes/performance-bundle-baseline-20260926.md), не runtime acceleration.

Исторический raw53023 source392170d завершился PASS EXIT0:
38 actual checks/39 шагов, no environment SKIP, scaffold10/sync101/15/style496/0/links835/0.
Q06 first isolated proof85242 в ORIGINAL завершился EXIT1: native run IDs host-local,
два checkpoint host использовали ai-1 в одном Counter event namespace. Fixture исправлен:
stable checkpoint name + run ID; root repeat PASS2.489s, port52920=0/own fixture absent.
Bounded native proof принят7264bfd→b2b447b; Support handoff/crash/lost response не приняты.
INTEGRATION repeat chunkd42aa7 PASS EXIT0 6.158s; root подтвердил port56153=0
и отсутствие собственных usage-ai-proof directories.
Fixture completed/gap prefixes не доказывают independent production producers.
CRM label slice принят745ba88→e40062a: ORIGINAL target32866 PASS1.2/21.9/1.7с,
fresh browser89843 completed4/4, status, counters2/1/1, mobile360px scroll345 и cleanup PASS.
INTEGRATION target99016 PASS EXIT0 type1.2/test23.2/build2.0с. Эти два изменения не входят в raw53023 checkpoint.
Documents producer subset принят53f3a8d→9d47359: ORIGINAL proof0dd006 PASS3.9421s,
9254 type/test/build PASS0.9/45.7/1.9с; INTEGRATION e18bd3 EXIT0 5.8218s.
[Отчёт](../changes/documents-producer-id-q06-20260926.md). Два production archives/shared
Counter org distinct events/cost2 и restart/legacy snapshot доказаны отдельно от data reset/crash.
Full raw27106 PASS EXIT0 COMPLETE source9d47359:38actual/39, Catalog build absent,
no environment SKIP, scaffold10/sync101/15/style498/0/links852/0; native Python/Docker доступны.
Intentional fake fail/skip runner regression не actual app failure/skip.
Metering quota owner save/discard,
auditor readonly/actual360 PASS report34b2195: [отчёт](../changes/metering-human-browser-20260926.md).
Forms browser c0fa1c2 bounded v1/v2/old history/auditor/actual360 PASS:
[отчёт](../changes/forms-publication-browser-20260926.md). Этот commit docs-only после
source9d47359; subsequent Forms copy checkpoint принят отдельно выше. Q08 parent не закрыт.
Parent Q06 lost reserve/settle/crash, pending-restart runtime/postcommit race matrix open;
human assistant UUID и old published namespace остаются отдельными unresolved контрактами.

Integration `codex/examples-integration-20260926` объединяет графики, Chat и ORIGINAL.
Полный raw95073 EXIT0 относится к14d0276; subsequent bounded Q11 Linux98ce6a3,
Q10 autonomous copy27eb75b и Booking UX5f8a2c1 проверены отдельно.
Booking type/test/build0.7/20.4/0.9с, browser cancellation/real move/reopen Oct4,
responsive360px и fresh Docker deploy/update/rollback39.528с PASS.
Support fresh Docker36.666с PASS; baseline merged Docker11 относится кe4944c3.
Каждая граница и оставшиеся сценарии — в [исполняемом плане](../EXECUTION-PLAN-20260926.md).
Старые утверждения о pending merged gate ниже относятся к историческим checkpoint.

Следующее: Q06 lost reserve/settle response и reconciliation/crash fault boundary.
Paid provider не добавлять до полного контракта. Параллельно read-only Q08 bundle audit
выбирает один candidate с before/after measurement, без переписывания всех проектов;
Q09 реальные product screenshots и Q10
human customization остаются в очереди. Q11 внешний сервер/HTTPS/systemd и C07
installed desktop/mobile требуют отдельных реальных сред; локальный Linux proof их не заменяет.
Все ORIGINAL/GRAPH ветки и пользовательский TASK сохраняются. Main/push нет.

Библиотеки обновлены во всём каталоге, дальнейшая стратегия подготовлена.
[Отчёт обновления](../changes/common2-3.1.1-react2-5.0.0.md),
[стратегия Q01–Q10](../STRATEGY-2026-09.md). Новое поручение пользователя — непрерывно развивать удобство,
красоту, оптимизацию и проверки; после завершения очереди вернуться к планированию.
Работа продолжается: [активный журнал](progress/continuous-20260926.md).
Исторический baseline `npm run check:all` прошёл с настроенным Python; live Docker rollback
и documents advanced того checkpoint тоже прошли. Это не fresh full gate нынешнего или merged дерева.
Работа сохранена локально в codex/library-upgrade-20260926, push не выполнялся.
Графический календарь работ принят отдельно в managed worktree ветки `codex/work-calendar`:
органайзер, затем Booking. Этот checkout теперь использует codex/unified-chat.
Исходный checkout не переключать и его незавершённые изменения не переносить автоматически.
Здесь подготовлен Q04 backend машинного поиска Support; typecheck/test/build Support и hosting повторно прошли,
UI управления машинными ключами принят: target/runtime/browser проверки прошли,
Q04 сохранён коммитом `2e159e2` ([отчёт](../changes/support-product-keys.md)). Второй validation checkpoint завершён:
6 повторных проверок приложений, обновление STATUS и check:repo прошли; style и ссылки без нарушений.
Q07 Metering и Documents сохранены отдельно: `b11a848`, `affe595`.
Графики G01–G04 приняты в `codex/work-calendar`; её свободный managed checkout теперь используется
веткой `codex/unified-chat` для C01. Исходный checkout не переключать.
Новый чат C01 локально принят и сохранён `f083593`; targeted checks/reconnect/browser прошли.
Итог 37 PASS / 39 шагов, hosting SKIP, Catalog build отсутствует по контракту;
это не полный общий PASS перед main. C03 принят и сохранён e97161a после runtime,
repository и browser проверок. Оптимизация C-OPT-CHAT принята и сохранена 140d464.
Единая очередь со всеми зависимостями и остатками — [подробный план](../EXECUTION-PLAN-20260926.md).
Q03 теперь имеет 11/11 свежих **local product modes** в трёх selected runs:
`18801fd` [selected3](../changes/hosting-live-selected-20260926.md),
`0e385c1` [seven](../changes/hosting-live-seven-20260926.md),
`96828ea` [Documents](../changes/hosting-live-documents-20260926.md).
Единого current merged gate и внешнего HTTPS это не принимает.
Подробности проверок и следующие действия — в активном журнале.
План 3 выполнен 11 сентября: [отчёт](../reports/PLAN3-REPORT.md), журнал — [progress/plan3.md](progress/plan3.md).

## Новое направление Q12

Пользователь поручил синхронный чат-продукт: web + desktop + установленный mobile, аккаунты,
plain/remote режимы и специализированные дизайн/сайты-размещение/видео/приложения.
Долговечный [план C01–C08](../AI-CHAT-PRODUCT-PLAN.md) содержит реальные критерии каждой платформы,
capabilities агента и checkpoints упрощения. C01 plain web f083593 уже локально принят;
C03 изоляция аккаунтов сохранена `e97161a`: runtime 3/3, repository и browser PASS;
Team/Personal, две Alice sessions, A→B→logout, revoke/regrant и 360×500 проверены.
C02 streaming остаётся зависимым от опубликованного исправления AI policy/lifecycle и repro;
state-only workaround не заменяет semantic events. Реализация C01 находится в managed
checkout `codex/unified-chat`; туда добавлены два conversation repro на common2 3.1.1.
Не переносить сюда устаревший Support из графической базы: Q04 `2e159e2` сохраняется.
План уточнён суффиксами без смены ID: Q11-P prepared host/Q11-B clean bootstrap;
C07-F-MATRIX/X-MATRIX installed platform/cross-client proof; C06-P-TYPED/C06-A;
C05-CANCEL-FILE scoped cancel/artifact и Q08-PIZZERIA/SUPPORT/DOCUMENTS/METERING
human journeys. Plain C07/C06-P не ждут C02; AI режим ждёт published fix/repro.
Q05 backend принят `5755acb`: actual targeted/full/advanced PASS,
[machine отчёт](../changes/documents-machine-q05-20260926.md).
Documents owner keys [browser PASS](../changes/documents-product-keys-ui-20260926.md),
и принят `58d0aeb`: fresh typecheck 0.760 s/build 1.5 s и independent review PASS.
Это не merged gate. Q06-A `272f704` принят:
native typed value+Counter receipt, legacy 3.948 s/new machine 2.706 s PASS;
[отчёт](../changes/usage-q06-typed-handoff-20260926.md).
Q06-B принят `71c9d8c`: actual native Documents receipt/status/result сохраняются после
restart без reexecution, Counter/Documents fixture 5.5255 s и Documents full/advanced
с настоящим Python PASS. [Отчёт](../changes/usage-q06-documents-receipt-20260926.md).
Parent Q06 ждёт Support machine handoff, lost reserve/settle и reconciliation/crash gap;
null не означает no-cost, автоматические provider rerun/refund не разрешены.
После C03 выполнен C-OPT-CHAT: начальный JS уменьшен на 58,9% по raw bytes,
общий JS увеличился на 1 921 байт; targeted и browser повторены. Это размер артефактов,
не измерение времени загрузки. Отчёт находится в отдельном checkout общего чата.
Q01 lazy panels сохранён 9fed00b после 9/9 проверок CRM/Metering/Pizzeria.
Q05 recovery feasibility `0fb02a1` — исторический checkpoint перед принятым backend `5755acb`.
Q02 genuine historical сохранён `fffa851`: старый `2345729` с 2.21.1/3.5.1 создал
два настоящих composed archives, current 3.1.1/5.0.0 restore/cold restart/receipts/revoke PASS;
[отчёт](../changes/pizzeria-historical-q02-20260926.md). Schema 5→5, не schemas 1–4 migration/hot backup.
Docker Engine 29.7.2 реально использован для 11/11 local product modes; external host не принят.
Q08 accounting `661a870`: свежие 11 builds/все 12 Vite manifests/check:repo PASS;
[отчёт](../changes/bundle-accounting-q08-20260926.md). Это не fresh full app gate или human journeys.
Q11 `b14bece`: origin backend/UI/browser PASS,
[отчёт](../changes/hosting-public-origin-20260926.md); внешний HTTPS и Linux bootstrap pending.
Q11 artifact source/assets tar, отдельный SHA/target verifier и checked-byte immutable
snapshot прошли review/real fixture; root повтор PASS 5.543 s. Q11 artifact сохранён
a6f7201→integration19f4487: default fresh Vite pack PASS4.195s + отдельный verify,
manifest freshness=true, installedRuntime=false, source2163a0f. Own artifact
`work/hosting-installation/hosting-2163a0f.tar.gz`, SHA256
`2db1137cbb77ca2819ac07a9629cb548587c842d988f29be8dffae901b9ae0a7`.
Linux npm/installation/readiness pending; [граница](../changes/hosting-q11-artifact-foundation-20260926.md).
В GRAPH C07 technical slice сохранён `e1669c1`: actual Electron 44.4.5 PASS 2.192 s.
Installed HTTPS/backend/menu/mobile и C07 platform/history matrix не приняты.
Этот slice перенесён как b1ac4f2; baseline full gate был раньше переноса. Post-transfer
raw18952 EXIT1 только Chat desktop scaffold metadata, repair14d0276; следующий raw95073
PASS EXIT0, 38 actual/39, Catalog build absent/no environment SKIP, scaffold10/sync101/15/
style494/0/links814/0. Fake fail/skip runner regression не является app outcome.
Support fresh live36.666s покрывает новые assets:
[отчёт](../changes/support-history-live-20260926.md). Остальной Docker11 basis e4944c3 сохранён.
Catalog footer c6390f1 INTEGRATION/9ea82f7 ORIGINAL изменён до Catalog checks.
Q10 own Support-copy repeat15011 EXIT0 после первого55452 type FAIL: explicit dueAt guards/
disconnect?.() прошли quick re-review; install/type/build/currentroles/failover/restart/cold
directory restore и own cleanup PASS. de64a4a→27eb75b;
[subset report](../changes/scaffold-runtime-q10-20260926.md), full journey/browser/backup-format pending.
Q11 Ubuntu candidate repeat25390 EXIT0 после63344 tmp failure/TMPDIRfix: actual Ubuntu24.04/
amd64/Node24.18.0/glibc2.39/npmci/native authority/static/cleanup PASS, 80327be→98ce6a3;
[subset report](../changes/hosting-linux-runtime-q11-20260926.md). Clean-host/SSH/systemd/agent/TLS pending.
Booking transfer targeted20383 0.7/20.4/0.9с и browser cancel→realmove→reopen/cancel PASS,
console[], measured360×640 без horizontal overflow; desktop/mobile снимки и cleanup в
[отчёте](../changes/booking-transfer-ux-20260926.md). Held-response org/role/logout, browser
conflict/retry/DST и installed mobile не приняты. Эти новые subsets не входили в raw95073.

## Следующий текущий остаток

1. Documents owner keys UI 58d0aeb и Q06-B 71c9d8c приняты. Q06 parent pending Support/lost-settle/reconciliation.
2. Root создал managed integration от 58d0aeb:
   `C:/Users/wenay/.codex/worktrees/examples-integration/wenay-examples`,
   branch `codex/examples-integration-20260926`. Применены все семь graph commits:
   b627c4e/cf06b6e/25bb12a/9be324a/2bdd6b3/a378d2f/3569bcf.
   Root package union сохраняет bundle/hosting-live и status-before-verify.
   Baseline e4944c3 включает Q06-B. npm ci 13/13 и 38 app checks PASS.
   Первый raw check:all exit1 имел только три doc links errors; исправлено, check:repo PASS807/0.
   Raw check:all session4956 завершился PASS exit0 38/39: Catalog build отсутствует по контракту,
   environment SKIP нет; baseline acceptance98146ad. Chat manifest прошёл repository checks.
   Затем SupportUX b16c0da→53f5224, Q11artifact a6f7201→19f4487 и C07 e1669c1→b1ac4f2
   перенесены после baseline gate. Исторический raw18952 EXIT1 сохранён; Chat metadata
   repaired14d0276, actual finalraw95073 PASS EXIT0. Main/push нет, исходные checkout не переключать.
3. Merged all-11 Docker gate exact source e4944c3 PASS exit0 в 19:26:40.573Z;
   generic runtime исключён, external TLS/bootstrap отдельно. Сохранить baseline evidence,
   post-transfer raw95073 принят самостоятельно; прежние EXIT1 не переименовывать в PASS.
4. Следующий bounded Q06 research: current Support receipt handoff/lost-settle/reconciliation
   gaps до paid usage. Затем Q08 human journeys, Q09/Q10 и внешние/device/platform границы
   Q11/C07 по зависимостям [плана](../EXECUTION-PLAN-20260926.md). IDs и остатки сохраняются.
   Support history browser owner/customer/outsider/append PASS, UX сохранён b16c0da→53f5224.
   Fresh Q11 pack принят, Linux install не заявлен. npm views в19:32UTC подтвердил latest
   common2 3.1.1/react2 5.0.0 без изменений; B00 новый release gate не требуется.

## Главная цель

Мы создаём законченные, небольшие, практически полезные примеры на wenay-common2 и wenay-react2 и через их использование выявляем реальные потребности библиотек. Библиотеки должны покрывать типичные задачи без лишней обвязки. Бизнес-правила остаются в приложении; в библиотеку уходят только повторяемые общие механизмы или доказанные дефекты.

Цикл работы: реальный сценарий → существующий публичный API → минимальная композиция → работающие проверки → при нехватке воспроизводимое задание в `doc/library-tasks` → после публикации точное npm-обновление → удалить заменённую обвязку и повторить сценарий.

## Состояние на сегодня

- **13 приложений integration**: pizzeria (+ органайзер), hosting, support, documents, metering, crm, booking, forms, monitoring, content, catalog, approvals, chat. Пользовательский untracked `apps/facade-map/TASK.md` сохранён; он не входит в accepted app registry.
- **Одна команда проверки:** `npm run check:all` — typecheck, тесты и сборка всех приложений, регрессии runner/status и bundle graph, scaffold, синхронность, стиль, ссылки и сверка STATUS. Пиццерия собирает оба UI; Catalog build отсутствует по контракту. Логи привязаны к package+lock, что не доказывает source freshness. [Отчёт миграции](../changes/common2-3.1.1-react2-5.0.0.md) является историческим baseline; [STATUS](../STATUS.md) и fresh merged gate проверяются на окончательном дереве.
- **Библиотеки:** common2 **3.1.1**, react2 **5.0.0** во всех 12 integration потребителях, в pizzeria также **wenay-calls 1.0.0**; только точные опубликованные npm версии и lock. Catalog библиотек не использует.
- **Открыто у common2:** AI-POLICY-INVALIDATION и AI-RESOURCE-LIFECYCLE повторно воспроизведены на 3.1.1, три места обхода сохранены. STORE-NESTED-REPLACEMENT исправлен; два обхода удалены, repro --expect-fixed включён в support test. [Реестр](../library-tasks/WORKAROUNDS.md), [пакет](../library-tasks/CURRENT-HANDOFF.md). Подтверждённых задач react2 нет.
- **План 2 завершён:** [отчёт](../reports/CONSOLIDATION-REPORT.md) содержит таблицу 36 задач, показатели, что не проверено и открытые вопросы. Ответы на эти вопросы даны в разделе 2 плана 3.

## Правила и ограничения

- Прочитать [AGENTS.md](../../AGENTS.md) и [правила кода](../CODE-RULES.md), включая раздел «Плотность»: `node scripts/style-check.mjs` должен оставаться на нуле.
- Общаемся по-русски, короткими понятными обновлениями о результате. Не завершать работу после каждого микрошага.
- Целевой дополнительный расход RAM 1–2 ГиБ, максимум 3. Проверки — последовательно.
- Платных ИИ-вызовов нет: помощники проверяются тестовым исполнителем. Реальные модели, платежи и внешний OIDC не настроены.
- Docker установлен, но проверять его наличие через `docker info`. Не запускать тяжёлый кластер, реальные VM и локальные модели. Не выполнять `docker prune` и не трогать чужие контейнеры.
- Не выполнять `git push`, `git reset --hard`, `git clean`, `npm publish`. Один коммит на задачу.
- Не трогать `work/`, `apps/*/data/`, `apps/*/*-data/`, `apps/*/public/`, `node_modules/` и временные копии в `%TEMP%`.
- Для нового существенного этапа заводить `doc/internal/progress/<план>.md` и дописывать строку после каждой задачи.

## Границы, которые нельзя размывать

- Горизонтальная проверка означает **один владелец записи + несколько обслуживающих узлов**. Это не HA-база и не несколько одновременных писателей.
- LXD-адаптер и protocol fixtures — не настоящая VM; Kubernetes не запускался.
- Живые экран, микрофон и межмашинная сеть требуют [отдельной приёмки](../DEVICE-ACCEPTANCE.md) и остаются непройденными.
- Замеры маленьких Docker-контейнеров (52–60 MiB при лимите 256) — не замер пика машины.
- Копия и восстановление данных проверены холодным путём; горячая копия не делается.

## Что читать дальше

Сначала [стратегию сентября](../STRATEGY-2026-09.md) и
[последнее обновление](../changes/common2-3.1.1-react2-5.0.0.md); документы ниже сохраняют историю.

1. [Отчёт плана 3](../reports/PLAN3-REPORT.md) — что сделано последним и что осталось открытым.
2. [Отчёт плана 2](../reports/CONSOLIDATION-REPORT.md) — предыдущий этап.
3. [Профили размещения](../DEPLOYMENT.md) — как запускать и размещать примеры.
4. [80 задач плана 1](../SAAS-EXAMPLES-BACKLOG.md) — единственный источник статусов продуктовых задач.
5. [Паспорта приложений](../../apps) и их README — сценарии, роли, команды.
6. [Контрольная точка 10 сентября](SAAS-CHECKPOINT-2026-09-10.md) — историческая, для понимания принятых решений; текущим статусом не является.

