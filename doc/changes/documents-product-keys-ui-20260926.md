# Documents: браузерная проверка owner machine keys UI

26 сентября 2026, ORIGINAL. Backend machine facade принят отдельно в `5755acb`.
Этот срез добавляет owner-only управление ключами на странице «Команда» и использует
native `productKeys.control.list/issue/revoke` через опубликованные common2/react2.

## Реализация и source evidence

Новый `frontend/product-keys.tsx` открывает ресурс через useOwnedClient, затем читает его
status store через useClientStore. Consumer существует только при resource ready;
native generation определяет его remount. Owner condition, organization key, account
Workspace key, closed resource и late-response checks очищают локальные draft/ticket/error/secret
при завершении соответствующего scope. Resource создаётся до consumer.

Выпуск удерживает immutable requestId/orgId/label/days/scopes до подтверждения ответа.
Форма заморожена до повтора или явной отмены; синхронный pending guard useAsyncAction
не допускает параллельных операций. Retry сохраняет native ticket, не выпускает второй ключ.
List — серверные metadata без hash/plaintext, читаемые при открытии, после изменения и вручную;
оптимистического списка нет. Secret существует только в памяти consumer из первого ответа,
copy выполняется по нажатию. Null secret объясняет revoke/recreate без восстановления plaintext.
Native current ACL и хранение hash не менялись.

Независимый source review: PASS, обязательных P1/P2 исправлений не найдено.
Финальный авторский `npm run typecheck` PASS (1.0 с), diff check PASS.
Root final targeted gate ещё предстоит; этим отчётом новый test/build результат не объявляется.

## Фактический Chrome результат root

Использована собственная synthetic fixture `scripts/documents-keys-browser.mjs`:
публичный createDocumentRuntime/createServiceLeaderHost, новый временный архив,
native ledger/resources/receipts и terminal controls. Owner имеет Northstar и Harbor;
fixtureAdmin меняет роль native memberRole, сохраняя второго владельца. Документный
processor отключён, внешние AI/provider/user data не используются.

| Сценарий | Наблюдаемый результат |
| --- | --- |
| Owner issue/list/copy/revoke | Ключ выпущен, metadata видны, explicit copy показал «Скопировано», отзыв подтверждён |
| Fail-next после native persistence | Same exact ticket retry создал всего один ключ; secret=null и объяснение потери секрета; затем revoke |
| Переключение в Harbor | Secret, ticket, форма и список прежней организации очищены |
| Hold-next issue → revoke-owner → release | Native key уже сохранён; после потери owner роли controls и панель исчезли, поздний plaintext не показан |
| Restore-owner | Панель открылась с новой пустой формой; authoritative list содержит четыре keys, включая поздно выпущенный |
| Reviewer и customer/uploader | «Команда» открывается без управления ключами |
| Logout | Рабочий scope закрыт, возврат к login |

Новая вкладка `1864035212`: фактически **innerWidth=360 CSS px**, viewport **360×640**,
document scroll width **345 px**. В ней повторены owner login → Team → keys,
held issue/role loss/release, restore-owner с fresh form и отрицательные reviewer/customer
сценарии. Это проверенная узкая browser UI ширина, не Android/iOS installed acceptance.
Root dev.errors=[]; подтверждённых product defects в этой проверке не найдено.

Одна AX операция попала в stale input после смены section#documents; root повторно нашёл
элементы семантическими locators и продолжил сценарий. Product defect этим не подтверждён.

Screenshot без secret сохранён в
[documents-keys-browser-20260926.png](../reports/documents-keys-browser-20260926.png).
Это whole-window screenshot при CSS viewport 360; размеры самого PNG не являются доказательством
browser innerWidth. Для narrow acceptance использованы фактические measurements выше.

## Очистка и границы

Root выполнил originViewport.reset, закрыл вкладку, ввёл stop fixture: exit0.
Собственный временный каталог с суффиксом `jepNYf` после остановки: Test-Path=False.
Ни пользовательский архив, ни реальные ключи/credentials не читались.

Clipboard equality независимо не проверялась: приняты нажатие copy и статус «Скопировано».
Draft/ticket continuity при reconnect **не принята**: текущие ready/permission boundaries
могут безопасно уничтожить локальную форму и secret, после чего нужен list/revoke/reissue.
Все invalid input shapes, двухвкладочная гонка и device installation этим browser run
не объявляются проверенными. Machine processing/HTTP, expiry enforcement, persistence recovery
и metering имеют отдельные backend/composition evidence; отключённый processor fixture их не принимает.

## Exact source scope

- `apps/documents/frontend/product-keys.tsx` — новый consumer.
- `apps/documents/frontend/main.tsx` — import и owner-only Team integration.
- `apps/documents/frontend/style.css` — только scoped keys selectors.
- `apps/documents/scaffold.json` — новый frontend file.
- `apps/documents/README.md` — только owner keys UI notes и ссылка на этот результат.
- `scripts/documents-keys-browser.mjs` — isolated browser fixture.
- Этот durable report и screenshot.

Backend/package/lock/Vite, Q05/Q06 composition, Q08 manifests/STATUS и shared plans не входят.
Completed progress/review notes не нужны для исходного UI commit: durable результат приведён здесь.
Root выполнил свежие `npm run typecheck` (exit 0, 0.760 с) и build через общий
runner (exit 0, Documents 1.5 с). Независимый source review обязательных P1/P2
не обнаружил. Это финальные проверки UI среза; текущая отдельная backend работа
Q06-B требует своих runtime проверок. Commit сохраняет root отдельно.
