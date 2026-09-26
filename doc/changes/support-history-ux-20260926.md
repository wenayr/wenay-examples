# Q08 Support conversation history UX: browser draft

26 сентября 2026, ORIGINAL. **Desktop browser journey проверен root; mobile acceptance не принят.**
Этот отчёт сохраняет контракт изолированной приёмки, actual результаты и ограничения.
Pending conversation-history.tsx ранее прошёл root type/test/build; текущий source не менялся этим этапом.

## Проверяемый UI delta

Search submit применяет query.trim(); field и appliedQuery разделены. Status отображает применённый
запрос и accumulated shown/total count. Изменение поля само по себе не меняет результаты;
pagination продолжает appliedQuery. Clear очищает поле/ошибку и закрывает applied search;
collapse убирает page/searching/appliedQuery. Loading status и disabled actions видимы во время RPC.
Owner/staff private history и customer own/public history остаются в прежнем native resource ACL.

## Synthetic native fixture

Новый `scripts/support-history-browser.mjs`, запуск root после fresh Support build:

```text
node scripts/support-history-browser.mjs
```

Собственный temporary archive, loopback ephemeral port, собственные random corridor/token secrets;
createSupportRuntime + createServiceLeaderHost и существующие default synthetic accounts.
Метрики/content targets не подключены, AI provider явно отказывает, OIDC status disabled.
User archives/config/credentials не читаются; paid/external providers не вызываются.
Existing `scripts/browser-session.mjs` не менялся.

Seed использует настоящие native ticketCreate/ticketReply commands. Conversation resource read-only:
через public resource.page проверяется seed, не вставляются фиктивные rows/journal/receipt.
Новое обращение «История fixture: доставка и оплата»: 1 initial + 60 public replies + 6 private notes.
Staff видит 67 messages, customer 61; query «доставка» — staff36/customer30, «оплата» —30.
«Приватная» — customer0; outsider Northstar ticket недоступен по существующему ACL.
Native tail projection 20 messages: older staff47/customer41, поэтому проверяется несколько страниц.
Terminal `append` добавляет настоящий новый public reply, не отдельный API endpoint.
Terminal `stop`/SIGINT/SIGTERM/EOF закрывают host и удаляют только checked own temp directory.

## Root browser journey и ожидаемые результаты

1. Agent/owner login → выбрать synthetic ticket. Tail20 и «Показать предыдущие»47;
   load older20→40→47 без дублей, collapse оставляет прежний tail.
2. Ввести пробелы вокруг «доставка» → pending prompt → submit:
   applied status «доставка»:20/36. Изменить field на «оплата», не submit;
   status/results ещё «доставка», more продолжает прежний запрос→36/36.
3. Submit «оплата»→20/30→30/30. Clear очищает field и applied results, previous-history action возвращается.
   Empty/whitespace field disables submit; no-match query показывает0/0 и понятный empty state.
4. Collapse search убирает applied result, pending field prompt остаётся по current behavior;
   clear убирает его. Loading status/disabled actions проверить фактически, не через готовый screenshot.
5. Customer login: delivery20/30→30/30, private0; own tail/older41 и tenant boundary.
   Outsider не получает Northstar. Logout, ticket switch и native append очищают/remount прежний scope.
6. Измеренная narrow browser width, semantic locators и dev console errors; cleanup/temp absent.

Type/labels/preferences приёмку root записывает actual outcomes отдельно, без автоматического all PASS.
Reconnect continuity и долговременное сохранение applied query при ticket revision changes здесь
не обещаются: Inbox consumer key включает ticket revision/role, новый reply remount очищает локальную историю.

## Scope и evidence пока

Только новый helper и этот durable draft. `node --check scripts/support-history-browser.mjs` PASS.
Первый actual root startup не прошёл: 66 replies от одного agent превысили native perMinute60.
Это дефект seed fixture, не доказательство дефекта history UI. Helper теперь чередует существующие
авторизованные agent/owner: по 33 seed replies, включая private notes; terminal append продолжает
чередование. Native product rate limit не менялся, ожидаемые counts67/61/36/30 сохранены.
Actual root repeat startup/seed assertions **PASS**: loopback57156, session2869, own temp suffixoM7gLu.

## Actual browser evidence root

- Owner: 67 total/47 older; trim query «доставка» →20/36→36/36.
  Field draft «оплата» при More не заменяет applied «доставка»: остаются36 результатов и hint.
- Clear очищает query и закрывает search. Older pagination20→40→47; последняя страница содержит
  initial message и ответы1..6.
- Customer: 61 total/41 older; «доставка»20/30→30/30 без private messages.
  «приватная»0/0 с empty state.

- Desktop browser console errors: `[]`.
- Terminal append: native client получил62 total/42 older и новый public text без reload.
  Search сбросился при изменении firstId; сохранение прежнего applied search не обещается.
- Logout → outsider: только Harbor и собственный1 ticket; Northstar fixture недоступен.
- Оба own clients logout, tabs закрыты. Helper stop exit0, Test-Path own temp suffixoM7gLu False.
- Screenshot customer20/30 сохранён: [Support history browser](../reports/support-history-browser-20260926.png).

Mobile probe **не принят**: временный viewport attempt измерил width1528 вместо360, затем reset выполнен.
Этот screenshot и desktop journey не являются доказательством360/mobile. Reconnect continuity и
сохранение search при изменении firstId не проверены и не заявляются принятыми.
Frontend/backend/scaffold/package/locks, old browser helper и shared plans/STATUS не изменялись.
Actual desktop результаты приведены выше; mobile и reconnect continuity остаются отдельными шагами.
Fixture не подключает AI provider и не принимает paid/AI processing сценарий.
