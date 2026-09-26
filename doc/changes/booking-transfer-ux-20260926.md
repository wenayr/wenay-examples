# Q08 Booking: понятный перенос встречи

26 сентября 2026, INTEGRATION после checkpoint4b79554/raw95073 EXIT0.
**Source review и отдельные actual type/runtime/build/browser проверки PASS.**
Baseline gate относится к предыдущему checkpoint, не принимает этот новый diff.
Scoped style-check для calendar.tsx/main.tsx по отдельности PASS1file/0violations, scoped diffcheck PASS.

Перенос из «Мои встречи» теперь показывает исходную встречу: услугу, место, дату/время и её IANA zone.
Первый период slot picker начинается с local date существующей записи вместо завтрашнего дня.
Рядом отображается выбранное новое время в zone услуги либо понятная просьба выбрать слот.
«Отменить перенос и вернуться к встречам» очищает только local moving state, возвращает Reservations
и закрывает error banner; native command не отправляется, исходная запись не меняется.
Во время command/action pending кнопка отмены disabled. Блок flex-wrap/word-wrap не требует новой layout системы.

Existing bookingMove payload/revision/key, bookingHold/waitJoin, domain/calendar resources и authority
не менялись. Existing resource owned раньше потребителя и closes при unmount как прежде.
Consumer scope generation учитывает resources/account/org/role/moving; layout-effect cleanup fence
отсекает late awaited completion до local refresh/intent reset/parent done после switch/unmount.
Guard также применён к existing waitJoin completion. Это UI consumer fence, не новая backend ACL система.

## Exact source scope

- apps/booking/frontend/calendar.tsx: initial period, old/new context, cancel button, late completion guard.
- apps/booking/frontend/main.tsx: local cancel callback, переданный Calendar.
- apps/booking/frontend/style.css: небольшой wrapping transfer block.
- Этот durable report. Own progress временный; backend/package/scaffold/shared не изменялись.

## Проверки и оставшиеся границы

1. Future confirmed meeting → Transfer: period содержит local date встречи, old time/place/zone visible.
   Выбор слота показывает new time/offset; Cancel возвращает Reservations без revision/start mutation.
2. Повторный вход → свободный new slot → confirm: один native bookingMove, existing immutable key retry
   не создаёт вторую запись. Pending Cancel disabled; stale revision/occupied slot сохраняют исходное время/error.
3. Org switch, current role loss, logout или другой consumer пока ответ удержан: late success/failure
   не вызывает прежний done и не меняет local state нового scope. Resource/client cleanup проверить actual.
4. IANA zones/DST offsets через existing when formatter и Temporal.Instant; measured narrow width
   проверяет wrapping, semantic locators, console errors и screenshot без выдуманного mobile PASS.
5. Fresh targeted type/runtime/build, независимый read-only review, root browser и cleanup.

Никакие heavy checks/build/browser/npm install этим source этапом не запускались. Не заявляется
перенос формы через reconnect, remote installed/mobile приёмка или изменение native policy.

После source freeze root выполнил targeted run20383: typecheck0.7/test20.4/build0.9с,
все3 PASS EXIT0. Independent source review не обнаружил новых P1/P2.
Предыдущий общий raw95073 относится к дереву до этой UX правки; это отдельный targeted proof.

Browser на настоящем owned backend70919, loopback56568: владелец открыл seeded
подтверждённую встречу27сентября10:00. Отмена вернула Reservations с прежним временем.
Повторный вход, семь календарных переходов и свободный слот4октября09:00 показали
old27сент10:00/new4окт09:00; подтверждение перенесло существующую встречу.
Повторное открытие той же записи показало исходное4окт09:00 и **обе даты периода
2026-10-04**, без возврата к завтрашнему дню. Отмена сохранила4окт09:00.
Console errors: []. Для дат использованы календарные кнопки; browser fill date-input
сам по себе не применил React состояние и не считается проверенным ручным вводом даты.

Responsive actual: innerWidth360/innerHeight640, document.scrollWidth345,
панель312.8px, кнопка264.98px. Вторая owned fixture18468/51820 создана только для
контекстных screenshots: старое27сент10:00/new27сент09:00, cancel без submit.
[Desktop](../reports/booking-transfer-20260926.png),
[360px](../reports/booking-transfer-mobile-20260926.png) просмотрены root.
Viewport reset, оба клиента вышли, own tabs закрыты. Оба helper stop EXIT0;
own temp gX6F3S/aRXZL6 отсутствуют, listening56568/51820 равно0.
Первый helper без PTY завершился EXIT1 до readiness из-за закрытого stdin;
затем приёмка запускалась с PTY, это не app failure или пропущенный app test.

Новая held-response org/role/logout browser matrix, browser occupied/revision race,
повтор submit с тем же ключом и отдельный DST переход **ещё не пройдены** этим journey.
Существующие domain/runtime tests passed и native payload не менялся; эти факты не
заменяют перечисленные browser проверки. 360px — responsive web, не installed mobile.
