# Documents: дополнения D02/D05/D06/D07

10 сентября 2026. Критерии исходного SAAS-EXAMPLES-BACKLOG сверены отдельно, удалённый пул исполнителей не добавлялся.

- D02: session-owned upload token, отдельная отмена до metadata commit, общий blob cleanup и корректные ответы cancelled/committing/completed. Прежняя программа upload без token совместима. UI показывает отмену и не обещает удалить уже сохранённый файл.
- D05: заменяемый ExtractionProvider принимает sourceVersion/bytes/signal; возвращает таблицу и источник каждого поля. Контроль полноты и координат, authority attempt/sourceVersion guard, immutable provenance в approval и JSON. Default TXT key:value fixture явно тестовый, не OCR/LLM. Отдельный fake PDF-provider доказывает заменяемость порта без платных запросов.
- D06: compare API проверяет ACL/currentrevision, отдаёт current и selected approved; UI две колонки с подсветкой изменений. Изменение текущей таблицы не меняет утверждённую и её provenance.
- D07: два настоящих child process Node PDF и Python CSV одновременно живы, оба документа processing. Test-only ProcessResource factory задерживает доставку вычисленных результатов. Cancel Node завершает только его PID, Python продолжает и принимает строку `Independent Python,42`; поздний Node результат не принимается. Оба child закрыты. Это локальная независимость, не удалённое распределение работ.

Проверено: `npm run typecheck`, `npm run build`; полный `npm test` с DOCUMENT_PYTHON из bundled runtime; `node --import tsx backend/advanced-check.ts` — PASS. Основной набор подтверждает CSV/TXT/PDF/Python, повреждённые/пустые/защищённые PDF, лимиты/cleanup, роли, cancel/late/timeout и authority+2serving/restart. Advanced проверяет token isolation, отмену до commit и честный completed, immutable compare/fresh ACL, происхождение полей и реальные независимые children. Временные каталоги тестов удалены только в собственном mkdtemp; чужие workcopies не менялись.

Тестовая замена OCR не доказывает качество распознавания сканов; это отдельный внешний acceptance после выбора провайдера. Визуальная browser-проверка новых элементов и новая Docker-приёмка данным отчётом пока не заявлены. Существующие Docker digest в README относятся к предыдущему варианту. Production сборка имеет прежние Vite предупреждения о конфигурации/размере chunk, без ошибок.

Публичные common2 mechanisms остаются основой: createLocalBlobStorage, createAsyncQueue, createAiRunHost, createProcessResource, schemaCommand/Store/resources/receipts/serving; React-композиция использует react2. Нового подтверждённого дефекта библиотеки не обнаружено. Commit boundary загрузки, происхождение полей и сравнение утверждений — предметные обязанности приложения.

## P01: продуктовая поверхность

Добавлены product-http.ts/http-auth.ts/product-check.ts; server монтирует четыре HTTP метода upload/start/status/result через public common2 HTTP facade/OpenAPI. Единственный DOCUMENT_PRODUCT_INPUTS задаёт validator и документацию. Identity authority получает account из Bearer service token, не изargs. Методы напрямую используют тот же processing resource; отдельные approve/delete/member методы не публикуются. Result ограничен текущими table/provenance, fresh ACL/revision; schema/OpenAPI не содержат admin commands.

Реальный product-check PASS: login, отказ без сессии401, подмена args400, отклонение лишних полей, canonical Base64/512KiB, запрет чужой организации, настоящая CSV-обработка, дедупликация файла, устойчивый AI requestId, stale revision, live revoke. Typecheck/build после окончательных дополнений PASS. Документация содержит короткий Node-клиент с токеном из окружения. Это service session, не scoped Metering API key; дополнительные HTTP routes доступны только на authority, а SC1 работает через serving как раньше.

Docs scaffold manifest дополнен всеми новыми backend/frontend файлами, общий scaffold-check семи приложений PASS на момент изменения. Чистая новая npmci копия после этих дополнений не выполнялась. Возможное уменьшение повторения: короткий authenticatedArgs одинаковой роли теперь нужен Support и Documents; это прикладная адаптация authority identity, её можно синхронизировать копируемым файлом. Библиотека уже предоставляет HTTP/OpenAPI/schema и не требует нового протокола.
