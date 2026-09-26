# Интеграция библиотек, календарей и чата

Managed checkout `examples-integration/wenay-examples`, ветка
`codex/examples-integration-20260926`. База — ORIGINAL `58d0aeb`; main и push
не выполнялись. Незавершённые изменения ORIGINAL/GRAPH не копировались.
Пользовательский `apps/facade-map/TASK.md` в ORIGINAL сохранён без изменения.

## Состав

| Исходный этап | Интеграционный commit |
| --- | --- |
| G01 Organizer b03eabf | b627c4e |
| G02 Booking e9dae43 | cf06b6e |
| G03 status order 1fa38a2 | 25bb12a |
| G04 acceptance 4ff49d2 | 9be324a |
| C01 chat f083593 | 2bdd6b3 |
| C03 accounts/workspaces e97161a | a378d2f |
| C-OPT-CHAT 140d464 | 3569bcf |
| Q08 Chat manifest | c72062e |
| Текущая очередь f27d370 | d78c91c |
| Q06-B Documents receipt 71c9d8c | b3b8060 |

Root package сохраняет bundle regression, hosting live command и генерацию STATUS
перед verify. Конфликты generated STATUS разрешены через штатный generator:
до новых проверок результат этого checkout был unknown. Support Q04, Documents
Q05/Q07, lazy panels Q01 и Metering canonical не заменялись старыми app snapshots.
Независимый source audit PASS; sync — 101 копия / 15 канонов.

Зависимости всех 13 приложений установлены последовательным `npm ci` по exact lock.
Установка exit 0; глобальный allow-scripts не менялся. Targeted Pizzeria/Booking/Chat
typecheck/test/build: 9/9 PASS. Общий свежий `npm run check:all` запущен после
включения Q06-B: 38/38 выполненных app checks PASS, 39 шагов; Catalog build
отсутствует по контракту, пропущенных из-за среды проверок нет. Первый общий
прогон остановился на трёх отсутствующих исторических документах. Они сохранены
явно, ссылки переведены во внутренний контекст. Повтор `npm run check:repo`
PASS, exit 0: scaffold 10, sync 101/15, style 491/0, links 807/0 и STATUS verify.
Первый `check:all` exit 1 из-за этих ссылок не переименовывается в exit 0;
перед main нужен завершающий успешный запуск общей команды.

Отдельный actual Counter/Documents machine fixture повторён именно в этом checkout:
exit 0, 2.782 с. Typed receipt, current revoke, same-archive Documents restart и
dedup PASS; crash/lost-response между двумя native записями и Support machine
receipt linkage остаются вне этого узкого Q06-B доказательства.

## Browser на объединённом коде

Root использовал отдельные native серверы с собственными временными архивами,
демоаккаунтами и случайными внутренними secrets; пользовательские данные не читались.

- Organizer: 4 seeded tasks, неделя/день; Space → ArrowRight → Enter переносит
  «Планирование недели» с 26 на 27 сентября. Дневная доска показывает её вне дня,
  суммарное время 4 ч 30 мин / 3 задачи. Escape после изменения другой задачи
  сохраняет 09:00–11:00 и показывает «Перенос отменён».
- Booking: подтверждённая встреча 27 сентября 11:00–11:45 переносится клавиатурой
  из «Кабинет · Алексей» в совместимую «Студия · Анна», через явный предпросмотр
  и подтверждение. Сохранены клиент, один участник, 45 минут и нулевая предоплата;
  карточка и форма показывают новый ресурс/услугу.
- Chat: Alice отправляет одно локальное сообщение в общий разговор; Bob в другом
  клиенте видит ту же историю. Alice переключается в Personal: общий разговор и
  его история отсутствуют. Смена Alice → Bob очищает выбранный разговор, Bob
  получает только Team и общий чат; личное пространство Alice недоступно.
- Logout во всех трёх приложениях возвращает login. Console error logs пусты.
  Повторный физический touch, DST в browser, installed clients и внешний HTTPS
  этим интеграционным browser run не принимаются.

Все fixture servers нормально остановлены (exit 0). Три собственных временных
каталога `NOiY9g`, `cvbgyw`, `Gmj1Vs` проверены `Test-Path`: false. Вкладки закрыты.

Снимки: [Organizer](../reports/integrated-organizer-20260926.png),
[Booking](../reports/integrated-booking-20260926.png),
[Chat](../reports/integrated-chat-20260926.png).

После текущего общего gate нужны fresh actual Counter/Docs composition и Docker
images/live gate объединённого дерева. Старые 11/11 selected Docker outcomes
не принимают новый Pizzeria/Booking/Docs runtime. C07 desktop skeleton и отдельный
Q11 installation artifact пока находятся в работе и не входят в этот checkpoint.
