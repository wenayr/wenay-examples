# Начальный и полный вес текущих UI

Read-only baseline INTEGRATION `5616e92`, 26 сентября 2026.
Измерены существующие artifacts; source/build/browser не менялись и не запускались.
Публичные зависимости приложений common2 3.1.1/react2 5.0.0, без собственного transport/replay.

## Метод и актуальность

Использован экспорт `measureBundle` из существующего `scripts/status.mjs` и текущие Vite
`.vite/manifest.json`. Разделение по расширению сделано для тех же HTML entry/static/dynamic
reachable sets; суммы initialJS+initialCSS и totalJS+totalCSS сверены с exported measurement
для каждого UI. Никакого суммирования каталога assets: unused/stale файлы исключены.
Build log fingerprint сравнен с существующим `fingerprint(app)` из run-all: все12 built apps
совпадают только по package.json/package-lock.json (`current=true`, code0/statusok).
Это dependency fingerprint, не measured source hash и не доказательство свежести app code.
Pizzeria имеет2 UI, Catalog build отсутствует по контракту.
Timestamp manifest — время файла artifact, не самостоятельное доказательство git commit;
dependency fingerprint source identity не измеряет. Source basis: actual root raw27106
PASS на9d47359 плюс subsequent Forms5616e92 target56033e type0.7/build1.0 PASS.
Read-only `git diff --stat -- apps`/`git status --short -- apps` при5616e92 пусты;
это отсутствие текущих app edits, не криптографическая привязка каждого artifact к source.

Все числа ниже — **raw bytes**, без gzip/brotli/images/fonts/API/download cache.
DynamicJS — reachable totalJS минус static initialJS; не обещание, что каждый chunk загрузится
в данном journey. Initial означает HTML/static graph, не фактическое время network/parse.

| Приложение/UI | Initial JS | Dynamic JS | CSS initial / total | Полный JS+CSS | Manifest UTC |
| --- | ---: | ---: | ---: | ---: | --- |
| Pizzeria | 466240 | 205622 | 13199 / 47852 | 719714 | 2026-09-26T20:25:39.129Z |
| Pizzeria Organizer | 632926 | 0 | 34653 / 34653 | 667579 | 2026-09-26T20:25:39.946Z |
| Hosting | 442894 | 0 | 2887 / 2887 | 445781 | 2026-09-26T20:25:57.994Z |
| Support | 623832 | 0 | 30228 / 30228 | 654060 | 2026-09-26T20:26:32.754Z |
| Documents | 582041 | 0 | 22033 / 22033 | 604074 | 2026-09-26T20:27:20.874Z |
| Metering | 468446 | 978814 | 23528 / 23528 | 1470788 | 2026-09-26T20:27:42.876Z |
| CRM | 615055 | 974376 | 20669 / 20669 | 1610100 | 2026-09-26T20:28:07.293Z |
| Booking | 763756 | 0 | 24282 / 24282 | 788038 | 2026-09-26T20:28:38.309Z |
| Forms | 600904 | 0 | 15617 / 15617 | 616521 | 2026-09-26T20:33:56.513Z |
| Monitoring | 589467 | 0 | 11318 / 11318 | 600785 | 2026-09-26T20:29:46.003Z |
| Content | 596364 | 0 | 17682 / 17682 | 614046 | 2026-09-26T20:30:16.878Z |
| Catalog | — | — | — | — | Нет Vite graph; это не zero-cost UI |
| Approvals | 444635 | 0 | 5190 / 5190 | 449825 | 2026-09-26T20:30:44.288Z |
| Chat | 214594 | 309406 | 9430 / 9430 | 533430 | 2026-09-26T20:30:55.399Z |

13 apps представлены;14 строк из-за двух независимых Pizzeria UI.
Не складывать Pizzeria и Organizer как загрузку одной страницы.
CRM dynamic deal-table974376B и Metering ledger978814B уже deferred; AG Grid не находится
в их initial chunk. Chat client99632B/rpc-deadline126335B/conversation-owner83439B также dynamic.
Pizzeria board205622B deferred, отдельный Organizer entry632926B — static.

## Три осмысленных кандидата, ещё не измеренные изменения

1. **Booking: Calendar graph после входа.** `frontend/main.tsx` статически импортирует Calendar,
   который тянет `schedule`, `schedule-card`, `schedule-math` и `@js-temporal/polyfill`.
   Contracts не импортирует Temporal runtime. Минимальный candidate — React.lazy существующего
   Calendar в main, с локальным понятным Suspense loading. Это реальный тяжёлый dependency boundary,
   а не дробление маленькой settings формы. Default workspace открывает calendar, поэтому выигрыш
   относится прежде всего к login; суммарные post-login bytes не должны называться уменьшением.
   Gates: manifest показывает Temporal/calendar только dynamic, raw initial reduction измерена,
   total overhead записан; type/test/build и login→calendar/transfer/cancel/reopen/current-scope/mobile
   повторены. Конкретное число savings сейчас неизвестно: весь763756B entry не равен Temporal.
2. **Forms: respondent отдельно от staff editor/results.** Сейчас `main.tsx` импортирует
   FormEditor/Results и Respondent до проверки `#respond`. Публичный участник получает staff editor,
   reorder/Overlay, Results/grouping UI, хотя отвечает только через publicform.
   Candidate — маленький entry audience split с lazy существующей staff UI; сохранить typed
   resources/current-version deny и существующий authenticate. Не создавать новый session framework.
   Gates: static public graph не содержит editor/results-only modules, measured initialJS/CSS/total,
   v1/v2/old link/required/analyst и staff login regressions. Shared client/hooks остаются в обоих
   аудиториях; exact benefit неизвестен без approved build. Не обещать убрать всё600904B.
3. **Content: public journal отдельно от editorial workspace.** `main.tsx` статически импортирует
   PageEditor/ReviewDesk/MediaLibrary и PublicJournal до `#read` dispatch. Public reader не нуждается
   в editor reorder/media/review/assistant UI. Минимальный candidate — deferred existing staff
   application при отдельном public branch, без нового routing/transport/backend.
   Gates: public reachable static graph исключает staff-only modules; measured bytes reduction/total
   overhead, anonymous journal/public revision/attachment ACL и staff publish/revoke/logout проверены.
   Service session/common hooks разделяются, поэтому client baseline не исчезнет; выгода pending.

Один candidate реализуется отдельно только после выбора root, остальные остаются read-only proposal.
Если build показывает лишь несколько KB выгоды или boundary ломает lifecycle, не внедрять ради числа.
CRM lazyTasks/Imports уже оценён: общий тяжёлый AG Grid dynamic, panel-only savings небольшие;
этот вариант не выбран. Реальные пользовательские сценарии имеют приоритет перед новым wrapper.

## Что baseline не доказывает

Bytes не измеряют время запуска, CPU, RAM, React renders, reconnect latency или backend расход.
Одинаковые библиотеки каждого самостоятельного app не означают общий browser cache между origins.
Не объединять приложения новым общим runtime/framework ради дедупликации без самостоятельного
контракта. Existing published common2/react2 остаются основным механизмом; умеренные domain
adapters не заменяются параллельной инфраструктурой. Actual timings/RAM требуют отдельного
bounded runtime measurement в одинаковых условиях. Все3 optimization outcomes PENDING.
