# C07 / Q10: явная граница самостоятельной копии Chat

После переноса C07 post-transfer raw check:all18952 выполнил все 38 app checks,
но завершился exit1 на scaffold manifest: desktop/README.md не был описан.
Этот failed raw результат не считается общим PASS.

Текущий Chat scaffold создаёт самостоятельный web runtime. Для всех четырнадцати
desktop файлов добавлены отдельные skip entries с причинами: Electron package пока
proposal, установленный клиент и его доставка проходят отдельную C07 приёмку.
Файлы не пропадают молча, и standalone web copy не получает неактивный native пакет.
Generator и проверки не ослаблены; frontend/backend/runtime/package/lock не менялись.

Повтор npm run check:repo PASS exit0, 7.176 s: scaffold10, sync101/15,
style494/0, links813/0. До main всё равно нужен новый завершённый raw check:all
на исправленном состоянии. Предварительная проверка manifest coverage новых файлов
теперь выполняется до тяжёлого прогона приложений.
