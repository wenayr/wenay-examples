# Q08: размеры начальной загрузки и полного графа сборки

26 сентября 2026, исходная ветка `codex/library-upgrade-20260926`.

Двенадцать Vite конфигураций теперь создают manifest. STATUS считает отдельно
начальную загрузку и полный достижимый граф JS/CSS: статические и динамические
импорты, общие chunks и CSS без повторного сложения. Неиспользуемые файлы прежних
сборок не включаются. Без manifest полный размер неизвестен; отсутствующий
объявленный файл или выход пути за каталог сборки считается ошибкой.

Это учёт артефактов, не измерение скорости сети, памяти или свежести исходников.
Manifest и package/lock fingerprint сами по себе не доказывают новую сборку.

## Свежая проверка

Root выполнил последовательно `node scripts/run-all.mjs build`: все 11 приложений
со сборкой PASS, exit 0; Catalog не имеет build по контракту. Затем `npm run status`,
`npm run check:repo` и `npm run status:bundles` завершились exit 0.
Scaffold: 9; sync: 100 копий / 15 канонических файлов; style: 464 файла / 0;
links: 788 / 0. Умышленный failure/skip в regression runner — тестовые сценарии,
не ошибки приложений. Старые typecheck/test строки STATUS не являются новой
приёмкой всех изменённых исходников: общий gate объединённой ветки выполняется отдельно.

| UI | Начальный JS/CSS, КиБ | Полный JS/CSS, КиБ |
| --- | ---: | ---: |
| Pizzeria | 468.2 | 664.3 |
| Organizer | 613.4 | 613.4 |
| Hosting | 435.3 | 435.3 |
| Support | 638.7 | 638.7 |
| Documents | 589.9 | 589.9 |
| Metering | 480.4 | 1436.3 |
| CRM | 620.6 | 1572.2 |
| Booking | 737.8 | 737.8 |
| Forms | 601.9 | 601.9 |
| Monitoring | 586.7 | 586.7 |
| Content | 599.7 | 599.7 |
| Approvals | 439.3 | 439.3 |

Независимый source review и bundle regression PASS. Проверены dynamic/static,
CSS, cycles, dedup, два UI roots, stale assets, missing manifest/assets/chunks
и lexical path escape. Symlink/junction containment и расширенные HTML patterns
в этой проверке не приняты; штатный текущий Vite output поддерживается.

Этот этап не закрывает пользовательские сценарии Q08 и не включает ещё
неперенесённый Chat. После интеграции Chat нужен manifest и свежая общая сборка.
