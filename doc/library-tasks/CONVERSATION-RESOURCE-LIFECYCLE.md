# CONVERSATION-RESOURCE-LIFECYCLE: управляемое завершение native conversation consumer

Статус: **открыто на опубликованной wenay-common2 3.1.1**, 26 сентября 2026.
React в минимальном воспроизведении не используется; приложение chat использует react2 5.0.0.
Это lifecycle consumer, отдельный от [Conversation receipt policy](CONVERSATION-RECEIPT-POLICY.md).
По механизму связано с [AI-RESOURCE-LIFECYCLE](AI-RESOURCE-LIFECYCLE.md): другой native consumer создаёт replay без error port.

## Сценарий

Пользователь открывает SC1 chat resource и создаёт `createConversationClient` из его remote.
`client.ready` выполнен, сообщение уже доставлено в store через live replay.
Затем владелец закрывает resource, пока consumer ещё жив, либо сервер отзывает membership.
SC1 правомерно завершает прежний remote. Native consumer должен сообщить терминальное состояние или ошибку владельцу.
Завершение не должно выбрасывать глобальную ошибку процесса из отложенного callback.
Внешний отзыв нельзя всегда предварить клиентским `close()`.

## Самостоятельное воспроизведение

[public repro](repro/conversation-resource-lifecycle.ts) использует только публичные экспорты установленного npm-пакета:
`wenay-common2/conversation`, `wenay-common2/service/client`, `wenay-common2/service/host`.
Из `apps/chat`, где `package.json` и lock фиксируют common2 **3.1.1**:

```text
npx tsx ../../doc/library-tasks/repro/conversation-resource-lifecycle.ts
npx tsx ../../doc/library-tasks/repro/conversation-resource-lifecycle.ts --revoke
npx tsx ../../doc/library-tasks/repro/conversation-resource-lifecycle.ts --revoke --dispose-before-end
```

Один loopback RPC host слушает случайный порт `127.0.0.1:0`, service definition находится прямо в repro.
Conversation host хранит fixture в памяти. Нет импорта app backend, internal API, патчей npm,
глобального `uncaughtException`/`unhandledRejection` handler, дочерних процессов, Docker или внешних ИИ-вызовов.
`finally` предусматривает закрытие native client, resource, session, service host и conversation host.
Process fatal способен оборвать выполнение до завершения этой очистки; её наличие не подавляет дефект.
Обычный режим намеренно оставляет позднее исключение видимым; top-level catch обрабатывает только ошибки `main`.

Самостоятельный режим `--revoke` на 3.1.1 завершился с кодом 1 после строк о выполненном ready,
доставленном сообщении и отзыве membership:
`replaySubscribe: live line from seq 2 failed: logical RPC line ended`.
Строка `FINALLY` не напечатана: fatal наступил раньше завершения cleanup, и top-level `main catch` не получил ошибку.
В первом app C01 runtime на той же версии native client также завершился с кодом 1:
`replaySubscribe: live line from seq 6 failed: logical RPC line ended`.
Номер seq определяется количеством событий fixture и не является частью требования.
Контроль `--dispose-before-end` закрывает consumer до resource; он проверяет обычное владение при известном shutdown.

| Проверка 26 сентября на npm 3.1.1 | Фактический результат |
| --- | --- |
| Обычный режим: `resource.close()` с живым native consumer | Exit 1, seq 2 `logical RPC line ended`; `main catch` и `FINALLY` не напечатаны |
| `--revoke`: сервер отозвал membership после выполненного ready и доставки сообщения | Exit 1 с той же поздней ошибкой; `main catch` и `FINALLY` не напечатаны |
| `--revoke --dispose-before-end`: consumer закрыт до отзыва | Exit 0, `FINALLY` и `PASS` напечатаны |
| `npm test` в chat с временным adapter | Прошёл, включая реальный membership revoke и конкурентные requestId |

Оба fatal режима проверены отдельными короткими процессами; после их завершения прежние RPC порты не слушают.
Контроль подтверждает корректность обычного shutdown и не превращает внешний отзыв в управляемую ошибку native consumer.

## Доказательство на опубликованном коде

В установленном пакете `lib/Common/conversation/conversation-client.d.ts`, строки 14–18,
`ConversationClientDeps` содержит `remote`, `initial`, `drain`; публичного позднего error/lifecycle port нет.
`conversation-client.js`, строки 15–16, вызывает `syncStoreReplay(store, remote.state)` и
`replaySubscribe(remote.events, forwardEvent)` без error options.
`ready` объединяет обе первоначальные ready promises; уже выполненный Promise не может сообщить позднее завершение.

`lib/Common/events/replay-wire.js`, строки 249–263: библиотека наблюдает завершение cancellable thenable,
возвращённого публичным `remote.line.on(...)`, и вызывает `failRecovery` с `logical RPC line ended`.
В `failRecovery`, строки 212–227, при отсутствии `onError` вызывается `setTimeout(rethrowRecoveryError, 0)`.
Поэтому последующий `client.close()` из `finally` не отменяет уже поставленный timer throw.
Публичный `syncStoreReplay` поддерживает `onError`, но native conversation client его не передаёт.
Эти пути прочитаны для доказательства; repro не импортирует их напрямую.

## Временная композиция приложения

`apps/chat/shared/conversation-client.ts`, `createOwnedConversation`, сохраняет native `createConversationClient`
и исходный публичный RPC line handle. До передачи handle библиотеке регистрируется observer его завершения;
observer закрывает consumer прежде, чем внутренние callbacks успеют поставить fatal throw.
Обёртка сохраняет native schema, replay и команды. Она не создаёт параллельный транспорт или собственный replay.
Владелец frontend по `onEnded` очищает старое зеркало; следующий ресурс получает нового consumer.
App runtime проверяет реальный серверный membership revoke. Результат app guard не означает исправления библиотеки.

Привязка React cleanup к remote generation сама по себе не гарантирует достаточно раннего закрытия.
Простое закрытие consumer перед известным локальным shutdown тоже не решает внешний отзыв.
Нужен поддерживаемый error/lifecycle port внутри native consumer, а не требование к пользователю соблюдать порядок then-observers.

## Требуемое улучшение и приёмка

Конкретный API остаётся за библиотекой. Нужен наблюдаемый поздний terminal/error channel для обеих
внутренних подписок conversation client с определённым поведением при окончании SC1 generation.
Не требуется переносить membership, выбирать новый remote или автоматически повторять команды в consumer.

1. После выполненного `ready` ресурс закрывается и membership отзывается без process fatal;
   ошибка или терминальное состояние доставляется владельцу consumer.
2. Оба replay — state и semantic events — освобождаются; поздние пользовательские callbacks после `close()` не вызываются.
3. `close()` идемпотентен. Проверить окончание до ready, прерванный catch-up и первоначальную ошибку как отдельные регрессии.
4. Новый SC1 generation создаёт отдельного consumer; прежний remote не используется заново, post/create команды автоматически не повторяются.
5. Завершение одного ресурса не завершает независимые consumer и общий host; транспортный disconnect имеет документированное поведение.
6. После публикации точной npm-версии повторить оба native repro, добавить проверку terminal/error channel,
   убрать line observer guard и прогнать `npm test` в chat с реальным membership revoke и очисткой frontend store.

Дополнительные случаи из критериев — требования к будущей регрессии, а не утверждение о выполненных проверках.
