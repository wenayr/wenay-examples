# C03: минимальный контракт аккаунтов и workspace

26 сентября 2026. Это дизайн следующего этапа [Q12](../AI-CHAT-PRODUCT-PLAN.md),
а не описание реализованного поведения и не PASS. Рабочая точка продолжения —
[отчёт C03](chat-c03-20260926.md). Дизайн сохраняет основания; фактические проверки — в отчёте.

## Проверенное основание

Контракт сверён с установленными опубликованными `wenay-common2` 3.1.1 и
`wenay-react2` 5.0.0. Дальнейшая реализация использует только публичные экспорты.

- `createServiceClient` из `wenay-common2/service/client` предоставляет
  `identity.account()`, `token()`, `me()`, `permissions`, `onToken`, `onAuth`,
  views, commands, resources и `close()`. Публичного `setToken` или управления
  переключением аккаунта у этого клиента нет; `control` содержит `repick()`.
- `client.resources.open(name)` принимает имя зарегистрированного ресурса,
  без аргумента workspace. Его controller предоставляет `status`, `current()`
  с generation и remote, а также `close()`.
- `ServiceResourceContext` содержит principal, sessionId, resourceId и signal.
  Произвольного workspace selector в контексте нет.
- Service definition предоставляет `rolesOf`, views с `project(state, principal)`
  и commands с библиотечными input schema, receipts и контекстом текущего состояния.
- Conversation host/client сохраняют собственные persistence, receipts,
  state/events replay. React читает состояние через `useClientStore`, владеет
  клиентами через `useOwnedClient`, ограждает результаты действий через `useAsyncAction`.

Не добавлять второй transport, reconnect, replay, runtime schema или receipt store.
Текущий адаптер жизненного цикла conversation остаётся ограничением plain chat;
он не принимает безопасность semantic AI stream из C02.

## Сущности и ресурсный scope

`ChatState` сохраняет accounts и добавляет workspaces. Аккаунт содержит имя,
secret hash и enabled. Workspace содержит id, name и
`members: Record<account, 'owner' | 'member'>`; отсутствие записи означает отсутствие доступа.

| Workspace ID | Имя ресурса | Начальная membership | Назначение |
| --- | --- | --- | --- |
| `team` | `chat` | alice: owner, bob: member | Общая командная история |
| `personal` | `chatPersonal` | alice: owner | Личное пространство Алисы |

Registry фиксированный и типизированный; его значения объявляются `as const`.
Динамическое создание workspace не входит в этот минимальный этап.
Каждый ресурс замыкает собственный workspaceId, один native ConversationHost
и отдельный conversation journal в data directory. Native ConversationInitial
задаёт разговоры соответствующего workspace. Старые C01 shared и private-alice остаются
в Team; private-alice по-прежнему скрыт от Боба по conversation participant ACL.
Personal имеет новый personal-alice разговор только для Алисы.

Conversation IDs, channel IDs, source IDs и receipts проверяются внутри host
выбранного ресурса. Одинаковый requestId в разных workspace независим и не может
вернуть entity соседнего host. Workspace scope задаёт серверная фабрика ресурса;
клиентский селектор и переданный room ID не предоставляют доступ.
Не вводить отдельный изменяемый mapping workspace → conversation с вторым писателем.

Прежний C01 journal в Team сохраняется на прежнем пути без изменения event/receipt записей.
Personal — новое пространство с дочерним независимым журналом; история не переносится
неявно. Public service migrate version1→2 добавляет membership и сохраняет accounts.
Это миграция service schema с сохранением C01 истории, а не разделение старого журнала.

## Серверные представления и команды

`rolesOf(state, account)` возвращает базовую роль member только enabled аккаунту
и workspace-роли `workspace:team` / `workspace:personal` только при текущей membership.
`chat.allow` содержит `workspace:team`; `chatPersonal.allow` — `workspace:personal`.
Изменение membership меняет библиотечные permissions и инвалидирует открытые ресурсы.

View `workspaces` доступна вошедшему аккаунту и возвращает массив
`[{id, name, resourceName, membershipCommand, members: [{account, name, role}]}]`.
Она перечисляет только текущие разрешённые workspace и их участников, проверяя
enabled и membership непосредственно в state по principal.account.
Secret hashes, пароли и данные чужого workspace в projection отсутствуют.
Не доверять переданным или ранее вычисленным principal.roles вместо текущей membership.

Bound команды `teamMemberSet` / `personalMemberSet` принимают
`(requestId, {account, role: 'none' | 'member' | 'owner'})`. Каждая замыкает workspaceId
и имеет точный `workspace-owner:<id>` allow до native RPC receipt.
Общая factory сохраняет предметные проверки. Используются публичная service input schema
и библиотечная обработка command receipts. `none` удаляет запись membership.
Команда не меняет enabled аккаунта и не создаёт workspace или аккаунт.

Каждый apply повторно проверяет существование workspace, текущий enabled аккаунт
вызывающего и его owner membership именно в указанном workspace. Назначаемый
аккаунт должен существовать и быть enabled. Нельзя удалить или понизить последнего
owner; проверка выполняется в текущем command state. Ролевая allow-проверка фасада
не заменяет эту предметную ACL. Повтор и concurrent membership changes должны
проверяться через публичный command facade, включая отзыв прав вызывающего.
Native REST receipt на 3.1.1 обходит allow после потери owner: подтверждён public repro
[SERVICE-COMMAND-RECEIPT-ACL](../library-tasks/SERVICE-COMMAND-RECEIPT-ACL.md).
Поэтому C03 HTTP предоставляет только native login, остальные команды работают через
guarded native principal RPC. После published fix точная версия и повтор repro нужны
до восстановления HTTP command surface; новый transport/receipt не вводится.

Conversation resource дополнительно проверяет текущий enabled аккаунт и membership
bound workspace перед доступом и после асинхронного IO. Участие в workspace не
заменяет participantIds конкретного разговора: обе проверки обязательны.
Существующая общая очередь command validation + native commit остаётся внутри host
workspace. Она проверяет current ACL и signal при dequeue, payload и лимиты до
native команды, затем active перед выдачей результата. Библиотека остаётся владельцем dedup.

## Переключение клиента

Выбор workspace локален каждой сессии. Не сохранять общий activeWorkspace аккаунта
на сервере: две вкладки Алисы должны независимо работать в разных workspace.
UI выбирает resourceName из разрешённого view, закрывает прежний conversation owner
и открывает новый через существующий resource controller. Owner принимает имя
ресурса; экран и действия получают ключ `[session, workspaceId]`.

Переход A → B выполняется настоящим входом B и созданием нового ServiceClient
с токеном B. Начало переключения немедленно скрывает данные A и освобождает
conversation owner до service client. Новый session key/epoch ограждает поздний
результат входа, token renewal и команды A. Старый callback не записывает token
в новое sessionStorage и не меняет экран B.

История, выбранный разговор, черновики, delivery ticket, createInput, ошибки и
pending UI принадлежат account/workspace scope. Перемонтирование очищает их;
если позже сохраняются черновики, ключ включает account и workspace.
При logout локальный token удаляется и владельцы закрываются. Этот локальный logout
не обещает глобального отзыва ранее выданных токенов во всех устройствах.

При revoke current становится null, native consumers закрываются, прежние stores
очищаются. Новый grant или восстановление связи создаёт новую resource generation.
Нельзя использовать retained remote или выдавать результат позднего callback после
закрытия старой generation. Уже committed до revoke операция не обещает rollback;
последующая выдача результата и повтор всё равно требуют текущего доступа.

## Матрица приёмки

| Сценарий | Обязательный результат |
| --- | --- |
| Одна работающая browser-сессия Alice → переключить аккаунт → вход Bob → logout | Реальная identity Bob; личные данные Алисы и прежние drafts/delivery/errors скрыты сразу; logout освобождает владельцев |
| Поздние login/token/post/demo/create callbacks Alice после перехода Bob | Не меняют token storage, историю, выбранный разговор и actions Bob |
| Alice `team` → `personal` → `team` | Прежний store пуст; retained remote закрыт; возврат через native replay без дублей |
| Bob открывает личный workspace | Workspace отсутствует в view; прямой `resources.open('chatPersonal')` denied |
| Подставлены чужие room/channel/source IDs в разрешённый ресурс | Чтение, post, demo и createChannel запрещены; чужие сущности и receipts не возвращаются |
| Две сессии Alice выбирают разные workspace | Выбор независим; history, state и events соответствуют каждому host |
| Одинаковый requestId в разных workspace | Независимые receipts; результат не приходит из соседнего журнала |
| Owner отзывает membership Bob при открытом ресурсе | Permissions обновлены, resource denied, current null, старый store пуст |
| Retained remote после close/logout/revoke | state/events keyframe, post/demo/create и повтор старого receipt отклонены |
| Revoke одного workspace при доступе к другому | Чужой scope закрыт; оставшийся разрешённый workspace сохраняет доступ |
| Возвращена membership после revoke | Новая generation, текущая разрешённая история без дублей |
| Команда ждёт в очереди, затем close/revoke, затем dequeue | Текущие signal/ACL запрещают исполнение |
| IO или callback завершается после close/revoke/switch | Результат не выдаётся в прежний remote или новый account/workspace экран |
| Member пытается изменить membership; owner действует в чужом workspace | Серверная команда запрещена независимо от UI и claimed roles |
| Удаление/понижение последнего owner, включая concurrent команды | Последний owner сохраняется; проверки выполняются на текущем состоянии |
| Повтор membership command после утраты owner доступа | Нет выдачи привилегированного результата по прежнему receipt в обход current ACL |
| Restart с прежними secrets/data/port после revoke | Membership и запреты сохраняются; разрешённые клиенты восстанавливают native replay и receipts |
| Миграция service schema с сохранением C01 истории | Team journal сохраняет shared/private и receipts на прежнем пути; Personal новый и независимый, accounts/membership сохраняются |

Существующий chat не предоставляет blob/result surfaces. Для них в минимальном C03
фиксируется отсутствие API; если они добавляются, обязательны собственные current
scope checks и проверки после IO, retained remote и revoke. Это не подтверждение
существующей реализации таких ресурсов.

Приёмка требует targeted runtime и browser сценариев итогового кода с точными
package/lock, затем общего gate перед main. Дизайн и прежние PASS C01 не принимают
C03. Semantic AI streaming, remote agent, desktop и installed mobile сохраняются
отдельными C02/C06/C07 этапами.
