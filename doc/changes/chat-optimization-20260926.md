# C-OPT-CHAT: отложенная загрузка native runtime

26 сентября 2026. Основание: принятый C03 `e97161a`, опубликованные
common2 **3.1.1** / react2 **5.0.0**, без изменения package/lock.
Targeted typecheck/test/build прошли 3/3; browser account/workspace/revoke/regrant и logout прошли.

## Изменение и граница владения

На Login без сохранённого токена раньше статически загружались service client,
socket/RPC/replay и conversation owner. В `frontend/main.tsx` runtime public
`wenay-common2/service/client` теперь импортируется внутри connect при наличии token;
descriptor fetch и import выполняются параллельно. Собственный conversation-owner
импортируется внутри async factory существующего `useOwnedClient` при открытии Workspace.
Типовые импорты остались type-only.

AbortSignal проверяется после await до создания native владельца. Существующие epoch
и mounted проверки token renewal, account/workspace scope, closeScope и закрытие
conversation до service client сохранены. Уже существующий useOwnedClient отвечает
за disposal запоздалого результата. Native transport, replay, receipts, reconnect
и conversation lifecycle adapter продолжают работать через прежние публичные контракты.
Новых transport/ownership wrappers, private imports и manual chunks нет.

## Измеренный бюджет сборки

Root сохранил baseline asset `index-2ib5pTgw.js` из C03 `e97161a` и измерил новый build.
Все значения ниже в байтах. Gzip вычислен Node zlib для каждого JS-файла; это сравнение
артефактов, а не измеренный HTTP transfer. CSS в таблицу JS не включён.

| JS-артефакт | До, raw | До, gzip | После, raw | После, gzip |
| --- | ---: | ---: | ---: | ---: |
| Начальный index (`index-CJS8zQIv.js` после) | 522079 | 162538 | 214594 | 67304 |
| Отложенный rpc-deadline chunk | — | — | 126335 | 40850 |
| Отложенный service client chunk | — | — | 99632 | 30722 |
| Отложенный conversation owner chunk | — | — | 83439 | 26955 |
| Сумма JS | 522079 | 162538 | 524000 | 165831 |

Начальный JS уменьшился на **307485 raw байт (58,9%)** и
**95234 gzip байта (58,6%)**. Полный граф JS после входа вырос на **1921 raw байт**
и **3293 gzip байта**. Сумма gzip — сумма независимо сжатых chunk-файлов.
Результат переносит большую часть кода с первого экрана на authenticated scope;
он не уменьшает суммарный код, необходимый открытой сессии.

Новый HTML ссылается только на initial JS, без статической зависимости от трёх
отложенных chunks. Root browser DOM на cold Login показал initial script и CSS;
modulepreload трёх chunks появился после входа. Это подтверждает отложенную browser
загрузочную границу. Performance API через доступный read-only evaluate недоступен:
фактические network bytes, parse cost и latency первого входа **не измерены**.
DOM preload наблюдение не заменяет сетевую трассировку.

## Цена первого входа и проверки

Новой сессии после входа нужны дополнительные chunk requests и выполнение runtime.
Service import совмещён с descriptor fetch, но количественный эффект этой композиции
на first-auth timing не измерен. С сохранённым token эти chunks нужны сразу;
для cached повторного входа возможна другая стоимость. Улучшение времени интерактивности
или скорости входа этим отчётом не заявляется.

Root final runner: typecheck 0,7 s, test 5,5 s, build 0,7 s, 3/3 PASS.
Browser первый вход, отправка/история двух клиентов, workspace switch, revoke/regrant,
Alice→Bob→logout и восстановление сохранённого токена прошли; console errors `[]`.
При проверке выявлена гонка начального выбора: native view мог стать ready до получения
непустого списка. Инициализация теперь ждёт первое доступное пространство; ручной выбор
ограждён от автоматической замены. Повтор сохранённой сессии Боба открывает Team.
После отзыва уже выбранного пространства автоматический переход в другое не добавлен.
Искусственная задержка chunk и timing первого входа не проверялись.
Последующая приёмка должна учитывать сохранённый token/reload, logout во время loading,
закрытие старой generation, native reconnect и мобильный экран.

## Сохранённые выводы независимого review

Для короткого экрана C03 `.chat-list` прокручивается целиком; прямые дети не сжимаются,
room-buttons использует flex: 1 0 auto. С внешним grid minmax(0, 1fr) это сохраняет
полную высоту раскрытой membership panel и формы. Это отдельное ранее принятое C03
исправление, а не часть измеренного JS delta C-OPT.

Нужные hooks уже импортированы из публичного узкого ESM `wenay-react2/react`, пакет
объявляет sideEffects только для CSS. Переход на internal hooks или собственную async/
ownership обвязку не нужен. Manual vendor chunks и повышение warning threshold сами
по себе не доказывают уменьшение первого экрана. Backend Express/Swagger не импортированы
frontend runtime; удаление их dependencies не является доказанной browser оптимизацией.

Common2 public conversation entry — CommonJS barrel с host и client exports.
Предложение отдельного опубликованного client-only / ESM entry допустимо только после
измеренного module contribution. Текущий отчёт не утверждает величину server-code
удержания и не предлагает private exports или изменение node_modules.

Для дальнейшего измерения нужны свежая сессия без token и пустой cache, JS requests до
Login idle и encoded/decoded bytes; отдельно дополнительные bytes и время от credential
login до ready conversation. Сравнивать исходный и новый build в одинаковых условиях.
Нельзя принимать новую оптимизацию только за уменьшение одного chunk ниже warning limit.
