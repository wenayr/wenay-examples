# Chat desktop skeleton

Это source skeleton Windows shell, не установленный и не принятый desktop клиент.
Он открывает существующий plain Chat web UI с явно настроенного HTTPS origin.
Текущие common2/react2 client, login, resource lifecycle, reconnect, receipts и общая backend история остаются в web UI.
Main process не читает токены, не вызывает RPC и не содержит собственного транспорта, backend или локального journal.

Первый запуск открывает локальную форму «Подключиться к Chat». Введите HTTPS адрес, выданный администратором,
и явно нажмите «Подключиться», например формат `https://chat.example.test` (это не работающий endpoint).
CLI/env не требуются; `CHAT_DESKTOP_ORIGIN` больше не используется. Main сохраняет только `{version:1, origin}`
в собственном `userData/chat-settings/endpoint.json`; следующий запуск открывает сохранённый сервер автоматически.
Повреждённая/слишком большая/невалидная настройка возвращает форму. Ошибка HTTPS/сети возвращает редактируемую
форму с сохранённым адресом; certificate validation не отключается. IO error не считается успешным подключением.
Подключение сразу показывает окно с заголовком «Подключаемся к …» и indeterminate taskbar progress;
до ответа сервера область страницы может быть пустой. Ожидание loadURL ограничено 15 секундами,
после timeout загрузка останавливается, remote session очищается и открывается редактируемая форма с ошибкой.
Видимый loading и deadline ещё требуют настоящей Electron runtime проверки.
Нужен canonical origin без завершающего slash, credentials, path, query, fragment, wildcard или запятой.
Путь frontend и backend совпадает с существующим root-hosted Chat: относительные `/api/client` и `/api/chat/login`
и `location.origin` не меняются. Обычный HTTP localhost в этом skeleton не разрешён; TLS validation не отключается.
Endpoint должен обслуживать свежий Chat UI и проксировать native Socket.IO resource/service connections по HTTPS/WSS.

`package.proposal.json` — отдельное предложение будущего desktop package, а не активный manifest.
Electron не установлен, lock не создан; основной Chat package/lock не изменены.
На дату 2026-09-26 официальный stable список содержит Electron **44.4.5**, поэтому предложена точная версия.
[Electron releases](https://releases.electronjs.org/release?channel=stable).
Следующий разрешённый этап: повторно проверить stable/security releases, превратить proposal в отдельный package.json,
создать его lock обычной npm установкой, затем запускать через `npm start` в desktop каталоге.
Не использовать floating `latest`, `npx` download или обход TLS ради быстрого smoke test.

Окно включает sandbox/contextIsolation, явно выключает Node integration, webview и devTools;
Remote UI не имеет preload/IPC bridge. Отдельное локальное setup окно имеет только read/configureOrigin bridge,
scoped webContents IPC проверяет identity/mainFrame/exact URL/origin/generation. `null` origin отвергается.
Custom secure standard protocol отдаёт только три packaged assets по точным URL и GET, с deny-by-default CSP.
Фактический serialized origin этого protocol ещё требует Electron runtime proof; guard не ослабляется ради запуска.
Междоменная navigation/redirect, новые окна, downloads и platform permissions блокируются.
Существующая CSP сервера сохраняется; desktop добавляет политику self scripts, same-origin HTTPS/WSS,
без eval/inline scripts, frames и object content. Inline styles допускаются для React DOM.
Применимость этой CSP к production Chat bundle ещё требует runtime smoke test.
[Electron security](https://www.electronjs.org/docs/latest/tutorial/security),
[navigation APIs](https://www.electronjs.org/docs/latest/api/web-contents).

Session partition без `persist:` живёт в памяти. «Сервер → Сменить сервер / выйти» уничтожает remote renderer,
закрывает его connections, очищает storage/cache и открывает форму. Любое новое подключение получает уникальную
partition и требует login, даже на прежнем сервере. Пароли/tokens/history/drafts между серверами не переносятся.
При ошибке очистки приложение завершает работу вместо переиспользования старой session.
Это локальный выход: глобальный отзыв backend token не обещается. Token/sessionStorage управляет только существующий web client;
shell не добавляет persistent login или secure-store adapter. Перезапуск приложения требует нового login.
Кнопка reload оставляет управление session тому же клиенту. Initial launch требует сети: offline packaged assets
не входят в этот минимальный этап. Backend history сохраняется сервером и снова видна после login.
[Electron session](https://www.electronjs.org/docs/latest/api/session).

Нужная Windows приёмка следующего этапа:

1. Installed Electron dependency из точного manifest/lock; launch против контролируемого HTTPS backend,
   current plain Chat login и service/resource ready, TLS error не обходится.
2. Проверить CSP/Socket.IO, send/reply/native receipt retry, reconnect после offline и logout/account/workspace switch.
   Старый callback не должен возвращать данные/токены новой session.
3. Browser и desktop одного account/workspace видят одинаковые message IDs/history; desktop restart/login показывает её снова.
4. Проверить blocked cross-origin redirect/window/file download и отсутствие Node/preload/IPC в remote renderer;
   setup protocol origin/CSP/IPC negatives, settings restart, late-close configure, server switch и new login.
5. Выбрать installer tool/signing/update contract отдельно, собрать и установить artifact вне repository/dev server.
   Зафиксировать version/hash/install/update method. `electron .` — dev launch, не installed acceptance.

Installer, автообновление, persistent login, push, files и microphone здесь не реализованы.
Закрытие последнего окна завершает приложение; minimize остаётся в taskbar, Tray/background режим не добавлены.
Node syntax checks и `node source-check.cjs` проверяют только source/чистые guards/временные настройки, не GUI.
`runtime-check.cjs` — отдельный opt-in technical probe для exact installed Electron binary, пока не выполнялся.
Он открывает только собственные скрытые окна и перехватывает внешний трафик; проверка actual origin/IPC
не заменяет installed acceptance. После exit runner удаляет выведенный checked own PROBE_DATA directory:
Windows Chromium profile может оставаться locked до завершения процесса.
Сам source skeleton не доказывает Windows runtime/installed acceptance; Android/iOS остаются в C07 matrix.
