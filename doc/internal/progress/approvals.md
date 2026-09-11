# K08: самостоятельные согласования из Forms

Начало измерения: 2026-09-10 20:16:54 UTC. Создать `apps/approvals` проверенным scaffold из Forms в отсутствующий каталог. Сохранить публичные библиотеки, shared hooks, identity/process lifecycle и повторно использовать динамические вопросы. Заменить предметную модель на заявку/неизменяемую отправленную версию/решение другого сотрудника.

Контрольные точки: scaffold и базовое npm ci; домен/typed commands; минимальный законченный UI; domain + authority/two-serving/restart/tenant ACL; браузер requester→reviewer→changes→approved; рецепт и фактическая стоимость изменений. Никаких paid AI или Docker параллельно. Пользовательские процессы не трогать.

## Возобновление: план 2, задача A01

Зафиксировано 11 сентября 2026. Исходное состояние перед доработкой:

- `npx tsc --noEmit` — **34 ошибки**. Все в `backend/domain-check.ts` и `backend/check.ts`: они остались от forms и импортируют `createFormsService`, `FormsDefinition`, `formsWorkspace`, `validateFields`, которых в приложении нет.
- `npm test` — падает сразу: `TypeError: (0 , import_service.createFormsService) is not a function`.
- `npm run build` — проходит.
- Файлов под git: 29. Строк `.ts`/`.tsx`/`.css`/`.html`: 627.
- Нарушений правил плотности: 131 (в основном `frontend/main.tsx`, записанный без пробелов).
- Имя пакета: `wenay-approvals-example` при остальных `wenay-<name>`.
- `backend/server.ts` и `backend/node.ts` уже переведены на согласования: порт 3818, каталог `approvals-data`, `createApprovalRuntime`. Остатки forms только в двух проверочных файлах и README.
- Домен записан полностью: команды `requestSave`, `requestSubmit`, `requestDecide`, `requestWithdraw`, `memberRole`; роли `owner`, `reviewer`, `requester`; представление `workspace`.

Начало измерения K08 по исходному журналу: 2026-09-10 20:16:54 UTC. Работа прервана в тот же день.
Логи исходного состояния: `work/approvals-baseline-typecheck.log`, `work/approvals-baseline-test.log`.
