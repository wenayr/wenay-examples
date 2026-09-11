# Documents D02/D05/D06/D07

Критерии backlog прочитаны. Цель — закрыть реальные gaps без нового удалённого пула/SDK.

1. D02: отменяемая загрузка с явным token/abort до metadata commit, byte limits и cleanup через существующие blob/queue.
2. D05: заменяемый OCR/model extraction port, явный локальный test provider, источники полей и sourceVersion; без платных запросов.
3. D06: визуальное сравнение текущей таблицы с immutable утверждённой версией.
4. D07: настоящий Node/Python child concurrency, отмена одного не завершает второй; существующий domain/timeout/restart suite.
5. Typecheck/build/full regression и docs/acceptance, scaffold manifest сообщить root. Docker только после согласования свободного слота.

Checkpoint: код D02/D05/D06/D07 и P01 product HTTP завершён. Финальный typecheck/build, полный npm test с настоящим Python (domain/network/product HTTP), test:advanced с двумя реальными child PID — PASS. Все новые файлы включены в Docs scaffold manifest; общий файловый scaffold-check семи приложений PASS. README и doc/reports/DOCUMENTS-D02-D07-ACCEPTANCE.md содержат факты и границы.

По запросу корневой задачи новые этапы до checkpoint не начинаются. Точных незавершённых изменений кода нет. Следующая отдельная приёмка при продолжении: новое локальное preview для browser QA upload cancel / model provenance / version comparison; затем согласованная свежая Docker сборка first/second и documents-live-check. Старые Docker digest не выдавать за проверку нового кода. Чистую standalone npm ci после этих дополнений ещё не повторяли; ценные workcopies не изменены.
