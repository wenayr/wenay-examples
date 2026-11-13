# G03: состояние проверок после общего прогона

Свежий worktree мог успешно проверить приложения, затем упасть при сверке старого STATUS,
потому что `check:all` не пересоздавал его между `check:apps` и `check:repo`.
Теперь порядок: приложения → генерация STATUS/витрины → проверки репозитория и сверка STATUS.

Результат на `codex/work-calendar`, 26 сентября 2026: общий check:all завершён с кодом 0,
35 проверок приложений / 36 шагов; catalog build отсутствует по контракту.
После финального UI review Organizer повторные typecheck/build прошли, затем status/check:repo.
Последний repo gate: scaffold9, sync97/14, style448/0, links694/0, status verify PASS.
Регрессия runner/status проверяет success/failure, stale fingerprint, explicit skip,
absent script, legacy log и стабильную сверку; её отрицательные fixture-результаты ожидаемы.

Графические пользовательские сценарии приняты отдельно:
[G01 Organizer](work-calendar-organizer.md), [G02 Booking](work-calendar-booking.md).
Это не приёмка физических устройств или внешнего размещения; main не менялся, push не выполнялся.
