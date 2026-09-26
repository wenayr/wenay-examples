# Непрерывное развитие Q12

26 сентября 2026. После принятой графической ветки G01–G04 работа продолжается
в `codex/unified-chat`; исходная ветка с улучшениями Q01–Q07 сохранена отдельно.

| Этап | Состояние | Проверка и следующее действие |
| --- | --- | --- |
| C01 | Локальная приёмка | Targeted/runtime/browser PASS, исправлен UI gate собственного resource. Общий 39-step gate с hosting skip; перед main нужен полный gate |
| C02 | Ожидает | Semantic streaming и библиотечные repro, прежние AI обходы этого этапа не принимают |
| C03 | После C01 | Переключение identity/workspace, очистка старых ресурсов и серверное разделение данных |

Связи и критерии — [план](../../AI-CHAT-PRODUCT-PLAN.md),
принятая граница — [отчёт C01](../../changes/chat-c01-20260926.md),
следующая граница C03 — в [плане Q12](../../AI-CHAT-PRODUCT-PLAN.md).

Перед main требуется check:all на итоговом коде. Платные providers, установленный
desktop/mobile, remote operations и реальное размещение ещё не приняты.

Ownership review PASS: native consumer→RPC resource, generation/late guard; второго replay нет.
Runtime regression покрывает исправленную concurrent payload/capacity гонку. Два conversation
public repro подтверждают ограничения 3.1.1 и остаются отдельным release gate.
Browser fixture штатно остановлен (exit 0), собственный каталог удалён, оба порта освобождены;
viewport overrides сброшены. Старые rejected-cleanup каталоги не тронуты.

Повтор browser restart выявил и исправил UI dependency на health ленивого service transport.
После исправления те же вкладки восстановили историю/черновик и отправили сообщение
другому клиенту без reload/login; неправильный пароль → русский отказ → вход Бобом PASS.
Typecheck/build после изменения PASS. Общий gate: 39 шагов, 37 PASS, hosting skipped
из-за недоступного daemon, Catalog build нет. DOCUMENT_PYTHON задан явно, повтор Documents
test PASS без внутреннего Python skip. Docker Desktop штатно запущен, daemon не восстановился;
вопрос о тексте ошибки задан, независимая работа продолжается.
Новый network fixture прерван очередным пользовательским turn: port 62294 свободен,
его каталог wenay-browser-network-UoLnqT остался. Закрытый exec session не опрашивать.

C01 сохранён f083593. C03 targeted typecheck/test/build 3/3 PASS, browser account/workspace/revoke/regrant и Chrome 360x500 PASS. Исправлен native view envelope и прокрутка формы; durable report doc/changes/chat-c03-20260926.md. После очередного пользовательского turn browser fixture exec прерван: port 58531 свободен, каталог wenay-browser-pGTU3t остался; штатный stop не подтверждён. C03 repository gate выполняется; Q05 feasibility и C-OPT-CHAT следующие.
