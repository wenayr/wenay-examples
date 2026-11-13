# CONVERSATION-RECEIPT-POLICY: повтор команды раскрывает результат после отзыва

Статус: подтверждённое поведение с нарушением ожидаемой границы доступа; требуется решение автора API.
Воспроизведено 26 сентября 2026 на опубликованном **wenay-common2 3.1.1**, Node 24.18.0.
React и транспорт не участвуют. Приложение и установленная библиотека не изменялись.

## Сценарий и фактический результат

Account создаёт conversation/channel и отправляет приватный текст через public fragment при разрешённой policy.
Внешнее право отзывается: `canRead`, `canWrite`, `canCreate` теперь возвращают false.
Сохранённый fragment с новым requestId отклоняет каждую команду; state keyframe старого и нового соединения
не содержит приватные данные. Но повтор прежнего requestId возвращает полный сохранённый message/channel/conversation.

Речь о новом серверном ответе после отзыва, а не удалении ранее сохранённых пользователем данных.
Account-scoped receipt не раскрывает чужой account; повтор не создаёт второй side effect.

[Воспроизведение](repro/conversation-receipt-policy.ts) использует только публичный
`wenay-common2/conversation` и Node API. `createRequire` разрешает этот export из установленного приложения,
поэтому запускать из `apps/chat`:

```sh
npx tsx ../../doc/library-tasks/repro/conversation-receipt-policy.ts
npx tsx ../../doc/library-tasks/repro/conversation-receipt-policy.ts --expect-fixed
```

Обычный режим подтверждает наблюдаемое поведение и завершился exit 0:

```json
{
    "repeatedPostReturnsPrivateResult": true,
    "repeatedChannelReturnsPrivateResult": true,
    "repeatedCreateReturnsPrivateResult": true,
    "freshRequestIdsDenied": true,
    "retainedKeyframeContainsPrivateResult": false,
    "freshConnectionKeyframeContainsPrivateResult": false
}
```

`--expect-fixed` проверяет отсутствие выдачи message через receipt и на 3.1.1 завершается exit 1.
Соединения и host закрываются в finally; нет платных запросов, файлового архива, серверов или временных данных.

## Контракт и ожидаемое поведение

Публичный CONVERSATION-RUNTIME.md обещает возврат первой entity при повторе requestId;
одновременно fragment описан как filtered replay и authorized commands. Явное исключение из текущей ACL
для receipt-return не описано. Это не нарушение идемпотентности: ожидается сохранить receipt и отсутствие
повторной записи, но проверять актуальный доступ перед выдачей приватной entity.

Если автор намеренно считает receipt неизменяемым правом на чтение результата даже после policy=false,
это должно быть явно документировано как ограничение revocation. Тогда задачу следует классифицировать
как требование дополнительной границы доступа, а не утверждать несовместимость с намеренным контрактом.

## Минимальное исправление и приёмка

Повтор `postMessage` должен отклоняться либо возвращать разрешённое подтверждение без закрытых данных,
если текущая policy запретила доступ. Receipt сохраняется, side effect не повторяется.
Аналогичную проверку выполнить для `createConversation`, `createChannel`, upsert/retract fact;
последние два метода этим repro не проверялись и дефект по ним не заявлен.

Критерии: разрешённый retry возвращает первую entity без дубля; после revoke предыдущий и новый requestId
не раскрывают закрытую entity; после восстановления доступа retry остаётся идемпотентным.
Проверить две сессии одного account и восстановленные durable receipts. Replay keyframe должен сохранить
уже подтверждённую фильтрацию. Предметные tenant/членство/платёжные правила не переносить в библиотеку.
