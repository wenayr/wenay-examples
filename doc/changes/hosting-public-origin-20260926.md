# Q11-P-Origin — public origin до первого deployment

2026-09-26. Реализован минимальный predeployment contract и owner/admin UI.
Targeted Hosting проверки и перечисленные ниже browser сценарии прошли; весь Q11/bootstrap/external deployment не принят.
Scoped browser сессия завершена и очищена. Отчёт фиксирует outcomes root, а не новый запуск тестов этим агентом.

## Поведение и контракт

Environment хранит optional `publicOrigin` отдельно от internal loopback route/endpoint.
Legacy archive без поля сохраняет прежнее поведение; version/migration не менялись.
Только Docker environment без active/pending и без любой предыдущей deployment operation допускает настройку.
После первого deployment API явно сообщает, что смена deployed domain ещё не реализована.
Никакие DNS записи, TLS сертификаты, public proxy, SSH install или автоматический redeploy здесь не создаются.

Public owner/admin resource `session.resources.open('publicOrigin')` предоставляет
`current().remote.control.set({requestId, environment, revision, publicOrigin})`.
RequestId непустой, максимум 120 символов; revision берётся из текущей dashboard view.
Canonical HTTPS origin не допускает credentials/path/trailing slash/query/fragment/wildcard/comma;
пустое значение снимает настройку. Origin уникален среди environments.
Result: `{environment, publicOrigin, revision}`. Native schema/command/receipt обслуживают запись и idempotent retry.

P1 review resolved: прямой owner/admin command alias удалён. Resource вызывает system-only `publicOriginSet`,
с явной проверкой SYSTEM_ACCOUNT и trusted actor из resource principal, через native mount/corridor pattern.
Current role/project проверяются до await и после на input.environment и **receipt.environment**.
Последнее закрывает changed-input replay старого receipt от отозванного проекта.
Closed resource, abort signal и старая runtime generation не возвращают поздний результат.
Receipt namespace/request key включает account, purpose и requestId; app не вводит свой receipt/cache/transport.
Unrelated старые Hosting commands не считаются исправленными этим guard.

После source review фабрика принимает реальный `deps.hasProject`: runtime и guard fixture используют
существующий service helper, повторяющаяся проверка project membership удалена без изменения role/project existence guards.
Финальный targeted runner после deps cleanup и двух style fixes прошёл 3/3.
Style fixes сохранили TS narrowing backend guard и вынесли frontend saveLabel без изменения поведения.

P2 review resolved: validator отвергает comma origin, которое URL parser мог принять как hostname,
а `SERVICE_CORS_ORIGINS` затем могло разделить на несколько origins. Negative regression добавлен.
Agent/Docker используют exact configured public origin для SERVICE_PUBLIC_URL/CORS, в том числе stateless workload;
route, gateway loopback bind и health target не меняются.

Форма visible только owner/admin и предлагает predeployment Docker environments.
Сохранённое значение приходит из authoritative dashboard view, draft не становится второй копией state.
Immutable retry ticket удерживает requestId/environment/revision/origin; явная отмена повтора создаёт новое намерение.
Project/environment/role/session scope cleanup закрывает resource и очищает draft/ticket/errors.
Published owned/action hooks и generation checks ограждают поздний completion.

## Фактически выполненные проверки root

| Проверка | Outcome |
| --- | --- |
| Финальный Hosting typecheck после deps/style fixes | PASS, 0.9 s |
| Финальный Hosting test после deps/style fixes | PASS, 10.8 s |
| Финальный Hosting frontend build после deps/style fixes | PASS, 0.7 s |
| Browser Chrome, отдельный Hosting fixture на loopback port 52220 | Перечисленные ниже сценарии PASS |
| Console errors в зафиксированной browser сессии | `[]` |

Это актуальный source runner 3/3, а не только ранние проверки 15.4/1.5 s или промежуточный
typecheck 1.0 s после Q05 type fix. Q05 исправления не включаются в Q11 commit.

Native regression покрывает origin validation/revision/receipt, role/project loss, changed-input receipt target,
pre/post-await abort/close/remount/revoke и archive restart; agent/Docker protocol fixture сохраняет route
и exact runtime Env. Эти tests не принимают реальные Docker deployment, DNS или HTTPS с внешней машины.

Browser fixture использует createHostingRuntime, native fragments/resource seed и собственный temp archive.
Он не читает пользовательские Hosting accounts/data и не запускает agent/deploy/DNS/TLS.
`fail-next` прерывает ответ после persisted native receipt; `hold-next` удерживает ответ после native persist.
Это контролируемая response fault injection вокруг настоящей native command, а не собственный receipt слой.

| Пройденный browser сценарий | Наблюдаемый результат |
| --- | --- |
| Owner save и clear origin | Настройка и снятие отражаются в view |
| app-two preset | Показан authoritative заранее сохранённый origin |
| fail-next, повтор того же immutable ticket | Retry успешно возвращает native receipt |
| hold-next persist → revoke owner → release | Форма исчезает; поздний ответ не возвращает owner UI |
| restore owner | Свежая форма без прежнего draft/pending/retry |
| Draft в проекте → переход в другой проект | Старый draft очищен |
| Logout → operator login | Форма отсутствует |
| Admin save | Настройка сохранена |
| Admin invalid HTTPS origin с path | Отклонён без изменения authoritative origin |
| Cancel retry после invalid input, исправленный origin | Input снова доступен; новое намерение принято с новым requestId |
| Observer login | Форма отсутствует |
| Agent login | Показано отсутствие dashboard; используется отдельный агент |
| Две owner tabs 1864035203/4: fail-next save A → save B во второй → cached receipt A в первой | Обе панели показывают authoritative B; повтор не откатывает state |
| hold-next save → переключение app-two → release | Новая форма сохраняется без старого draft/pending/error |

Console errors обеих дополнительных owner tabs: `[]`. Agent dashboard denied также подтверждён browser.

[Снимок browser приёмки](../reports/hosting-origin-browser-20260926.png)
сохранён root. Его наличие не означает, что все запланированные сценарии уже пройдены.

Fixture завершён командой stop: helper на port 40880 вышел с code 0; обе временные директории после cleanup
отсутствуют (existence=false). Browser tabs закрыты, console errors обеих owner tabs `[]`.

## Что остаётся непроверенным

Дополнительные варианты invalid input, mobile layout и reconnect draft/ticket UX
на момент отчёта не приняты. Запрос narrow viewport 360 не дал измеренного узкого окна:
actual `innerWidth` оставался 1528. Попытка не является 360/mobile acceptance; viewport затем восстановлен.

Наблюдалось неожиданное сворачивание details или повторное монтирование формы спустя время.
Причина не подтверждена; reconnect draft/ticket UX остаётся pending.
Source review отверг token-key гипотезу: onToken обновляет storage, не React token state.
Также native route reset:true само не очищает view mirror; публичный view.ready одноразовый,
per-reattach readiness/status в текущем контракте отсутствует.
Нельзя удерживать старую authority snapshot через role/project loss ради draft UX.
Безопасный следующий boundary: при same client/account и полноценной текущей library mirror можно сохранить subtree
во время health disconnect только с явным reconnect статусом и disabled actions; missing/empty authority snapshot,
role/project/account loss всё равно очищают scope. Причину actual remount надо сначала подтвердить public lifecycle evidence.

DNS/TLS/public proxy, реальный external deployment, чистый Linux bootstrap/install/update/rollback
и смена домена после deployment — отдельные непринимаемые этим срезом этапы.
Browser loopback fixture не является внешним HTTPS deployment evidence.

## Точный scope будущего Q11-P-Origin commit

Проверять/stage только эти Q11 файлы и собственные Q11 hunks; commit этим агентом не создан:

- `apps/hosting/backend/endpoint.ts`
- `apps/hosting/backend/service.ts`
- `apps/hosting/backend/public-origin-resource.ts`
- `apps/hosting/backend/public-origin-check.ts`
- `apps/hosting/backend/runtime.ts`
- `apps/hosting/backend/server.ts`
- `apps/hosting/backend/agent.ts`
- `apps/hosting/backend/agent-check.ts`
- `apps/hosting/backend/check.ts`
- `apps/hosting/backend/docker.ts`
- `apps/hosting/backend/docker-check.ts`
- `apps/hosting/frontend/main.tsx`
- `apps/hosting/frontend/public-origin.tsx`
- `apps/hosting/frontend/style.css`
- `apps/hosting/package.json` — текущий изменённый test wiring hunk относится к Q11
- `apps/hosting/README.md` — только первый Q11 publicOrigin contract/UI hunk; live-gate Q03 hunks отделить
- `scripts/hosting-origin-browser.mjs`
- `doc/changes/hosting-public-origin-20260926.md`
- `doc/reports/hosting-origin-browser-20260926.png`

Не включать Q03 live-gate/DOCKER/stateful/public-address/package scripts, Q05 Documents machine API/type fixes
и Hosting documents-live-check.ts, Q08 общие Vite manifest/config/report/status scripts,
другие приложения, root package/STATUS/shared plan/NEXT либо весь `doc/progress/` glob.
Hosting frontend/vite.config.ts относится к Q08 accounting и не входит в этот список.
Завершённые progress/review файлы исключены из commit scope: долговечный результат и pending ограничения перенесены в этот отчёт.
Q11 bootstrap design относится к следующему этапу, desktop skeleton лежит в другом managed checkout.

## Следующий шаг

Source runner и scoped browser evidence зафиксированы; report frozen для root scoped Q11 commit.
Reconnect/remount UX, mobile и дополнительные invalid shapes остаются отдельной работой.
Targeted PASS и успешный save не подменяют полную приёмку всех Q11/bootstrap/external возможностей.
