# Серверное размещение Wenay Travel

Существующий проект Sites — `appgprj_6af8e65d9568819194917d5506e60187`. Его адрес — https://wenay-travel-live.wenayr.chatgpt.site, аудитория owner-private. При продолжении используйте этот проект и его источник; новый Site не требуется. Первая публикация подтверждена 15 ноября 2026 года штатным Sites deploy workflow.

GitHub-источник — `wenayr/wenay-examples`, ветка `demo/travel-flexible-dates`, приложение `apps/travel`. Site source checkout — `/workspace/sites/wenay-travel-live`. Файл `.openai/hosting.json` хранит project ID и сохраняется при обновлении. Учётные данные передаются source helper через stdin; значения секретов в исходники не входят.

## Воспроизводимая сборка

Из корня GitHub checkout подготовьте самостоятельный Site source:

```bash
node apps/travel/scripts/prepare-site.mjs --destination /workspace/sites/wenay-travel-live
```

Скрипт копирует исходники только Travel, его точные package/lock, изображения, документацию и проверки. Node modules, локальные базы, runtime-данные и файлы окружения не копируются. Manifest и существующие правила игнорирования сохраняются. В Site checkout:

```bash
npm ci
npm run build
```

В исходном приложении та же сборка доступна как `npm run build:hosted`. Она создаёт Vite frontend в `dist/client` и самодостаточный Worker ESM в `dist/server/index.js` с default `{fetch}`. Все созданные frontend-файлы включаются в Worker, поэтому runtime не обращается к файловой системе и не зависит от внешнего checkout или node_modules. Размеры записываются в `dist/hosted-build.json`. Декодированный статический кэш ограничен 4 MiB.

Для managed preview используйте штатные `sites-preview start`, `status`, `stop` с этим Site checkout. `scripts.dev` запускает адаптер того же Worker.fetch; он принимает переданные daemon аргументы `--host` и `--port` и не выбирает другой порт. После изменения Worker bundle запущенный Node preview необходимо перезапустить штатным CLI.

## Реальные операции Worker

Worker обслуживает `/api/travel/health`, `destinations`, `packages`, `package-hotel-search`, `package-calendar`, `package-trends`, `package-matrix`, `package-gallery`, `package-compare`, `package-recheck`. Health перечисляет возможности runtime, а не подтверждает доступность предложений поставщика.

Поиск имени выполняется сервером по индексу текущего окна TEZ. В цене сохраняются его маршрут, ночи, гости, валюта и источник. Пагинация поиска выдаёт ограниченную порцию, не весь каталог. Проверенные метаданные Хургады остаются доступны без тарифа; у такого отеля отсутствует ценовое поле и предлагается проверить матрицу. Это не глобальная гостиничная база и не обещание наличия тура.

Обычный кэш наблюдений действует 120 секунд. Ручной `refresh=1` действительно обходит сырой кэш. `retryAt` обозначает автоматическую паузу между запросами. Если обновление не удалось, прежняя цена сохраняет исходное время и `source.stale=true`; ячейка не считается подтверждённой. Polling интерфейса приостанавливается для неактивной вкладки и закрытого поиска/окна.

Манифесты местоположений и фотографий статически включены в сборку. Web Crypto SHA-256 сохраняет прежние идентификаторы тарифов. Используются опубликованные browser-compatible экспорты `wenay-common2/client`. В Worker нет Node fs, SQLite, raw TCP и динамической генерации кода; дополнительные хранилища не создаются.

Полный прежний Node backend остаётся в репозитории. Операции других модулей, не подключённые к этому Worker, возвращают понятный HTTP 501 с фактическим перечнем возможностей. Цены и успешные ответы для них не имитируются.

## Подтверждённый релиз 15 ноября 2026

- Site source commit: `6b465b6bbae344a72906eed7d288b20466dd4af6`.
- Сохранённая версия: `appgprj_6af8e65d9568819194917d5506e60187~appgver_3a8c6801f334819197175c1339a0fd36`.
- Deployment: `appgdep_6af8efde366c8191acaa788940450aec`, результат `succeeded`.
- Production URL: https://wenay-travel-live.wenayr.chatgpt.site, аудитория owner-private.

Managed-проверка подтвердила поиск, всплывающую матрицу, выбор реального тарифа, ручное обновление времени источника и возвращение на карту с одним экземпляром карточки отеля. Отдельно проверены нативные клавиши изменения даты. Стоимость остаётся наблюдением поставщика, наличие и оформление подтверждает оператор.
