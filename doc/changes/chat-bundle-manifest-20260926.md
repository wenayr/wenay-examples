# Q08 Chat: manifest после интеграции

В интеграционной ветке `codex/examples-integration-20260926` сохранены принятые
G01–G04, C01, C03 и C-OPT-CHAT поверх актуального ORIGINAL `58d0aeb`.
Chat использует ту же Vite build.manifest опцию, что остальные UI: полный граф
его динамического native client теперь можно измерять без смешения начальной
загрузки и всех артефактов.

Root после изменения выполнил targeted runner для Pizzeria/Booking/Chat:
9/9 PASS, exit 0. Chat typecheck 0.7 с, test 7.7 с, build 1.1 с;
Pizzeria 0.9/78.4/2.2 с, Booking 0.7/24.2/1.2 с.
Catalog build отсутствует по контракту. Это не общий fresh gate интеграции:
он выполняется после включения принятого Documents Q06-B.

Независимый source audit подтверждает сохранность Support Q04, Documents Q05,
Q01 lazy boundaries и текущего canonical Metering; sync: 101 копия / 15 канонов.
Текстовые конфликты разрешены сохранением обеих root check цепочек и генерацией
STATUS из фактов нового checkout. Старые PASS из GRAPH не копировались.

Installed desktop/mobile и внешний HTTPS этим этапом не принимаются.
