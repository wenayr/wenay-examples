# Журнал плана 3

Задание — [doc/PLAN3-TASKS.md](../../PLAN3-TASKS.md). Строка на задачу: ID, дата, результат, хеш коммита.
Хеш появляется в строке, которая пишется после коммита задачи, поэтому она попадает в следующий коммит.

- Подготовка — 2026-09-11 — план 3 записан и связан с ROADMAP — 0dd2760
- Попутно — 2026-09-11 — `status.mjs --verify` переписывал STATUS.md при каждом прогоне check:all; verify сделан read-only — 0857f62
- R01 — 2026-09-11 — ROADMAP и NEXT-CHAT приведены к факту, заведён журнал, удалён дублирующий apps/approvals/AGENTS.md — e9e9ea9
- R02 — 2026-09-11 — SAAS-ACCEPTANCE сведён к правилам приёмки, остатки перенесены в столбец «Статус» очереди — 6585c3c
- R03 — 2026-09-11 — рецепты знают все восемь шаблонов, история проверок копий перенесена в changes, добавлены рецепты monitoring и forms — 8b27a7f
- Попутно — 2026-09-11 — scaffold-check падал на support и documents: npm test копии звал backup-check.ts, которого в копии нет; копировщик убирает этот шаг — d85dac6
- R04 support — 2026-09-11 — README 137 -> 65 строк, справочник в API.md, приёмка в SUPPORT-HISTORY — 5074fe1
- R04 documents — 2026-09-11 — README 166 -> 64 строки, справочник в API.md, приёмка в DOCUMENTS-HISTORY — e062ba4
- R04 metering — 2026-09-11 — README 166 -> 63 строки, справочник в API.md, приёмка в METERING-HISTORY — 2d72671
- R04 crm — 2026-09-11 — README 107 -> 60 строк, справочник в API.md, приёмка в CRM-HISTORY — b25baee
- R04 booking — 2026-09-11 — README 117 -> 60 строк, справочник в API.md, приёмка в BOOKING-HISTORY — 54aab39
- R04 forms — 2026-09-11 — README 137 -> 62 строки, справочник в API.md, приёмка в FORMS-HISTORY — 75592ff
- R04 monitoring — 2026-09-11 — README 110 -> 69 строк, справочник в API.md, приёмка в MONITORING-HISTORY — 883daee
- R04 content — 2026-09-11 — README 106 -> 63 строки, справочник в API.md, приёмка в CONTENT-HISTORY; R04 завершён, восемь README по 60-69 строк — 539d9d5
- U01 — 2026-09-11 — task-domain, published-contract и identity пиццерии в каноне; sync-check держит 97 копий по 14 файлам
