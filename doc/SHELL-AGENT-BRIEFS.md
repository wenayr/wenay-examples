# Постановки исполнителям wenay-shell

Версия 1.0, 27 сентября 2026. Запускать только после сохранения и проверки
[детального плана](SHELL-EXECUTION-PLAN.md) и [контрактов](SHELL-CONTRACTS.md).

## Общая инструкция для каждого запуска

Модель: **GPT-6 Sol**, reasoning **high** для первой волны.
Родитель: root. Подагенты этой волны собственных подагентов не создают.
Рабочий каталог: `C:/Users/wenay/WebstormProjects/wenay-shell`.
Это другой репозиторий; cwd у инструментов задавать явно.

Прочитать AGENTS.md, docs/CODE-RULES.md, docs/CONTRACTS.md, собственную постановку.
Пользователь создаёт модульный каркас на wenay-common2/react2: backend/web/mobile/CLI,
разные разделы/подразделы/blocks, в том числе самостоятельный video-first без chat.

1. Работать только в назначенных ниже путях. Другие ветки и незнакомые файлы не менять.
2. root package/lock/tsconfig/scripts/общие docs принадлежат root. Новую зависимость
   сначала обосновать; не устанавливать и не редактировать package самостоятельно.
3. Использовать публичные npm exports. Никаких соседних исходников, node_modules patches,
   `npm link`, нового транспорта/replay или двойной схемы команд.
4. Нельзя менять examples, Dynamic, библиотеки, main; нельзя commit/push/publish.
5. Платные AI-вызовы, внешние подключения/публикации и пользовательские данные не нужны.
6. Писать factories с явными deps, типы выводить из реализации, соблюдать CODE-RULES.
7. Прогресс и доказательства писать в назначенный `docs/evidence/<task>.md`.
   Указать найденные API, допущения, ограничения и точные команды для root.
8. Для экономии ресурсов runtime/build/test запускает root последовательно после
   готовности файлов. Агент выполняет чтение/редактирование и сообщает READY FOR CHECK.
   Если нужна диагностика своей пробы, запросить у root один конкретный запуск.
9. Не оставлять бесконечный сервер. Любой процесс/порт/каталог имеет собственный owner
   и закрывается в finally; нельзя останавливать чужие процессы или очищать каталоги.
10. Не объявлять task accepted. Статусы исполнителя: in progress, ready for check,
    needs library change, needs environment. Приёмка принадлежит root.

## A. Native foundation — S00.03

Цель: executable evidence, что общий backend/client можно строить на public common2,
и карта реально нужных public API для будущих файлов/артефактов/AI.

**Write scope:** `probes/native-client/**`, `docs/evidence/S00.03-native.md`.
**Read scope:** установленный новый package и integration Chat:
`C:/Users/wenay/.codex/worktrees/examples-integration/wenay-examples/apps/chat/**`.
Не менять B/C файлы и не вводить зависимость от их незавершённых экспортов.

Выход:

- `probes/native-client/check.ts`, один воспроизводимый entry point;
- минимальный реальный native service/conversation host и два потребителя;
- отправить сообщение одним клиентом, проверить чтение вторым через native механизм;
- проверить release/close и отсутствие живых ресурсов в конце;
- где разумно в этой пробе, проверить тот же requestId/payload; не обещать crash-safe
  storage, если проба использует in-memory persistence;
- документировать public imports для service/conversation/observe/AI/artifact/media,
  точные exports и существующие lifecycle/receipt ограничения;
- не делать private JSON transport, HTTP workaround или fake websocket demo.

Команда root: `npm run probe:native`. Сценарий должен завершаться самостоятельно,
без фиксированного занятого порта, без реальных пользователей и без paid provider.
Нужное сохранение — только в собственном `.artifacts/native-probe` или OS temp с owner.
При библиотечном дефекте сохранить воспроизводимый исход и минимальный guard/repro,
не превращать failure в PASS. CLI production и полноценный backend сюда не входят.

## B. Composition prototype — S00.04

Цель: настоящий небольшой headless registry модулей/разделов/подразделов/views/blocks.
Он должен работать в приложении, в котором вообще нет chat-модуля.

**Write scope:** `packages/composition/**`, `docs/evidence/S00.04-composition.md`.
Исходные данные и фасад — docs/CONTRACTS.md, разделы 2/3.
**Основной entry:** `packages/composition/src/index.ts`.
**Tests:** `packages/composition/test/composition.test.ts` через node:test.

Выход:

- `createComposition({modules, profiles})`, намеренный read-фасад, ReturnType;
- независимые metadata fixtures assistant/video-studio, CAD при необходимости;
- стабильно упорядоченное дерево разделов и разрешение section → view → blocks;
- meaningful tests: профиль без chat, вложенный subsection, module/section cycle,
  duplicate ID, unknown reference, disabled dependency, неверный namespace/contractVersion,
  неизвестная platform capability и отсутствие предметных ветвлений core;
- краткий README с фактическими exports и примером нового подраздела.

Не писать server/React/renderer, не создавать generic plugin framework и не копировать
типы библиотечных service/commands. Чистая композиция может быть обычным TypeScript;
native observable/runtime механизмы добавляются там, где действительно нужны.
Не создавать отдельный package.json — root оформит package boundary после пробы.
Команда root: `npm run probe:composition`.

## C. Browser/platform probe — S00.05

Цель: проверить реальную связку public common2 state + react2 hook в браузерной сборке,
зафиксировать наличие средств мобильной/desktop разработки без обещания установки.

**Write scope:** `probes/platform-web/**`, `docs/evidence/S00.05-platform.md`.
Остальные packages/пробы не менять. От прототипа B не зависеть.

Выход:

- минимальные `index.html`, `src/main.tsx`, `src/style.css`, `vite.config.ts`;
- публичный common2 store и публичный react2 hook из разрешённого entry point;
- простое управление выбором раздела/подраздела и видимости рабочего блока;
  состояния могут быть test-only fixture, не изображать готовый backend/video/CAD;
- реальное обновление представления через библиотечную подписку, корректный teardown;
- Node/browser import boundary: не попасть server/fs в bundle;
- read-only environment matrix: ОС/Node, доступный Android SDK/Java/adb, iOS limitation,
  desktop candidate. Не читать env secrets и не устанавливать глобальный toolchain;
- команды root для typecheck/build/dev; список того, что понадобится для S06.01.

Vite конфигурация использует ephemeral port/127.0.0.1 для проверки и output
`.artifacts/platform-web`. Команды root: `npm run probe:platform:build`, затем
`npm run probe:platform:dev -- --port 0` для browser acceptance.
Root запускает сервер и проверяет UI, затем закрывает его. Это не mobile PASS.

## Root после ответов

1. Проверить, что write scopes соблюдены и package/lock не менялись агентами.
2. Запустить typecheck; затем composition, native и platform build последовательно.
3. На ошибку отправить автору конкретный stderr/воспроизведение; независимые готовые
   задачи продолжаются, общей инфраструктуры «на всякий случай» не добавлять.
4. Пройти браузерную пробу: смена раздела, подраздела, блока, cleanup; проверить
   отсутствие ошибки и утёкшего renderer. Скрин не равен установленному телефону.
5. Записать исходы в docs/BOARD.md и отчёт F0. Сохранить отдельные task commits;
   не приписывать implementation-ready полноценной платформе.
6. Назначить W1 по готовым зависимостям, сохранив одного владельца каждого общего файла.

## Формат финального сообщения агента

```text
Task ID и статус: ready for check / needs library change / needs environment.
Изменённые пути: полный список.
Фактический public API: exports и почему они подходят.
Поведение: что реализовано, что намеренно остаётся вне этой задачи.
Проверки: только действительно выполненные; команды для root отдельно.
Ресурсы: порты/процессы/данные и состояние cleanup.
Следующая зависимость: конкретный ID или минимальный blocker.
```

Не писать «всё готово», «все тесты пройдены» без команд и исходов.
Отчёт о будущем сценарии не заменяет executable proof.
