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
последующий итоговый запуск общей команды записан отдельным checkpoint ниже.

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

## Итоговый baseline checkpoint e4944c3

26 сентября 2026. Root подтвердил завершение raw `npm run check:all`, session4956:
**PASS, EXIT 0** на target tree `e4944c34ecc8659d0071d9405820c53c61f135a5`.
Выполнены 38 app checks из 39 шагов; Catalog build отсутствует по контракту.
Пропусков app checks из-за среды нет. `check:repo` также PASS: scaffold10,
sync101/15, style491/0, links807/0. Generated STATUS и Catalog обновлены штатным
генератором для этого checkpoint; данный report их не редактирует.

Intentional fake failure/skip в runner regression проверяют поведение самого runner
и не являются провалами/пропусками приложений этого gate. Первый raw EXIT1 выше
остаётся самостоятельным историческим фактом; новый успешный запуск его не стирает.

Свежий actual Counter/Documents native composition уже прошёл в этом checkout:
exit0, 2.782с, в пределах записанного выше Q06-B proof. Затем root выполнил единый
merged **11/11 local product modes Docker gate**, complete=true/code0,
`2026-09-26T19:26:40.573Z`: first deploy → second deploy → rollback,
stable gateway и соответствующие durable product assertions. Это новое merged
доказательство, а не перенос старых ORIGINAL selected outcomes. Все11 timings,
package+lock fingerprints и22 inspected image RepoDigests/IDs/dependency labels
сохранены в [отдельном live report](examples-integration-live-20260926.md).
Generic runtime scenario не выбран; external HTTPS/TLS/SSH/bootstrap и peak memory
этим Docker результатом не принимаются.

Таким образом, baseline этого конкретного объединённого дерева имеет успешный
общий app/repository gate, ранее записанный integration browser и fresh local Docker
product gate. Main/push/внешнее размещение не выполнялись. Последующие изменения
требуют своих проверок: Support history `b16c0da`, C07 `e1669c1` и отдельный Q11
artifact с snapshot fix root переносит **после** данного baseline. Они не входили
в проверенное дерево e4944c3 и не получают acceptance от session4956 или Docker11.
C07 installed/product runtime и Q11 Linux installation/external readiness остаются
отдельными непринятыми границами, даже при собственных узких технических proofs.
