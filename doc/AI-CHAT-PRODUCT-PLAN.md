# Q12: синхронный чат и специализированные сервисы

26 сентября 2026. Поручение пользователя: приложение с привычным чат-интерфейсом,
синхронной историей в web, desktop и установленном mobile-приложении, переключением
аккаунтов, обычным чатом и работой удалённого агента. Специализированные сервисы:
дизайн, сайты и размещение, видео, создание приложений. Основа — публичные
wenay-common2 и wenay-react2, а не новая транспортная инфраструктура.

Это план нового продукта Q12 из [стратегии](STRATEGY-2026-09.md), не отчёт о готовом приложении.
C01 локально принят в managed checkout `codex/unified-chat`, сохранён `f083593`:
targeted typecheck/test/build, real RPC, reconnect и desktop/narrow-width browser прошли.
Итог: 37 PASS / 39 шагов, hosting SKIP, Catalog build отсутствует по контракту;
это не полный общий gate перед main. C03 runtime runner 3/3 PASS, browser выполняется,
этап ещё не принят. C02/C04–C08 ожидают. Готовность существующего
примера подтверждает его собственный сценарий, а не весь новый продукт.

## Пользовательский результат

Пользователь выбирает аккаунт и рабочее пространство, открывает разговор, отправляет
сообщение и видит ту же историю на другом клиенте. Ответ может быть обычным сообщением,
потоком ИИ или результатом явно выбранного сервиса. Интерфейс показывает отправку,
выполнение, запрос подтверждения, отмену, восстановление соединения и конечный результат.
Перезагрузка и повтор после потерянного ответа не создают второе сообщение или задание.

Обычный чат не требует удалённого агента. Для удалённого режима пользователь отдельно
выбирает проект и агента, выдаёт ограниченное разрешение, видит операции и может отменить
задание или отозвать доступ. Сервер проверяет это разрешение при каждой операции и выдаче
результата. Выбор режима в интерфейсе сам по себе прав не даёт.

У каждого сервиса есть понятный вход, ход работы, артефакт и дальнейшее действие.
Сайт сначала создаётся и просматривается, затем размещается с явным разрешением.
Видео возвращает проверяемый медиафайл; создание приложения — исходники и воспроизводимую
сборку. Удалённая работа и публикация должны давать реальные результаты.

## Уже доступное основание

Инвентаризация относится к установленным точным common2 3.1.1 / react2 5.0.0.
Перед реализацией сверить экспорт и контракт в опубликованном пакете и существующем примере.

| Граница | Публичный механизм / существующий пример | Что ещё нужно доказать в Q12 |
| --- | --- | --- |
| Разговор | common2 `createConversationHost` / `createConversationClient`: каналы, сообщения, факты, requestId/receipts, persistence, state/events/replay | Два клиента, восстановление истории и идемпотентный повтор собственного продукта |
| AI-задание | common2 `createAiRunHost` / `createAiRunClient`: text.delta, tool, cancel, approval/input, checkpoint/recovery | Полный semantic stream, teardown/revoke/reconnect; наличие API не означает принятую безопасность |
| Сессия и доступ | Публичный service host/client, auth/permissions, resources/views | Разделение аккаунтов/workspace и немедленная очистка старого контекста |
| React web | `/react`: `useOwnedClient`, `useAiRunClient`, `useClientStore`, библиотечные action hooks | Работа и освобождение ресурсов нового интерфейса |
| Чат органайзера | [chat-resource](../apps/pizzeria/organizer/chat-resource.ts), [journal](../apps/pizzeria/organizer/chat-journal.ts), [assistant](../apps/pizzeria/organizer/assistant-resource.ts): metadata/members/blob ACL | Выделить необходимую композицию, не копировать предметные правила доски |
| Поиск Support | Q04: hash-only scoped tenant keys, productKeys/productSearch, owner UI реализованы | Принять актуальные runtime/browser проверки; подключить реального читателя C04 |
| Документы | Jobs, файлы, cancel и поздний результат существующего Documents | Ограниченный машинный API Q05 и новый пользовательский сценарий C05 |
| Размещение | Hosting deploy/update/rollback | Настоящий live gate Q03 до заявления принятого размещения C08 |
| Mobile | `/native` react2 содержит headless `columnState` / `columnDots` | Это не готовые React Native UI/hooks; выбранный клиент и установленное приложение требуют отдельного доказательства |

Нет оснований заявлять, что `/react` DOM-hooks автоматически работают в native mobile.
Адаптивный web полезен в C01, но не выполняет требование установленного mobile-приложения.

## Границы композиции

Для каждой реальной границы — одна фабрика с замыканием и явными deps; фасады
`control`, `resource`, `view`, `events`, `health` оформляются по аудитории.
Ресурс создаётся раньше его потребителя. Общие helper выделяются при доказанном повторении.

- Сессия определяет серверную идентичность и текущий workspace; conversation зависит от этой границы.
- Conversation хранит разговоры и факты через библиотечные persistence/replay/receipts.
- Run выполняет ИИ или тестового провайдера, связывает результат с разговором и сохраняет checkpoint.
- Service adapter переводит типизированный запрос в Support/Documents/Hosting/video runner.
- Remote agent resource держит разрешение, lease, проект и жизненный цикл исполнения.
- Platform client показывает те же серверные данные; локальный кэш не становится вторым писателем.

API-secret модели и машинные ключи внешних сервисов остаются на сервере.
Browser/mobile не получают master secret. Доступ к разговору, blob, заданию и артефакту
проверяется текущей серверной identity/workspace/capability, также после IO.
Не вводить новый replay, reconnect, transport или параллельную типизацию.

## Открытое ограничение streaming

[Реестр обходов](library-tasks/WORKAROUNDS.md) сохраняет AI-POLICY-INVALIDATION и
AI-RESOURCE-LIFECYCLE на common2 3.1.1. State-only зеркало с onError помогает очистить
состояние, но не подписывается на semantic delta/tool events и не принимает C02 streaming.

Для C02 сначала сохранить минимальные repro нового сценария: смена policy при открытом
fragment, revoke во время delta/tool, close до позднего результата, reconnect после отмены.
Нужно действительное исправление публичного API в опубликованной версии, затем точное npm
обновление, повтор repro и исходного сценария. Если механизм остаётся недостаточным,
оформить библиотечную задачу с expected/actual/teardown/критерием; не подменять npm локальным кодом.
Пока это не принято, C01 может работать с plain chat и тестовым исполнителем без обещания
безопасного полноценного ИИ-потока. Платный provider не нужен для проверки основы.

## Этапы и зависимости

ID C01–C08 устойчивы: отчёт, журнал, задача и коммит ссылаются на тот же ID.
«Проверено» означает выполненные проверки текущего кода; «принято» — все критерии данной границы.
Пропуск среды фиксируется как skipped. C01 f083593 локально принят с явно указанными
hosting skips; C03 runtime PASS не закрывает browser. Остальные C-этапы не объявлены выполненными.

| ID | Предшественники | Результат | Приёмка и доказательства |
| --- | --- | --- | --- |
| C01 | Точная опубликованная пара библиотек | Plain web chat, адаптивный экран, тестовый provider, каналы/история | Два самостоятельных клиента; отправка/receipt/потерянный ответ; restart persistence, replay без дублей; мобильная ширина и клавиатура |
| C02 | C01; опубликованное исправление AI/repro | Semantic AI stream, cancel, tool/approval/input и durable run | Delta/tool в двух клиентах, отмена и teardown, policy/revoke, reconnect, поздний callback, restart checkpoint; реальные результаты repro на новой версии |
| C03 | C01 | Переключение аккаунта/workspace, ресурсное владение | A → B → logout; чужая история/blob/result закрыты сервером; старый stream/late callback не попадает в новый экран; revoked capability прекращает доступ |
| C04 | C03, принятый Q04 | Поиск опубликованных знаний Support | Реальный scoped машинный потребитель; tenant/scopes/expiry/revoke и открытый ресурс/IO; результат не содержит приватных заметок |
| C05 | C03, принятый Q05 | Document upload/start/status/result | Реальный job и файл, отмена/повтор/restart; чужой tenant и review/admin запрещены; UI показывает конечный исход |
| C06 | C03; C02 для AI-управляемого агента | Настоящий remote agent backend | Explicit project/agent grant, lease, разрешённые paths и типизированные операции; checks/cancel/revoke после IO; результат и receipts после рестарта |
| C07 | C01, C03; C02/C06 для соответствующих режимов | Desktop и installable mobile clients на общем backend | Отдельный feasibility gate платформ, затем установленный клиент на реальном устройстве; web ↔ desktop ↔ mobile история/receipt/cancel/logout; suspend/reconnect/обновление |
| C08 | C03; C02 для AI-генерации; Q03 для размещения | Сервисы дизайна/сайтов/приложений/видео | Артефакт → просмотр → явное разрешение → реальное размещение или video runner; typed job/status/cancel/retry; проверка конкретного выходного файла/сборки/адреса |

C03 можно делать после C01, пока библиотечное исправление C02 ожидается.
Q04/Q05 нужны только соответствующим адаптерам C04/C05. Q03 нужен размещению C08,
а не plain chat. Q06 необходим до платного реального usage: quota/receipt/uncertain/dedup
должны работать с настоящими потребителями. Fake MVP и бесплатные сценарии C01 он не блокирует.
Q07–Q10 и вся очередь старых приложений не являются скрытыми предусловиями Q12.

C06 — новый backend агентного исполнения, а не переименование screenshare.
Screenshare может быть вспомогательной поверхностью, но не доказывает разрешённые операции
над проектом, typed paths, lease или атомарность результата. Общая conversation/run инфраструктура
переиспользуется; предметные операции агента требуют собственной границы и серверного контроля.

C07 делится на C07-F (feasibility), C07-D (desktop), C07-M (installed mobile) и C07-X
(cross-client приёмка). Framework пока не выбран: сначала подтвердить совместимость public
client/runtime, lifecycle, пакетирование, хранение сессии и реальные устройства минимальным прототипом.
Web shortcut/PWA и native package имеют разные ограничения; только фактическая установка
целевого клиента и сценарий на устройстве позволяют закрыть требование пользователя.

C08 делится на C08-DESIGN, C08-SITE, C08-APP, C08-VIDEO; у каждого отдельный артефакт и отчёт.
Video runner отсутствует как принятый механизм нового продукта: нужен настоящий исполнитель,
контракт, файл и приёмка. Fixture, заглушка или текст «видео готово» этого этапа не закрывают.

### Исполняемые суффиксные срезы

- C05-CANCEL-FILE: four-method Q05 не обещает cancel/downloadable artifact.
  До chat consumer согласовать scoped capability/метод отмены и результат-файл,
  не выдавая human processor/raw AI fragment. Attachment→job→usable file принимает
  MIME/size/revision/current ACL, cancel/revoke/expiry during IO/late provider,
  native retry/restart без второй работы. Request close прекращает его IO;
  accepted durable job живёт до terminal по отдельному cancel contract.
- C06-P — plain deterministic typed read/edit/run; C06-A — AI после C02.
  C06-P-TYPED принимает реальные file/exit/output и bounded project/agent/account/workspace
  grant с operations/roots/expiry/edit revision. Negative paths: foreign scope,
  read-only edit/run, traversal/symlink escape, stale revision/lease/attempt,
  revoke/expiry в IO/process, closed resource/late output/lost response/restart.
  Local fixture не заменяет агент на отдельной машине.
- C07-F-MATRIX фиксирует target desktop OS/architecture + mobile OS/device,
  published imports, secure session и prototype build→install→launch→update→uninstall.
  C07-D/M доказательства привязаны к installed package version/backend/device:
  desktop X/tray/quit/relaunch без orphan processes; mobile keyboard/background/
  suspend/network switch/files/denied permission/logout. Build без install не PASS.
- C07-X-MATRIX: web + установленный desktop + установленный mobile одного journal;
  post каждого приходит двум другим один раз; workspace независимы;
  lost response/reconnect/restart сохраняют retry payload/requestId;
  A→B/logout/revoke очищают history/draft/pending/result. Plain matrix не ждёт C02/C06;
  AI/remote повторяется после соответствующих gates. LAN и production HTTPS разделены.
- Q11-P принимает prepared host HTTPS/update/rollback; Q11-B отдельно принимает
  preflight и идемпотентный bootstrap поддерживаемого clean Linux host без повреждения
  чужих services/volumes, с unsupported/occupied-port/install-error outcomes.
  C08-SITE использует тот же accepted deploy; external environment отсутствие — skipped.

Полезность старых примеров дополнена Q08-PIZZERIA/SUPPORT/DOCUMENTS/METERING
human journeys в [исполняемом плане](EXECUTION-PLAN-20260926.md): machine/backup/diff
не заменяют пользовательскую приёмку. Эти Q08 не скрытые предусловия ordinary chat.

## Checkpoints упрощения

После принятого поведения/UX этапа провести небольшой аудит, сохранить смысл и повторить
затронутые проверки. Отсутствие безопасного упрощения — допустимый зафиксированный результат.

| ID | После | Что проверить |
| --- | --- | --- |
| C-OPT-CHAT | C01 и C03 | Лишнее состояние экрана/подписки, явные session/conversation фасады; повтор receipts, account switch и два клиента |
| C-OPT-RUN | C02 | Удалить только исправленные библиотечные обходы, сохранить stream/cancel/checkpoint и policy/revoke приёмку |
| C-OPT-SERVICES | Два настоящих адаптера C04/C05/C08 | Выделить минимальную повторяемую оркестрацию, сохранить предметные ACL, typed inputs и jobs |
| C-OPT-PLATFORMS | C07-X | Проверить общие модели/клиент и реальные lifecycle-различия; не унифицировать платформы ценой скрытого утекания ресурсов |

Каждый этап сохраняет описание реализации, точные package/lock, команды и исходы проверок,
ручные сценарии, ограничения среды и следующую зависимую задачу. Общий check:all проводится
на итоговом коде перед main; старый PASS после смысловой правки не переносится.
Правила работы и коммитов — [CODE-RULES](CODE-RULES.md).

## Ближайшее действие

C01 f083593 и C03 e97161a локально приняты; C03 runtime 3/3, repository и browser PASS.
Далее C-OPT-CHAT и Q05 public processing feasibility. Hosting SKIP остаётся ограничением gate main.
Подробная общая очередь — [план всех поручений](EXECUTION-PLAN-20260926.md).
Дизайн Q05 уточняет [native recovery/receipts/lifecycle](changes/documents-q05-design-20260926.md);
он не является реализацией или PASS. Repro C02 остаются открытыми;
выбор desktop/mobile framework и платных провайдеров не опережает соответствующие gates.
