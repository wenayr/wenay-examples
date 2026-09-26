# C07-F-MATRIX: установленный Chat на desktop и mobile

Дата: 2026-09-26. Статус: source feasibility, не приёмка платформ.
Прочитаны установленные опубликованные пакеты `wenay-common2 3.1.1`, `wenay-react2 5.0.0`, `socket.io-client 4.8.3`.
Пакеты, SDK и framework не устанавливались; сборки, эмуляторы, устройства и installer не запускались.
Текущий C03 Chat изучен в checkout `work-calendar`, где принят commit `e97161a`; в ORIGINAL приложения не изменялись.

## Практический первый путь

Для ближайшего прототипа предлагается сохранять React DOM frontend: Electron для Windows и Capacitor для Android,
затем тот же Capacitor для iOS после доступа к Mac. Это инженерная рекомендация по объёму адаптации текущего кода,
а не уже выбранный или проверенный framework. Два shell требуют двух packaging pipelines, но сохраняют один UI и один backend.
Electron работает с web frontend в renderer; Capacitor специально предназначен для web apps на Android/iOS.
[Electron security](https://www.electronjs.org/docs/latest/tutorial/security), [Capacitor overview](https://capacitorjs.com/docs).

Tauri 2 — разумная альтернатива единого shell для Windows/Android/iOS, если приемлемы Rust и дополнительные toolchains.
На Windows нужны MSVC Build Tools и WebView2; Android добавляет JDK/SDK/NDK и Rust targets; локальный iOS требует macOS/Xcode.
Выбор следует подтвердить маленьким packaged prototype с реальным Socket.IO, а не размером пустого shell.
[Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).

React Native имеет смысл при требовании именно native UI. Для существующего DOM Chat это отдельный renderer,
а не замена упаковщика. Публичный `wenay-react2/native` не содержит нужных chat lifecycle hooks.
Предпочтения пользователя о native UI, notification, tray и store distribution можно уточнить перед implementation;
их отсутствие не мешает этому аудиту.

## Матрица кандидатов и приёмки

| Candidate / target | Runtime и reuse | Конкретный gap | Installed acceptance |
| --- | --- | --- | --- |
| Текущий web | Browser, React DOM, common2 service/conversation, react2 hooks | Remote HTTPS endpoint, доступный вне localhost; browser acceptance не доказывает installed клиент | Контрольная web сессия общей истории рядом с installed клиентами |
| Electron / Windows | Chromium renderer; существующие JSX/CSS и публичные library imports | Main/preload, endpoint/token port, installer, CSP, narrow bridge, lifecycle при закрытии окна | Установить artifact вне dev server; login/send/restart/update; история совпадает с web/Android |
| Capacitor / Android | Android WebView; существующие JSX/CSS и public client | SDK, app lifecycle/keyboard/back, endpoint/CORS, secure token port, packaging/signing | Установить APK на устройство; foreground reconnect и process restart; не требуется Metro/Vite dev server |
| Capacitor / iOS | WKWebView, тот же web UI/client | Mac/Xcode/signing/provisioning и проверка WKWebView/network/keyboard | Установленная signed app; те же cross-client сценарии; до Mac gate UNACCEPTED |
| Tauri 2 / Windows | WebView2, web UI/client | Rust/MSVC, capability/CSP, token port, installer и отдельный WebView2 regression | Установленный Windows artifact + remote endpoint и общая история |
| Tauri 2 / Android/iOS | Platform WebView, web UI/client | Android NDK/Rust targets; iOS Mac/Xcode; мобильные плагины/lifecycle | Установленная app на каждой платформе; desktop build не считается mobile PASS |
| React Native / Android/iOS | Hermes/native components; reuse backend contract и common2 client кандидат | Metro public-export proof, React peer compatibility, native hooks export при необходимости; новый UI/storage | Release app вне Expo Go/Metro; handshake/resource/replay proof, затем полная пользовательская приёмка |

Матрица не утверждает, что какой-либо installed target уже реализован. PWA/browser tab и Expo Go preview
не заменяют проверку собственного установленного artifact. Android — первый mobile target разработки на Windows;
локальная iOS сборка/приёмка требует Mac и соответствующих инструментов.
[Capacitor environment](https://capacitorjs.com/docs/getting-started/environment-setup),
[React Native environment](https://reactnative.dev/docs/set-up-your-environment).

## Что реально дают установленные библиотеки

Проверяемые источники: `apps/documents/node_modules/wenay-common2/package.json`,
`lib/service/client.js`, `lib/service/resource-client.js`, `lib/Common/rcp/rpc-client.js`,
`apps/documents/node_modules/wenay-react2/package.json`, `lib/react/index.js`, `lib/native/index.js` и соответствующие `.d.ts`.
Это аудит опубликованных exports; внутренние файлы прочитаны для зависимости, импортировать их из app запрещено.

- common2 имеет публичные `service/client`, `conversation`, `observe`, `replay`, `listen`, `resource`, `ai` и `artifact`.
  Публичного `native`/`react-native` entrypoint нет. Package CommonJS; не следует импортировать общий server/root barrel в mobile.
  `engines.node >=20` сам по себе не означает необходимость Node в клиенте.
- `createServiceClient` использует `socket.io-client`, websocket transport, `forceNew`, Observe/store/replay и RPC lifecycle.
  Service views/commands и resource transport имеют отдельные sockets; доступность resource определяется его собственным status.
  `resource-client` использует `AbortController`. Прямого DOM/sessionStorage в этих двух entry implementations нет.
  Socket.IO документирует React Native usage, однако это не доказательство всей transitive цепочки common2 в Metro.
  [Socket.IO React Native](https://socket.io/how-to/use-with-react-native).
- RPC использует Map/Set/Promise/timers и optional `globalThis.WeakRef`/`FinalizationRegistry`;
  при отсутствии последних есть fallback. Полный transitive graph и runtime globals должны проверяться в выбранном bundler/runtime.
  Наличие CommonJS + websocket не является ни blocker, ни автоматическим PASS для Hermes.
- react2 `./react` публично экспортирует `useOwnedClient`, `useAsyncAction`, `useServiceCommands`, `useClientStore`,
  `useAiRunClient`, Observe/replay hooks. Реализации service/workflow hooks используют React и store;
  прямых DOM references в них не обнаружено. Но barrel также экспортирует keyboard/drag/resize и browser persistence.
  `useKeyboard` работает с DOM `KeyboardEvent`, resize — с `ResizeObserver`, browser cache — с `localStorage`.
  Некоторые globals guarded; это не доказывает native безопасность всей загрузки public barrel.
- react2 `./native` экспортирует только `columnState` и `columnDots`: renderer-neutral controllers для async storage
  и координатных gestures. Это headless primitives для колонок, а не готовая RN таблица или Chat UI.
  Публичного native экспорта chat hooks в 5.0.0 нет. `./core` не подменяет React ownership hooks.
- react2 ESM, React peer `^19.2.0`, optional react-dom; зависимости включают `react-rnd` и `re-resizable`.
  Optional react-dom не даёт гарантию Metro compatibility. React version выбранного RN release надо сопоставить с peer,
  не применять `--force` для сокрытия конфликта. Проверяются exact versions и lock нового shell, текущие locks не меняются.

Для RN первый шаг — минимальный public-import bundle: common2 `service/client` + `conversation` и react2 `react`
с требуемыми hooks. Затем runtime connection, open/close resource, store update, native receipt retry.
Если public barrel не проходит, оформить воспроизводимый library issue и дождаться опубликованного narrow/native export.
Не копировать private hooks в Chat и не делать собственные replay/transport/receipt.
React Native предоставляет Fetch и WebSocket, но DOM JSX и browser storage надо адаптировать отдельно.
[React Native networking](https://reactnative.dev/docs/network).

## Минимальная граница frontend и shell

Текущий `apps/chat/frontend/main.tsx` использует `react-dom/client`, `document`, `location.origin`, relative fetch,
`sessionStorage`, `FormData`, `crypto.randomUUID`, textarea/IME и DOM focus/scroll.
WebView reuse сохраняет этот renderer; RN требует native components для этих операций.

Нужен маленький platform port: backend endpoint, token read/write/remove и lifecycle events.
Существующий login/service definition/command/resource протокол остаётся тем же. Сначала read-only описание port,
затем один shell без собственного transport и без локального backend writer.

1. Backend URL явно задан HTTPS origin. `location.origin` локального bundle не является адресом backend;
   login и `/api/client` также должны использовать выбранный endpoint. Android device `localhost` означает само устройство.
   Для dev emulator есть отдельные адреса; release не отключает TLS validation и cleartext policy.
   [Socket.IO connection URLs](https://socket.io/how-to/use-with-react-native).
2. Exact origin policy проверяется для выбранного shell. WebView локальный origin отличается от public server origin;
   нельзя решать это `CORS=*` или привилегированным HTTP bridge с произвольным URL. Configured backend origin и client origin
   — разные величины. Hosting Q11 publicOrigin сам по себе не завершает этот protocol/design gate.
3. Token scoped по backend/account, async storage guarded текущей session epoch. Logout/switch сначала закрывает consumer,
   затем resource/session и очищает token/UI; старый login/renew callback не пишет token новой сессии.
   Electron secure storage живёт в main process за узким preload API; Windows safeStorage использует DPAPI,
   который не защищает от другого процесса того же пользователя.
   [Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage).
4. Для mobile не считать Preferences защищённым secret vault: его документированный purpose — key/value persistence.
   Предпочтение workspace/endpoint допускает Preferences; долгоживущий token требует выбранного и проверенного native
   secure-store adapter либо отсутствия persistent login до его появления.
   [Capacitor Preferences](https://capacitorjs.com/docs/apis/preferences).
5. Renderer не получает Node integration или произвольные filesystem/shell/IPC capabilities.
   Локальные assets, context isolation, narrow bridge, CSP и ограничения navigation/external links проверяются отдельно.
   [Electron security](https://www.electronjs.org/docs/latest/tutorial/security).
6. Suspend/foreground/disconnect используют library lifecycle/reconnect. Фоновый постоянно живой socket на mobile
   не обещается. Push notifications/background delivery — отдельный этап, не часть этого минимального installed Chat.

## Общая история и обязательные проверки C07

Все клиенты одного account/workspace подключаются к одному deployed backend и journal; локальная установка не создаёт
свою копию сервера. Library service/resource/conversation ownership и replay остаются общими.
Клиентская draft persistence при необходимости отдельно scoped; она не становится источником conversation history.

Последовательные этапы реализации:

1. Зафиксировать framework exact versions, export/React compatibility и endpoint/token port. Небольшой bundler probe
   на публичных imports; при RN — также Hermes runtime probe. Проход этого шага не принимается как installed app.
2. Windows install artifact: запуск без repository/Vite, доступный remote HTTPS backend, login, resource ready,
   message/send/receipt, закрытие/reopen, update с сохранением endpoint и допустимой session policy.
3. Android SDK/device gate: подготовить environment отдельно; собрать и установить artifact, проверить soft keyboard,
   IME/draft, back, маленький экран, Wi-Fi disconnect/reconnect, background/foreground и process kill/reopen.
4. Одна conversation: web отправляет A, Windows видит A и отправляет B, Android видит A/B и отправляет C;
   после reconnect/restart все видят A/B/C с теми же message IDs без дублей. Повтор frozen requestId не создаёт новую запись.
5. Alice/Bob: revoke выбранного workspace, запрет чтения/команды и отсутствующий fallback в private space;
   смена account очищает history/draft/pending; поздний callback старой session не меняет новую.
   Эти проверки выполняются и в installed clients, а не только в backend test.
6. iOS Mac gate: tools/signing/device или simulator release artifact, затем те же проверки и WKWebView lifecycle.
   Mac/signing/device отсутствуют в этом аудите; iOS оставляется UNACCEPTED до реального evidence.

Evidence содержит platform/runtime/version, artifact hash и install/update method, backend origin/build,
проверенные scenarios и ограничения. Typecheck, responsive screenshot или headless protocol test не доказывают installer,
native keyboard, TLS доступ с устройства, общую историю нескольких платформ или foreground reconnect.
Framework docs определяют feasibility; выбор, сборка и device acceptance остаются следующей работой C07.
