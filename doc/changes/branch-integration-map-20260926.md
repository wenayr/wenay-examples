# Карта интеграции original и graph

Durable historical snapshot: перенесён из doc/progress после сохранения own notes, без изменения исходного анализа. HEAD/dirty scope ниже относятся к моменту анализа после C03 e97161a; последующие этапы не следует считать частью этого snapshot. Ссылок на прежний progress path при переносе не обнаружено.

26 сентября 2026. Только read-only анализ git/source; merge, cherry-pick, stash,
переключение веток, app edits, коммиты и проверки не выполнялись.

Original: `C:/Users/wenay/WebstormProjects/wenay-examples`,
`codex/library-upgrade-20260926`, HEAD `b32de7d`.
Graph: managed `work-calendar/wenay-examples`, `codex/unified-chat`, принятый HEAD
`e97161a` (C03). Общая база `f65b1af9aae62b230a09264f56f41bbcb7981cc6`.
Graph имеет незакоммиченную C-OPT правку `apps/chat/frontend/main.tsx`; она не входит
в C03 e97161a и не должна случайно попасть в перенос принятого C03.

## Предпочтительная база и порядок

Интеграционный результат должен опираться на original с сохранёнными Q04/Q07,
а не на копирование всех файлов graph поверх original. Original checkout грязный:
его Q01/Q02/Q03/Q08 изменения и untracked файлы сначала нужно завершить/сохранить
отдельно по правилам задач. Текущую карту нельзя трактовать как разрешение переносить
или убирать эти изменения. `apps/facade-map/` — отдельное пользовательское содержимое,
в интеграцию G/C автоматически не включать и не удалять.

После сохранения исходных задач использовать отдельный чистый интеграционный checkout
от original. Переносить только graph commit delta от общего предка, а не tree snapshot.
G01 `b03eabf`, G02 `e9dae43`, G03 `1fa38a2`, G04 `4ff49d2`, C01 `f083593`,
C03 `e97161a` — зависимая последовательность. Cherry-pick этого ряда возможен после
сохранения original, либо merge принятой graph ветки с разрешением общих файлов;
оба пути требуют заново принять итоговый current code. C-OPT добавлять отдельным
принятым коммитом после C03, когда закончены его измерения/приёмка.

## Конкретные пути и разрешение

| Пути | Пересечение и решение |
| --- | --- |
| `package.json` корня | Original Q08 добавляет bundle-status-check, status:bundles; Q03 добавляет check:hosting-live. Graph G03 добавляет status между check:apps и check:repo. Итог сохранить все: check:all = check:apps → status → check:repo, причём check:repo включает bundle-status-check. Не выбрать файл целиком одной стороны. |
| `scripts/run-all.mjs` | Graph добавляет chat в APPS после approvals; original pending его не меняет. Сохранить 13 приложений и последовательный runner. Это влияет на status/catalog/browser-session и будущий live registry. |
| `scripts/sync-map.json` | Original pending добавляет canon shared/react/deferred-panel.tsx и три copies CRM/Pizzeria/Metering. Graph добавляет apps/chat/backend/identity.ts к identity copies. Сохранить обе записи/дополнения. После union сравнить canonical+copes, не затирать organizer domain graph. |
| `scripts/status.mjs`, `scripts/bundle-status-check.mjs` | Original Q08 — новый manifest walker initial/full JS/CSS graph и fixtures. Graph script status не меняет, но меняет APPS/STATUS. Сохранить original реализацию и новый checker; результаты для chat требуют manifest. |
| `apps/*/frontend/vite.config.ts`, `apps/pizzeria/organizer/vite.config.ts` | Original pending включает build.manifest во всех прежних Vite UI. Graph добавляет chat/vite.config.ts без manifest. Перенести manifest-опцию для chat отдельной согласованной Q08 адаптацией, иначе Q08 честно покажет chat полный граф неизвестным. Не скрывать это старым total. |
| `doc/STATUS.md` | Меняется обеими сторонами и original pending. Не разрешать выбором старых строк PASS/размеров. После итоговых package/lock и сборок запускать status; check:all должен генерировать его перед verify. Старые логи не подтверждают объединённый package fingerprint. |
| `apps/catalog/presentation.json` | Graph добавляет авторскую карточку chat; original этот файл не меняет. Сохранить карточку. |
| `apps/catalog/products.js` | Генерируется catalog script из presentation + status/passport. Не переносить stale graph generated снимок как итог. После union APPS и новой приёмки запускать npm run status, который включает catalog.mjs. Не утверждать Catalog build PASS — build отсутствует по контракту. |
| `scripts/browser-session.mjs` | В original untracked базовый helper; graph добавляет committed расширенный helper с native seedOrganizer/seedBooking и flags. Это реальный add/untracked collision. Сравнить весь файл перед сохранением original; использовать graph функциональный superset с временными fixture/cleanup, сохранив любые новые original отличия. Не подменять молча существующий untracked файл. |
| `apps/pizzeria/frontend/main.tsx`, `shared/react/deferred-panel.tsx`, app copy | Original Q01 lazy Organizer + DeferredPanel; graph frontend/main не меняет. Сохранить original lazy boundary; импортированная organizer/board получит graph календарь через уже существующий lazy chunk. |
| `apps/pizzeria/organizer/board.tsx`, `schedule*.tsx/css/ts`, `style.css`, `check.ts` | Graph G01/G04 календарь день/неделя, drag и schedule checks. Original pending эти пути не меняет. Перенести graph delta целиком вместе с командами/типами, не один UI. При открытии lazy команды проверить календарь в embedded и standalone UI. |
| `shared/organizer/task-domain.ts`, `apps/{pizzeria,support,crm,monitoring}/organizer/task-domain.ts` | Graph adds workScheduleTask, сохранение schedule при edit и запрет снять assignee с расписанной задачи. Original pending domain не меняет. Сохранить graph canon и синхронные copies; после Q04 union повторить Support и остальных потребителей. |
| `apps/{pizzeria,support,crm,monitoring}/organizer/task-model.ts` | Graph добавляет optional schedule; нужны все четыре копии в согласовании с domain. Не откатывать types при сохранении original app snapshot. |
| `apps/pizzeria/backend/check.ts` | Graph обновляет ожидаемый chef command list с workScheduleTask; original pending не меняет. Сохранить graph assertion вместе с native command exposure. |
| `apps/pizzeria/package.json`, `backend/backup-check.ts`, README/PASSPORT | Original Q02 добавляет test:backup к npm test и composed archive fixture, Q01 docs lazy boundary. Graph package/README/PASSPORT не меняет. Сохранить original изменения. Backup fixture использует original process и public services; после календаря повторить restore/receipt tests, несмотря на optional schedule schema. |
| `apps/booking/backend/{domain.ts,schedule.ts,runtime.ts,domain-check.ts,reschedule-check.ts}` и `frontend/{calendar.tsx,schedule*.tsx/ts/css}`, `scaffold.json` | Graph G02/G04 сохранять целиком: current availability/reschedule и race/UI recovery связаны. Original pending меняет только Booking Vite manifest, поэтому текстовый конфликт маловероятен, но build/runtime/live images должны быть новые. |
| `apps/crm/frontend/{deals.tsx,deal-table.tsx}`, `apps/metering/frontend/main.tsx`, их deferred-panel copies/scaffold/README | Original Q01/Q08 lazy изменения сохранить; graph не меняет эти пути, но меняет organizer domain/model их backend. Нужна композиционная проверка, а не выбор целого app каталога. |
| `apps/hosting/backend/stateful-live-check.ts`, `LIVE-GATE.md`, `README.md`, `DOCKER.md`, `scripts/hosting-live-gate.mjs` | Original Q03 pending env override image manifest и full public-address aggregate gate. Graph эти пути не меняет. Сохранить original; G/calendar меняют Pizzeria/Booking runtime, значит прежние Docker images/logs не принимают новый результат. |
| `apps/chat/**` | Только graph C01/C03; переносить с package+lock, native workspace public contracts и public login mitigation. Не привносить незавершённую C-OPT main правку в C03 commit. |

## Support: запрет регрессии Q04

Original `2e159e2` вводит принятые machine product keys/search; graph находится на
более раннем основании и их не содержит. Прямой diff original HEAD→graph показывает
удаление `product-credentials.ts`, `product-search.ts`, `frontend/product-keys.tsx`,
существенное урезание product-check и API. Это обратный diff веток, а не разрешённая
graph feature delta; копирование graph каталога Support уничтожит Q04.

Сохранить original версии `backend/{article-index,assistant-resource,domain,model,
product-check,product-credentials,product-http,product-search,runtime,server,service}.ts`,
`frontend/{main,product-keys}.tsx`, `frontend/style.css`, API/README/scaffold.
Поверх них применить только graph organizer task-domain/task-model delta.
Original pending `frontend/conversation-history.tsx` (trim query, applied-search status,
clear/loading) и Vite manifest сохранить отдельно. Они не заменяют Q04 и ещё требуют
своей browser приёмки. Повторить machine owner/user gating, issue/list/copy/retry/revoke,
retained bearer/remote expiry/revoke, IO settlement close, org switch/logout.

Аналогично сохранить original Q07 `b11a848` Metering playground и `affe595` Documents
version-comparison. Эти файлы graph не меняет относительно общего предка; snapshot
из graph отбросит исправления. Original `a685195` Support live report сохранить,
но не считать его PASS для новых итоговых images после integration.

## Документы общего контекста

`doc/AI-CHAT-PRODUCT-PLAN.md` — add/add обеих веток: original содержит более полный
план с clean bootstrap/platform matrix/typed remote/scoped cancel-file/human journeys;
graph добавляет C01/C03 доказательства и библиотечные ограничения. Объединить по ID,
не заменить original план ранней graph копией. `doc/internal/NEXT-CHAT.md` содержит
разошедшиеся статусы: сохранить original Q04/Q07/Q03 и graph G/C acceptance с точными
commit IDs; убрать старую фразу «C03 ещё не принят» только на основании e97161a report.
Сохранить original EXECUTION-PLAN/STRATEGY/continuous journal и graph acceptance reports,
unified-chat journal/library task registry; временные progress docs не переносить как PASS.

## Проверки после сборки итогового состояния

1. Проверить targeted typecheck/test/build Pizzeria (оба UI), Booking, Chat; Pizzeria npm
   test включает original backup fixture, organizer checks включают native schedule checks.
2. Проверить Support typecheck/test/build и product-check, CRM/Monitoring organizer
   command/type интеграцию; Documents/Metering Q07 и original lazy boundaries.
3. При свежих builds с manifest проверить bundle-status-check, initial/full graphs
   Pizzeria двух UI и остальных, Chat отдельно; затем sync/scaffold/style/links/status verify.
4. Повторить browser календарь день/неделя+роль worker/manager, Booking stale-slot race,
   failed move rollback/available slots, embedded lazy Organizer, Support human search/key UI,
   Chat account/workspace/revoke/regrant/reconnect и mobile 360×500.
5. Запустить единый check:all на итоговых точных package+lock с Python и нужным Docker.
   Hosting skip не превращать в PASS и не допускать main без требуемого общего gate.
6. Q03 live после fresh images: original aggregate full public-address gate, сначала
   Organizer/Pizzeria/Booking/Support как изменившаяся композиция, затем остальные
   обязательные продукты; выполнить новый deploy/update/rollback, сохранить package/image
   fingerprints. Legacy Q02 archive и installed/AI/remote acceptance остаются отдельными.

Следующее действие: root выбирает момент сохранения pending original задач и интеграции
в отдельном чистом checkout. Этот анализ не изменил apps и не запускал операции Git записи.
