# Forms: понятный отказ старой публичной ссылки

26 сентября 2026. Малый frontend copy slice ORIGINAL.

Принятый браузерный journey показал: новая публикация отменяет старую ссылку,
но страница отказа выводит техническое `login refused`. В существующем
`authenticate` только для account respondent и точного server message `login refused`
теперь выдаётся «Ссылка на опрос закрыта, обновлена или недействительна».
Существующая просьба получить новую ссылку остаётся; текст не обещает конкретный expiry reason.

Staff login, остальные server/network/JSON ошибки, session/resource lifecycle,
backend current tokenHash/accessGeneration/version guards остаются прежними.
Никакого нового транспорта, error schema или обхода отказа.

Source freeze: добавлена только одна трёхстрочная ветка перед прежним throw.
Actual ORIGINAL `npm run typecheck` PASS exit0 (1.18s), scoped style1file/0violations PASS.
Independent source review PASS по root; fresh ORIGINAL build f68bde PASS exit0
1.884s (Vite676ms) после завершения raw27106. Старый принятый Forms journey
не подменяет эту отдельную новую проверку.

## Actual fresh browser

Chrome ORIGINAL, существующий generic helper проверен совместимым с native Forms entrypoint
и использован без изменения. Только собственные synthetic данные.
Owner создал короткий draft «Проверка ссылки», явно опубликовал v1, затем v2.
Старая v1 ссылка заново открыта в собственной tab: heading «Опрос сейчас недоступен»,
alert точно «Ссылка на опрос закрыта, обновлена или недействительна», просьба получить новую ссылку;
technical `login refused` в этом respondent UI отсутствует. Server deny сохранён.
Текущая v2 открылась как версия2, приняла «Тестовый ответ новой версии» и показала
«Спасибо, мы вас услышали»/«Ваш ответ сохранён».
Staff owner с неверным synthetic password до успешного входа показал исходный `login refused`;
граница respondent-only подтверждена реальным UI. Console errors[] во всех3 own tabs.

[Реальный screenshot отказа](../reports/forms-public-link-copy-20260926.png): no tokens в кадре.
Это bounded copy acceptance, не parent Q08-FORMS/export/retention/retry/restart/network matrix
и не responsive/mobile test. В этой проверке viewport не менялся.

Own PTY33961, loopback52145, own temp
`C:/Users/wenay/AppData/Local/Temp/wenay-browser-qZlQ6F`, tabs1864035256/57/58.
Owner logout подтверждён login page; все3 собственные tabs закрыты.
Helper stop exit0; actual port listener0/temp existsFalse. Никакого дополнительного source/helper
изменения, native ledger, paid provider/external transmission или тяжёлого запуска агентом.

Перенос ORIGINALabef339→INTEGRATION5616e92: root target56033e **EXIT0**
typecheck0.7s/build1.0s. Последующий repo936304 PASS включает эту copy source;
raw27106 source9d47359 был до неё. Current server/current-version denial не менялся.
