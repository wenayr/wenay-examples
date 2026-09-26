# C07: desktop endpoint setup source и подготовленный technical probe

26 сентября 2026, managed GRAPH `codex/unified-chat`. Реализован scoped source каркас Windows
Electron shell для прежнего HTTPS plain Chat web UI, включая локальный first-launch endpoint setup.
**Technical hidden-window smoke принят; product runtime и installed Windows/mobile acceptance не приняты.**
Source агент не устанавливал и не запускал Electron; actual isolated probe выполнял root.
active desktop package.json/lock, installer и root/shared Chat code не создавались/не менялись.

## Поведение и безопасность

Первый запуск без валидной настройки показывает отдельную локальную форму server origin и явное
«Подключиться». Main допускает только canonical HTTPS без credentials/path/query/fragment/wildcard/comma,
сохраняет только `{version:1,origin}` в собственной settings directory. Bounded strict JSON read,
guarded staging/atomic rename, invalid settings→setup; no tokens/password/history/local journal.
Сохранённый сервер открывается при следующем запуске. CLI/env адрес больше не требуется.

Remote window сразу видимо: «Подключаемся к origin…» и indeterminate taskbar progress. До ответа
область content может быть пустой; fake Chat page не внедряется. Production load bounded 15 seconds,
failure/timeout→stop, destroy старого renderer, close connections, clear own storage/cache, editable
setup с понятной ошибкой. Current window/generation/quit guards отсекают поздний callback.
«Сервер → Сменить сервер / выйти» выполняет тот же local session reset; новая unique nonpersist
partition требует login даже на прежнем endpoint. Глобальный backend token revoke не обещается.
Обычный last-window close завершает приложение, minimize остаётся taskbar; Tray не добавлен.

Remote renderer сохраняет sandbox/contextIsolation/Node-off/webSecurity и **не имеет preload/IPC**.
Навигация только same HTTPS origin, дополнительные restrictive CSP headers не заменяют server policy,
popups/webview/download/permissions denied. Token/client/RPC/reconnect/history остаются прежнему web UI.
Production remote factory лишь извлечена в отдельный deps-based файл после reviewer согласования.

Локальное setup окно имеет отдельную session и narrow read/configureOrigin preload. Secure standard
protocol отдаёт только три packaged GET assets, строгая CSP без inline/eval/network. IPC scoped к
webContents и проверяет sender identity/mainFrame/not-detached/exact URL/serialized origin/generation
перед IO и после await. Null origin fail-closed. Фактический custom scheme origin и preload IPC
подтверждены отдельным actual Electron probe ниже; source/mocks сами по себе этого не доказывают.

## Source evidence и actual technical probe

Node syntax и source-check PASS: origin/navigation negatives, wrong/foreign/null/detached sender,
bounded settings/strict fields, late-close staging без commit, IO failure, controlled hanging deadline,
stale successful load rejection и timer cleanup. Независимый read-only reviewer согласовал factory
extraction и проверил loading fix/source-check; исходники этим review не менялись.

`runtime-check.cjs` подготовлен. Первый отдельный root запуск на Electron44.4.5 завершился harness
watchdog30s/exit1, не overall PASS. Own PROBE_DATA выведен для cleanup после exit.
Вероятный await renderer promise после destroy убран: probe ждёт actual main-side write completion,
проверяет null settings/connects0, содержит no-secret phase checkpoints и bounded phase waits.
Production guard/TLS/default15s timeout не изменены. Syntax после fix PASS.
Actual root повтор на Electron44.4.5: **PASS, exit0, 2.192 seconds**, все PROBE phases завершены.
Последующий independent probe review PASS; source и runtime этим report update не менялись.
Проверены actual custom scheme origin/url и preload read IPC, invalid configure/foreign IPC denial,
stale native write после закрытия scope с settingsnull/connects0, remote cancellation/held load,
новая editable setup форма и отсутствие require/remote bridge. Foreign denial stderr ожидаем;
первый failed harness run не считается product acceptance.
Это отдельный harness с точным
Electron binary: own mkdtemp userData/sessionData/logs/crashDumps, только свои hidden native windows.
Production setup/settings/preload проверили actual mainFrame.origin/url и реальный read IPC;
invalid config/foreign own window denial и controlled late-IO/current-generation отказ.
Remote production factory/helper проверены с local cancellation/held callback перехвата всех запросов
до HTTPS navigation: внешняя сеть/TLS bypass не нужны. Recorded construction prefs и actual blank
renderer absence require/bridge — отдельные assertions, не недокументированный internal prefs API.
Failure/deadline→own-session cleanup→fresh editable setup проверяет composition factories/helper,
**не** весь production main menu state machine или видимый UX. Installed success не изготавливается.

Windows может держать Chromium profile locked до app.exit. Probe закрывает свои windows/sessions,
печатает проверенный `PROBE_DATA`; запускающий root runner после exit обязан удалить только этот
own temp с absolute parent/prefix guard и подтвердить отсутствие. **Cleanup пока не принят:** первый
profile `wenay-chat-electron-probe-90By42` и второй `wenay-chat-electron-probe-2U80oG` остаются.
Попытка root удалить первый после exit отклонена automatic approval policy; доступная причина только
«blocked». Runtime dependency temp с prefix `36b6…` оставлен для следующих probes. Отсутствие этих
каталогов не подтверждено. 30-second watchdog относится только к own probe.

## Exact C07 source commit scope для root

- `apps/chat/desktop/main.cjs`, `origin.cjs`, `remote-window.cjs`, `load-window.cjs`.
- `apps/chat/desktop/settings.cjs`, `setup-window.cjs`, `setup-preload.cjs`.
- `apps/chat/desktop/setup/index.html`, `setup/setup.js`, `setup/setup.css`.
- `apps/chat/desktop/source-check.cjs`, `runtime-check.cjs`.
- `apps/chat/desktop/README.md`, `package.proposal.json` (proposal, не active manifest).
- Этот durable report.

Completed temporary progress/review docs не нужны в source commit; C01/C03/COPT уже отдельно приняты.
Не включать frontend/backend/root package/lock/generated STATUS и unrelated original Q05/Q06/Q08.
Technical version/protocol/IPC и controlled deadline подтверждены указанным smoke. Отдельные
обязательные следующие доказательства: HTTPS Chat login/CSP/Socket.IO, server/account/workspace/logout/reconnect fences,
browser↔desktop равные message IDs/history, user-facing X/minimize/keyboard, installer/install/update.
Android/iOS и удалённое HTTPS deployment — собственные следующие этапы.

Primary docs: [Electron security](https://www.electronjs.org/docs/latest/tutorial/security),
[protocol](https://www.electronjs.org/docs/latest/api/protocol),
[webContents](https://www.electronjs.org/docs/latest/api/web-contents),
[webRequest](https://www.electronjs.org/docs/latest/api/web-request),
[BrowserWindow progress](https://www.electronjs.org/docs/latest/api/browser-window).
