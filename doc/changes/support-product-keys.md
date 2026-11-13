# Q04: машинные ключи и опубликованный поиск Support

Дата приёмки: 26 сентября 2026. Ветка `codex/library-upgrade-20260926`.
Точные опубликованные зависимости: wenay-common2 3.1.1 / wenay-react2 5.0.0.

## Результат

Owner выпускает и отзывает ключи в разделе «Машинные ключи». Ключ связан с организацией,
имеет единственное право `knowledge:search` и срок от 1 до 90 дней. Отдельный account `product:<id>`
входит через стандартный login common2, получает authority-ресурс `productSearch` и HTTP published search.
Человеческий login сохранён; машинный account не получает членство, workspace и административные команды.

Выпуск/list используют настоящий owner resource `productKeys`, отзыв — команду `productKeyRevoke`.
Секрет возвращается только при первом выпуске, хранится в состоянии компонента и копируется явной кнопкой.
В durable state/replay сохраняется SHA256. Повтор requestId с теми же параметрами возвращает `secret: null`,
с другими параметрами отклоняется. Потерянный ответ не позволяет повторно получить прежний секрет.

HTTP и RPC вызывают одну предметную операцию поиска. Tenant, scope, срок и отзыв проверяются
перед reserve, перед чтением и после settlement; доступ не закрепляется навсегда выданным bearer/resource.
Предметные права остаются на сервере, независимо от доступности раздела в UI.

## Выполненные проверки

- Support typecheck и настоящий `npx tsx backend/product-check.ts` завершились PASS после расширения теста.
- Последовательный `node scripts/run-all.mjs typecheck test build --only=support`: 3/3 PASS,
  exit 0; test 32.5 с, build 2.0 с.
- Product-check: настоящий owner-client RPC issue/list/repeat/conflict/revoke; machine login/RPC;
  tenant/scope/no-admin; сохранённый HTTP bearer после expiry/revoke; отзыв во время reserve/settlement;
  закрытие настоящего RPC-ресурса во время удержанного IO, отмена signal и отказ pending RPC.
- Durable restart сохраняет active/expired/revoked состояния и не выдаёт секрет повторно;
  проверка файлов replay не обнаружила исходный секрет. Человеческий login и machine login при demo:false проверены.
- Browser owner: одноразовый выпуск, явное копирование и отзыв PASS; смена организации очищает секрет,
  возврат в прежнюю организацию его не восстанавливает. Owner видит раздел; после настоящего lead/customer login
  пункт навигации отсутствует. Ошибки консоли: `[]`.
- Browser logout при видимом секрете PASS: secret 1 → logout 0 → owner login и список из 3 metadata записей, secret 0.
- Текущий Support стенд штатно остановлен: helper exit 0, порт 63098 без listeners, каталог собственного fixture отсутствует.
  Старые временные fixtures оставлены без изменений; их очистка не засчитана.

Прерванные проверки не засчитаны. Runner 3/3 принимает границу Support, а не всё текущее рабочее дерево;
перед переносом в main необходим общий `check:all` итогового состояния.

## Ограничения и следующий этап

UsageGate в product-check тестовый. Настоящие Metering quota/receipt/dedup/uncertain/restart
и два реальных потребителя остаются задачей Q06; Q04 их не принимает.
Лимит 100 ключей включает expired/revoked: длительная ротация и очистка пока не реализованы.
Отрицательный REST login common2 возвращает `body.ok=false` с HTTP 500; библиотека не менялась.

Q02 исторический архив прежней версии и Q03 полный продуктовый live Docker gate остаются непринятыми.
Локальная backend/UI приёмка Q04 завершена. После сохранения этапа перейти к Q05 Documents;
общий адаптер выделять после второго настоящего потребителя.
