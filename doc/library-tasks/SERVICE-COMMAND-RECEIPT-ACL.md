# SERVICE-COMMAND-RECEIPT-ACL

26 сентября 2026. Точная опубликованная npm-версия: `wenay-common2` **3.1.1**.
Статус: подтверждено public runtime repro на npm 3.1.1; библиотека не исправлена.

## Сценарий и ожидаемое поведение

Владелец workspace выполняет native service command с `allow: ['workspace-owner:team']`.
Команда возвращает приватный fixture marker. После понижения до member токен остаётся
валидным, но текущая owner-роль исчезает. Новая команда и повтор старого requestId через
HTTP должны отклоняться. Идемпотентность не даёт права читать закрытый результат.

## Наблюдение по опубликованному коду

Native REST связывает команды через `leader.corridor.byToken()`. Этот путь проверяет
валидность токена и затем обращается к native command receipts. Повтор возвращает прежний
результат до проверки service `command.allow`, input validation и apply. Предметная ACL
в apply не защищает повтор. Principal RPC имеет дополнительный current-role guard;
контроль этого пути включён в repro и прошёл в обоих запусках.

## Минимальное воспроизведение

[Public repro](repro/service-command-receipt-acl.ts) использует только опубликованные
`service/host`, `service/client` и `package.json`, разрешённые через createRequire из cwd
`apps/chat`. Он не импортирует приложение, private exports и не изменяет npm-код.
Fixture создаётся в собственном временном каталоге и удаляется в finally.

```text
cd apps/chat
node --import tsx ../../doc/library-tasks/repro/service-command-receipt-acl.ts
node --import tsx ../../doc/library-tasks/repro/service-command-receipt-acl.ts --expect-fixed
```

Обычный режим ожидает: fresh HTTP denied, retained principal RPC denied, повторный HTTP
возвращает marker; exit 0 подтверждает дефект. `--expect-fixed` ожидает отказ старого HTTP
receipt и должен завершаться exit 0 после исправления; на текущем дефекте ожидается exit 1.

Фактические результаты 26 сентября 2026: обычный режим exit 0, `version: '3.1.1'`,
`freshHttpDenied: true`, `retainedRpcDenied: true`, `repeatedHttpReturnsPrivateResult: true`.
`--expect-fixed` завершился exit 1 на assertion `true != false`; cleanup finally завершился
в обоих режимах. Новый HTTP запрос получил статус 500 с `forbidden`; это вторичное
наблюдение о статусе ошибки, основной дефект — успешная выдача закрытого receipt result.
Эти результаты подтверждают библиотечное воспроизведение, а не приёмку C03 приложения.

## Минимальное общее исправление и критерии

Публичный service command facade должен проверять текущую allow-политику перед любым
receipt result, включая HTTP/byToken и in-flight duplicates. Не переносить предметную
workspace ACL в библиотеку и не создавать вторую систему receipts. Проверить revoke роли
при сохранении другой роли и валидного токена, retained RPC, HTTP, новый requestId,
старый requestId и сохранённые receipts после restart.

## Временная граница C03

Chat использует отдельные bound native команды teamMemberSet/personalMemberSet с точными
current workspace-owner allow-ролями через principal RPC. Встроенная полная REST-поверхность
отключена; публичный native REST монтируется только под login route. HTTP commands не
экспортируются. Это ограничение поверхности приложения, библиотечный дефект не исправлен.
После публикации исправления: точное npm-обновление, `--expect-fixed`, удалить ограничение
REST и повторить отрицательную runtime матрицу C03.
