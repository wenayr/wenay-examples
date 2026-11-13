# Q05: публичный recovery policy feasibility probe

26 сентября 2026. Узкое runtime evidence для
[дизайна Q05](documents-q05-design-20260926.md), **не реализация и не приёмка Q05**.
Не является новым library bug report или шестой ошибкой библиотеки: strict ACL refusal
ниже следует из контракта recovery и выбранной предметной policy.

## Проверенный fixture

Долговечный исходник: [documents-processing-policy.ts](../reports/repro/documents-processing-policy.ts).
Используется установленный опубликованный `wenay-common2` 3.1.1: публичные
`createAiRunHost`, connection, `createAiRunClient`, recovery.pending/settle и Documents
`openAiCheckpoint` с native fs replay storage/fsync. Пакет разрешается через createRequire
с anchor `apps/documents/package.json`; imports library internals отсутствуют.

Команда из `C:\Users\wenay\WebstormProjects\wenay-examples`:

```powershell
& .\apps\documents\node_modules\.bin\tsx.cmd .\doc\reports\repro\documents-processing-policy.ts
```

Fixture создаёт только собственный временный `apps/documents/.test-data/q05-policy-*`,
закрывает hosts и удаляет этот каталог в try/finally с проверкой resolved target.
Платный provider, пользовательские документы, HTTP/RPC сервер, самостоятельные receipts,
reconnect и изменения native/app source не используются. Fake runner удерживает один run;
всё durable состояние и terminal transition записывает native host.

## Фактические исходные запуски

Root выполнил первый вариант fixture: exit 0, 1.316 с. Незавершённый durable run
после close/restart и `allowed=false` сохраняется в native recovery.pending;
`recovery.settle(...failed...)` отклоняется с `current owner or resources are forbidden`.
Executor вызван один раз; native recovery не запускает его автоматически.

Root выполнил второй вариант: exit 0, 0.723 с. Он подтвердил strict refusal и дополнительно:

- Private синхронная closure выдаёт permit только exact recovered run.id/owner и точному
  persisted request payload. canWrite одноразово переводит write → create, canCreate
  переводит create → spent до native terminal mutation. Outcome closure фиксирован failed.
- Public persistence callback делегирует запись существующему Documents checkpoint и
  пробует reentry при spent permit. Consumer create/cancel отклонены; native может отдельно
  отказать с `must not reenter`. Semantic keyframe для revoked account содержит пустые runs.
- canRead не расширяется. После settle permit очищен finally, regular policy остаётся
  revoked; native consumer repeat/new create и cancel denied, native client store пуст.
- recovery.pending становится пустым. После второго restart terminal state остаётся failed,
  recovery.pending пуст, executor count остаётся 1. Consumer create/cancel всё ещё denied.

После этих запусков fixture перенесён из doc/progress в doc/reports/repro; изменены только
два относительных пути к Documents с `../../` на `../../../`. Root повторил указанную
команду по новому пути: exit 0; strict refusal и one-use reconciliation подтверждены.

## Границы результата

One-use permit — feasibility fixture, **не выбранный production adapter**. Он зависит
от установленного порядка common2 3.1.1: requireRecovery синхронно проверяет canWrite,
затем canCreate ровно один раз до terminal state изменений. JSON payload comparison
достаточен для фиксированного plain request этого fixture, не универсальная схема equality.
No await и отсутствие caller-selected callback/outcome необходимы для его узкой границы.
Повторная проверка порядка и reentrancy обязательна при изменении версии библиотеки.

Persistence probe доказывает отказ reentry во время synchronous commit и отсутствие
read disclosure; он не доказывает безопасность произвольных application observers,
provider approvals/input, consumer policy callbacks или широкого temporarily elevated flag.
Не переносить этот ordering-dependent permit в приложение автоматически.

Fixture не реализует persisted machine keys, clock expiry, DocumentState processingFailure,
общий mount.ready, второго live tenant, blob IO, HTTP disconnect, ordinary close completion
либо runner abort → failed в работающем Document processing pipeline. Revoked policy в
fixture моделируется boolean; поведение конкретного expiry timer и credential authority
остаётся следующими независимыми проверками. Failed здесь — native terminal reconciliation,
а не доказательство отмены всех реальных processor/provider effects.

## Предпочтительное направление следующего дизайна

Рассмотреть отделение credential ACL от private job authority policy вместо одноразового
порядкового permit. Машинная credential ACL живёт в guarded четырёхметодном façade и
processing IO/domain checks; native AI connection остаётся внутренним. Private host policy
подтверждает job owner/resource scope для terminal authority reconciliation независимо от
дальнейшей пригодности consumer key; revoke/expiry прекращает job через owned controller.
Ни machine raw replay, ни raw create/write отозванному consumer не публикуются.

Это также пока дизайн, не реализация. До выбора проверить, что human raw AI resource,
его member/tenant guards, native repeat/read/write и review/admin не ослабляются. Если
один shared host требует разных human/authority checks, границы нужно доказать малым
public probe раньше изменения app policy; второй host/ledger для обхода не создаётся.
Публичный API blocked отмечается честно, если безопасная композиция не подтверждается.

Следующее действие: отдельно доказать credential/job-authority separation в работающем
продуктовом фасаде; relocated fixture уже повторён и не заменяет эту приёмку.
