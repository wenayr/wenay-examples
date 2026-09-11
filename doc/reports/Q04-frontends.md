# Q04 — главные экраны приложений

Каждый `frontend/main.tsx` переписан под правила плотности (`doc/CONSOLIDATION-TASKS.md`, раздел «Правила плотности»):
строка ≤160 символов, один оператор на строку, цепочки из трёх и более преобразований разбиты,
условия из трёх и более связок вынесены в именованные предикаты, вложенных тернарных операторов нет.

Проверка каждого приложения: `npx tsc --noEmit`, `npm run build`, `npm test`,
`node scripts/style-check.mjs --app=<приложение> --path=frontend/main.tsx`.

| Приложение | Было нарушений в main.tsx | Стало | Что понадобилось сверх переноса строк |
| --- | --- | --- | --- |
| monitoring | 27 | 0 | Проверено в браузере: DOM после правки совпадает |
| documents | 29 | 0 | Разделы вынесены в именованные фрагменты |
| support | 33 | 0 | Таблицы подписей — в модульные константы |
| forms | 31 | 0 | Ветка «нет мастерской» — ранний возврат |
| booking | 30 | 0 | Предикат доступности раздела вместо цепочки условий |
| content | 32 | 0 | Разбор состояния — отдельные функции |
| metering | 22 | 0 | `eventUnits` вместо вложенного тернарного оператора, `auditLabels` — константа |
| crm | 26 | 0 | Предикат `visible`, счётчик `openDeals` |
| hosting | 25 | 0 | `restorable`, `address`, `deployForm`, `pendingStatus` |
| pizzeria | 52 | 0 | Таблица переходов `transitions` + предикат `available`; экраны — именованные фрагменты |

Все десять файлов внесены в `scripts/style-check.json` → `files`, поэтому `npm run check:all` защищает их от отката.

## Оставшиеся нарушения по приложениям (вход в Q05)

`node scripts/style-check.mjs --app=<приложение>` — по всем файлам приложения, не только main.tsx.

| Приложение | Файлов | Нарушений | Самые плотные файлы |
| --- | --- | --- | --- |
| pizzeria | 101 | 1013 | organizer/board.tsx 117, organizer/check.ts 104, backend/network-check.ts 89 |
| crm | 57 | 372 | frontend/deals.tsx 60, frontend/detail.tsx 42, backend/imports.ts 40 |
| hosting | 60 | 341 | backend/stateful-live-check.ts 44, backend/lxd-check.ts 21, backend/forms-live-check.ts 20 |
| support | 77 | 321 | organizer/task-domain.ts 35, frontend/inbox.tsx 24, backend/content-resource.ts 22 |
| content | 53 | 318 | backend/check.ts 36, backend/integration-check.ts 32, frontend/assistant.tsx 28 |
| forms | 52 | 299 | frontend/editor.tsx 47, frontend/results.tsx 44, frontend/respondent.tsx 34 |
| booking | 48 | 237 | frontend/calendar.tsx 63, frontend/assistant.tsx 29, frontend/settings.tsx 28 |
| documents | 54 | 204 | backend/processing-resource.ts 49, frontend/studio.tsx 46, backend/advanced-check.ts 34 |
| monitoring | 54 | 164 | organizer/task-domain.ts 35, backend/assistant-resource.ts 19, backend/check.ts 15 |
| metering | 50 | 134 | backend/integration-check.ts 31, backend/webhook-resource.ts 18, backend/webhook-check.ts 14 |
| catalog | 24 | 1 | server.mjs 1 |
| approvals | 39 | 0 | — |

Приложение целиком в `style-check.json` → `apps` добавлено только для approvals: у остальных
остаются нарушения в других файлах, и добавление приложения целиком сломало бы `npm run check:all`.
Поэтому регистрация ведётся по файлам (`files`), а снятие ограничения — задача Q05.
