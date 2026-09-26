# Q01: отложенные панели CRM, Metering и Pizzeria

2026-09-26, ORIGINAL `codex/library-upgrade-20260926`. Этот срез принимает локальную реализацию lazy boundaries и подтверждённые targeted checks, а не весь Q01/device scope. Exact installed dependencies: common2 3.1.1, react2 5.0.0. Q08 manifest/status infrastructure остаётся отдельной pending задачей; её текущие manifests использованы только для чтения размеров artifacts.

## Поведение

CRM выносит DealTable и public grid imports в `frontend/deal-table.tsx`; Deals грузит его через React.lazy при открытии «Таблица» или «Архив». Воронка остаётся в initial graph. Rows, checked selection, archive restrictions, форматирование и открытие карточки передаются прежними props. Таблица сохраняет native react2 grid ownership.

Pizzeria грузит полноценный Organizer board при первом открытии «Команда и задачи». WorkloadPanel остаётся доступен в основном UI. Это boundary встроенного editor, а не отключение summary или самостоятельного Organizer: standalone organizer-public по-прежнему имеет собственный eager entry.

Metering Ledger уже был lazy до этого среза. Изменение Q01 заменяет локальный Suspense на общий DeferredPanel; не приписываем Q01 новое отделение grid в этом приложении.

Canonical `shared/react/deferred-panel.tsx` объединяет Suspense с loading `role=status`/`aria-live=polite` и React error boundary. При render/load failure граница показывает `role=alert` и явную кнопку reload страницы; остальные части UI остаются вне этой границы. Boundary не владеет application resources. Это не автоматический retry и не обещание сохранения несохранённых правок при reload. Три app copies byte-identical канону при readonly проверке; sync-map и CRM/Metering scaffold включают новые файлы.

## Проверки и границы evidence

Root последовательно запустил `node scripts/run-all.mjs typecheck test build --only=crm`, затем metering и pizzeria. Ниже реальные headers `work/run-all/*` (code 0, status ok); текущий package+lock fingerprint каждого app совпадает с headers. Этот review не выполнял повторные tests/build/CUA.

| App | Typecheck, с | npm test, с | Build, с | Окончание build, UTC |
| --- | ---: | ---: | ---: | --- |
| CRM | 1.175 | 22.469 | 2.234 | 2026-09-26 18:10:57.466 |
| Metering | 1.396 | 20.947 | 1.712 | 2026-09-26 18:13:43.534 |
| Pizzeria | 0.924 | 71.721 | 2.491 | 2026-09-26 18:22:22.446 |

Fresh targeted checks: 9/9 PASS. Новых Q01 mirror/unit tests не добавлено: существующие app suites проверяют прежние domain/runtime contracts; они сами по себе не доказывают loading/error UI. CRM manual browser acceptance ранее подтвердила table/search/selection/card/keyboard/Escape/archive без console errors ([предыдущий аудит](previous-tasks-audit-20260926.md)). Это историческое local UI evidence, не новый browser прогон каждого приложения после данного отчёта и не замер initial network transfer/parse/latency. Physical devices и общий Q01 scope здесь не приняты.

Pizzeria npm test включает новый composed cold backup fixture текущего архива: order/task/receipt/photo/chat/attachment/completed test AI; stop/copy/restore/restart и negative corruption/version cases. Он относится к **Q02**, а не lazy panel implementation. Его PASS не подтверждает восстановление historical old-version archive; Q02 historical migration/restore остаётся pending.

## Текущий reachable artifact budget

Readonly `measureBundle` из существующего Q08 `scripts/status.mjs` прочитал HTML и Vite manifests четырёх уже созданных outputs. Initial — HTML assets + static imports/CSS; full — весь reachable static/dynamic JS/CSS graph, каждый файл один раз на UI. Main JS — только entry asset. Все значения raw bytes, без compression; complete=true для всех четырёх. Stale/unreachable output files не учитываются.

| UI | Main entry JS, bytes | Initial JS/CSS, bytes | Full JS/CSS, bytes | Deferred delta, bytes |
| --- | ---: | ---: | ---: | ---: |
| CRM/public | 614869 | 635538 | 1609914 | 974376 |
| Metering/public | 468446 | 491974 | 1470788 | 978814 |
| Pizzeria/public | 466240 | 479439 | 680242 | 200803 |
| Pizzeria/organizer-public | 608284 | 628111 | 628111 | 0 |

Entries: CRM `index-CpkxxykI.js` → dynamic `deal-table-D2mjDQoy.js`; Metering `index-qamBwbZk.js` → dynamic `ledger-DvVEQaW5.js`; Pizzeria `index-Bb0VxyZY.js` → dynamic `board-BN23O05l.js` + board CSS; standalone Organizer `index-DipEaIZF.js`. Dynamic entries import index.html backreference; graph walker uses visited set, avoiding duplicate entry accounting.

Если агрегировать два Pizzeria UI, initial=1107550 и full=1308353 bytes. Эти суммы не соответствуют одному browser page load. Размеры показывают существование отложенной части; baseline до Q01 заново не собран и percentage improvement не заявляется. Full cost при открытии панелей остаётся, а initial runtime network/timing не измерялся.

## Точный Q01 commit scope

Полные файлы Q01:

- `shared/react/deferred-panel.tsx`
- `apps/crm/shared/react/deferred-panel.tsx`
- `apps/metering/shared/react/deferred-panel.tsx`
- `apps/pizzeria/shared/react/deferred-panel.tsx`
- `apps/crm/frontend/deals.tsx`
- `apps/crm/frontend/deal-table.tsx`
- `apps/crm/README.md`
- `apps/crm/scaffold.json`
- `apps/metering/frontend/main.tsx`
- `apps/metering/README.md`
- `apps/metering/scaffold.json`
- `apps/pizzeria/frontend/main.tsx`
- `scripts/sync-map.json` (текущая delta — только deferred-panel канон и три copies)
- `doc/changes/lazy-panels-q01-20260926.md`

Смешанный `apps/pizzeria/README.md`: для Q01 брать только два новых абзаца про встроенную команду/lazy/loading/error. Backup paragraph оставить Q02. `apps/pizzeria/PASSPORT.md` имеет только backup delta, значит **не включать** в Q01; `apps/pizzeria/package.json` и `backend/backup-check.ts` тоже Q02.

Не включать `apps/*/frontend/vite.config.ts`, `apps/pizzeria/organizer/vite.config.ts`, `scripts/status.mjs`, `bundle-status-check.mjs`, root package.json, generated STATUS/catalog: это Q08/другие этапы. Hosting changes/helpers/reviews и Support UI также вне Q01. Build outputs не коммитить. Перенесённая [карта интеграции](branch-integration-map-20260926.md) — отдельный исторический planning artifact, не app delta Q01; при желании сохранить отдельным docs scope.
