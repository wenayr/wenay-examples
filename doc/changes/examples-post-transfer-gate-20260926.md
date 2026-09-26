# Объединённые примеры: проверка после переноса

26 сентября 2026, managed INTEGRATION, branch `codex/examples-integration-20260926`.
Root завершил raw `npm run check:all`, session95073: **PASS, EXIT0**.
Проверенное приложение соответствует HEAD14d0276: Support53f5224, Q11archive19f4487,
C07desktopb1ac4f2, Catalogfooterc6390f1 и Chat scaffold boundary14d0276.
Во время запуска менялись только документы; код приложений оставался неизменным.

Выполнены 38 app checks из39 шагов. У Catalog отсутствует build по контракту;
пропусков app checks из-за среды нет. `check:repo` PASS: scaffold10, sync101/15,
style494/0, links814/0. Python для Documents — настоящий Python3.14.7;
Docker использовался штатными Hosting tests. STATUS обновлён штатной командой.
Искусственные fail/skip внутри regression runner проверяют его поведение
и не являются отказом приложений этого gate.

| Приложение | Typecheck, с | Test, с | Build, с |
| --- | --- | --- | --- |
| Pizzeria | 0.9 | 83.2 | 2.5 |
| Hosting | 1.1 | 12.0 | 1.3 |
| Support | 0.8 | 32.1 | 1.6 |
| Documents | 0.7 | 45.0 | 1.6 |
| Metering | 1.0 | 17.8 | 1.5 |
| CRM | 1.0 | 16.9 | 1.1 |
| Booking | 0.7 | 20.9 | 0.9 |
| Forms | 0.7 | 16.1 | 1.0 |
| Monitoring | 0.7 | 35.3 | 0.9 |
| Content | 0.8 | 25.5 | 1.0 |
| Catalog | 0.8 | 0.4 | отсутствует |
| Approvals | 0.7 | 16.8 | 0.9 |
| Chat | 0.7 | 5.5 | 0.9 |

Предшествующий raw session18952 остаётся **EXIT1**: все38 app checks прошли,
но check:repo обнаружил desktop/README.md без правила scaffold.
Исправление14d0276 явно исключает неактивный Electron proposal из web-копии,
не ослабляя generator или проверки. После исправления check:repo отдельно
прошёл EXIT0, затем выполнен новый полный session95073.

Прежний [baseline4956](examples-integration-20260926.md) и
[Docker11](examples-integration-live-20260926.md) относятся к e4944c3.
Новые Support assets отдельно проверены свежими images и
[реальным first/second/rollback](support-history-live-20260926.md).
Q11 Linux runtime и Q10 autonomous copy drivers подготовлены и source-reviewed,
но в момент этого gate ещё не запускались. Внешний HTTPS, установка на сервер,
installed desktop/mobile и Q06 lost-settle этим gate не принимаются.
Main, push и публикация не выполнялись.

## Следующий полный checkpoint392170d

Root raw `npm run check:all`, session53023, **PASS EXIT0** на приложениях и helpers
source392170d: includes Q11 Linux98ce6a3/Q10copy27eb75b/Booking UX5f8a2c1.
38 actual app checks/39 шагов, Catalog build отсутствует по контракту, environment
SKIP нет. Repository: scaffold10/sync101/15/style496/0/links835/0.
Во время запуска изменялись только документы и появился отдельный CRM browser report;
CRM label fix готовился в ORIGINAL и **не входит** в этот gate.
Q06 native proof также находится отдельно в ORIGINAL и не входит в raw53023.
Generated STATUS обновлён штатной командой. Actual app timings:

| Приложение | Typecheck, с | Test, с | Build, с |
| --- | --- | --- | --- |
| Pizzeria | 0.9 | 73.7 | 2.8 |
| Hosting | 1.2 | 14.1 | 1.3 |
| Support | 0.8 | 33.2 | 1.7 |
| Documents | 0.8 | 45.3 | 1.6 |
| Metering | 1.0 | 17.5 | 1.4 |
| CRM | 0.9 | 16.0 | 1.5 |
| Booking | 0.7 | 22.6 | 1.4 |
| Forms | 0.7 | 17.8 | 1.5 |
| Monitoring | 0.7 | 36.8 | 1.9 |
| Content | 0.9 | 27.5 | 1.8 |
| Catalog | 1.1 | 0.5 | отсутствует |
| Approvals | 0.9 | 20.4 | 1.6 |
| Chat | 0.8 | 8.1 | 1.5 |

Native Linux/Q10 fixture outcomes и Support/Booking fresh Docker сохраняют отдельные
reports; raw check:all не запускает их вместо требуемого реального сценария.
Более ранние raw4956/95073 и failed18952 остаются собственными checkpoint,
а не переименовываются в этот PASS. Main/push/внешняя установка не выполнялись.
