# Неиспользуемые файлы и зависимости

Дата: 11 сентября 2026. Задача S05 [плана 2](../CONSOLIDATION-PLAN.md). Воспроизведение: `node scripts/unused.mjs`.

Скрипт строит граф достижимости от точек входа приложения: команды `package.json`, `Dockerfile`, `index.html`, manifest scaffold. Кроме обычных импортов он учитывает запуск дочернего процесса по имени файла (`createProcess({script: 'serving-node.ts'})`, `boot('leader-pizzeria.ts')`, `path.resolve(__dirname, 'pdf-processor.mjs')`) — без этого пять рабочих файлов выглядели бы мёртвыми.

Зависимость считается использованной при импорте из исходников, при упоминании бинарника в скриптах или при объявлении её peer-зависимостью установленной библиотеки. Последнее существенно: `wenay-common2` объявляет peer `socket.io`, `socket.io-client`, `swagger-ui-dist`, а `wenay-react2` — `ag-grid-community`, `ag-grid-react`, `react`, `react-dom`. Приложение обязано их поставить, хотя импортирует их библиотека. **Неиспользуемых зависимостей в каталоге нет.**

## Удалено

| Файл | Основание |
| --- | --- |
| `apps/pizzeria/backend/payments.ts` | Заготовка без единой ссылки. Уже была названа неиспользуемой в [оценке библиотек пиццерии](pizzeria-library-assessment.md) |
| `apps/pizzeria/backend/effects.ts` | Там же. Совпадение по слову «effects» в других файлах — локальная переменная, не импорт |
| `apps/pizzeria/organizer/media-browser-fixture.tsx` | Не упоминается ни в коде, ни в документации; `organizer/media-browser-check.ts` его не использует |
| `apps/metering/shared/react/replay-view.ts` | Копия общего адаптера, которую metering не импортирует |
| `apps/approvals/shared/react/replay-view.ts` | То же для согласований |
| `apps/approvals/shared/react/command-action.ts` | То же |
| `apps/monitoring/backend/metered-execution.ts` | Мониторинг не потребляет учёт: `metering` упомянут в нём только как адрес наблюдаемого сервиса в `http-probe.ts` |
| `apps/monitoring/backend/metering-contract.ts` | Использовался лишь предыдущим файлом |

Карта синхронизации и manifest scaffold обновлены: `monitoring` больше не копирует адаптеры учёта, копий канона стало 90 вместо 95.

## Оставлено с причиной

| Файл | Почему остаётся |
| --- | --- |
| `apps/support/backend/ai-policy-repro.ts` | Воспроизведение открытой задачи [AI-POLICY-INVALIDATION](../library-tasks/AI-POLICY-INVALIDATION.md); запускается вручную командой из задачи |
| `apps/support/backend/store-nested-replacement-repro.ts` | Воспроизведение [STORE-NESTED-REPLACEMENT](../library-tasks/STORE-NESTED-REPLACEMENT.md) с командой запуска в тексте задачи |
| `apps/monitoring/backend/ui-fixture.ts` | Описан в README мониторинга как отдельный генератор демонстрационных данных для ручной проверки интерфейса |
| `apps/pizzeria/organizer/long-board-preview.ts` | Ручной замер длинной доски, описан в README органайзера и в `doc/changes/collaboration-s2.md` |
| `apps/pizzeria/organizer/measure-activity.ts` | Опциональные метрики development-сборки, там же |
| `apps/pizzeria/shared/react/command-action.types.ts` | Описан в `apps/pizzeria/shared/react/README.md` и участвует в библиотечной задаче [react-command-tuples](../library-tasks/react-command-tuples.md) |

Общее правило: файл без ссылок из кода, но с описанной в документации ручной командой запуска — инструмент, а не мусор. Такой файл остаётся, пока документация его описывает.

## Проверки

`npm run typecheck:all` без новых ошибок, `npm test` в metering, monitoring и pizzeria, `node scripts/scaffold-check.mjs`, `node scripts/sync-check.mjs`.
