# Forms: публикация, ответы и сохранение версий

26 сентября 2026. Bounded Q08-FORMS browser journey существующего UI в INTEGRATION.
HEAD при завершении `9d47359`; отдельный fresh build/type/test в этом journey не запускался.
Это приёмка конкретного пользовательского пути, не закрытие parent Q08-FORMS.

## Фактический результат

Chrome, только synthetic данные собственного native стенда:

- Owner создал «Обратная связь после встречи», сохранил один короткий обязательный вопрос
  «Что было полезно?». После отмены подтверждения публикации осталась надпись
  «Пока ни одной публикации»; явное подтверждение создало v1.
- Собственная respondent tab открыла v1. Пустая отправка оставила форму открытой;
  DOM native HTML validation: `required=true`, `validity.valueMissing=true`.
  Валидный ответ «Практические примеры» дал «Спасибо, мы вас услышали»/«Ваш ответ сохранён».
  Owner Results показал один ответ v1 с исходным вопросом и значением.
- Owner изменил сохранённый draft на «Что улучшить в следующей встрече?» и явно опубликовал v2.
  Reload старой ссылки v1 показал «Опрос сейчас недоступен» и просьбу получить новую ссылку.
  Новая v2 ссылка показала обновлённый вопрос; ответ «Добавить время для вопросов» сохранён
  с тем же видимым подтверждением.
- Results показал2 ответа/2 версии: прежний v1 вопрос/значение остались прежними,
  новый v2 ответ отображается отдельно. Это видимое сохранение истории в текущем runtime,
  не доказательство persistence после restart или запрета staff edit старого ответа.
- Analyst вошёл отдельно и увидел оба ответа. Кнопки «Исправить ответ», создания нового опроса,
  публикации отсутствуют (locator counts0); результаты доступны. UI evidence не заменяет RPC ACL tests.
- Actual analyst viewport360×640, document.scrollWidth345. Фильтр «Версия1» показал1 ответ,
  исходный вопрос и исходное значение. Это responsive web, не physical/installed mobile;
  owner оставался desktop1528×782. Viewport reset выполнен перед logout/close.
- Console error logs `[]` у owner, v1 respondent, v2 respondent и analyst.

## Снимки

[Owner, две версии](../reports/forms-versions-browser-20260926.png),
[Analyst, фильтр v1 при360px](../reports/forms-analyst-360-browser-20260926.png).
Настоящие screenshots существующего UI, без public link/token в кадре. Desktop snapshot
показывает счётчики/вопросы двух версий; DOM дополнительно подтверждал значения обоих ответов.

## UX-находка и ограничения

Страница старой ссылки содержит полезные заголовок/инструкцию, но alert выводит техническое
`login refused`. Возможный отдельный малый UX slice: понятное русское описание отказа public
ссылки с сохранением существующего server denial и session/resource guards. Source здесь не менялся.
Это не новый security defect и не повод замаскировать другие ошибки произвольной строкой.

Не проверялись export/download, retention/compaction/time boundary, held-response revoke,
reconnect/draft continuity, lost-response exact ticket retry, restart, foreign org RPC,
author role отдельно, clipboard equality или физическое мобильное устройство. AI grouping не запускался.
Нет paid/external provider, внешних сообщений, пользовательских данных или новой инфраструктуры.

## Изоляция и очистка

Existing `node scripts/browser-session.mjs forms`, own PTY52761,
`http://127.0.0.1:50424`, own mkdtemp
`C:/Users/wenay/AppData/Local/Temp/wenay-browser-7dPawu`.
Chrome session «🌸 Forms versions», own tabs1864035248/49/50/51.
Owner и analyst logout подтверждены login screen. Respondent UI не имеет отдельной logout кнопки;
обе собственные public tabs закрыты. Все4 tabs закрыты, viewport reset.
Helper получил `stop`, exit0; actual `OWN_PORT_LISTENERS=0`, `OWN_TEMP_EXISTS=False`.
Source/helper/scaffold/package/планы не изменены, тяжёлые проверки/серверы кроме собственного
малого fixture не запускались. Работа через computer-use skill/browser API.
