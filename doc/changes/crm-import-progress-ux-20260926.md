# Q08 CRM: честный прогресс CSV импорта

26 сентября 2026, ORIGINAL. **Targeted type/build/runtime и bounded browser PASS.**
INTEGRATION source и текущий raw53023 gate не менялись этим slice.
Scoped style-check1file/0violations и scoped diffcheck PASS; это source hygiene, не runtime приёмка.
Independent read-only SOURCE review PASS, новых P1/P2 нет; root actual результаты ниже.

Actual предыдущий browser пример обработал4 строки: added2, duplicate1, invalid1, completed.
Карточка показывала «Завершён ·2/4», используя successful-added count без пояснения;
disabled «Продолжить оставшиеся строки» создавала впечатление незаконченной работы.

Теперь карточка явно показывает «Проверено N/total», где N = native imported + duplicate + errors.
Это вычисление existing authoritative projection; локальные counters/второе состояние не добавлены.
Native completed guard уже запрещает pending rows, поэтому пример станет «Завершён ·Проверено4/4».
Existing итоговые «Добавлено2 / Повторы1 / Ошибки1 / Всего4» и row-level причины остаются.
Для completed resume button скрыт, вместо него «Все строки проверены.» с status role.

Preview/cancelled/uncertain/running и чужой owner сохраняют прежние start/resume labels,
disabled/resumable/current ACL. Native state/schema/processor/receipt/resources, runtime и commands
не менялись. Completed не превращается в новый selectable resume state.

Exact commit scope: apps/crm/frontend/imports.tsx, этот report и два actual screenshots; own progress временный.
Существующий browser report/screenshot — evidence проблемы старого label, не acceptance нового diff.

Root target32866 завершился EXIT0: typecheck1.2/test21.9/build1.7с.
Fresh ORIGINAL browser fixture89843, loopback50938, own temp kMmhvU:
owner→Imports→built-in4rows→Save mapping→Start. Preview «Проверено0/4», completed
«Проверено4/4»; Added2/Duplicate1/Error1 сохранены, status «Все строки проверены»,
кнопка продолжения отсутствует. Console errors []. Actual360×640/documentWidth345,
mobile label и counts читаются; responsive web, не installed mobile.
[Desktop](../reports/crm-import-progress-20260926.png) и
[360px](../reports/crm-import-progress-mobile-20260926.png) просмотрены root.
Viewport reset, logout подтверждён login heading, own tab закрыт; helper stop EXIT0,
exact own temp absent и listening50938 равно0. Один semantic logout click не сработал,
fresh AX143 подтвердил выход; product bug на этой automation разнице не заявляется.

Это отдельный UX subset после integration raw53023. Arbitrary file upload,
running cancel/reconnect/role switching и installed platform не повторялись здесь;
existing native checks PASS не заменяют их browser matrix.

Следующее: перенести проверенный source slice в INTEGRATION и проверить объединённый
CRM. До этого raw53023 остаётся отдельным прежним checkpoint; main/push нет.

Перенос745ba88→INTEGRATIONe40062a выполнен после raw53023. Roottarget99016
на объединённом source EXIT0: type1.2/test23.2/build2.0с. Новый source имеет
свой scoped proof; прежний общий raw53023 не переименовывается в его acceptance.
