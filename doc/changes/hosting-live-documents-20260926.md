# Q03: live Docker Documents и совокупное покрытие 11 режимов

26 сентября 2026, ORIGINAL. Read-only сверены фактические `work/hosting-live/report.json`,
`work/hosting-live/documents.log`, `work/hosting-live-images/product-images.json`, текущие
runner и Documents live assertions. Docker, build, tests и сервер повторно не запускались.

## Фактический Documents результат

Report **2026-09-26T18:47:17.128Z**, complete=true, code=0, selected ровно `documents`.
Единственная row: script `test:documents`, status=pass, code=0, reason пуст,
duration **45.014 seconds**. Log содержит три PASS: deploy first → deploy second → rollback first.
Root использовал настоящий локальный Linux Docker, ранее подтверждённый daemon 29.7.2.

На first сценарий выполняет настоящий Node CSV, Python CSV внутри image и текстовый PDF;
проверяющий сверяет таблицы и утверждает результаты. На update/rollback остаются исходные
native customer/reviewer sessions, ожидаются reconnect и новая generation processor resource.
Проверяются все сохранённые approved documents, JSON exports и byte-for-byte оригиналы.
Stable advertised gateway и health expected release проверяются существующим live harness.
Данные переживают first→second→first на собственном долговечном Docker томе.

Container limit 256 MiB. Log memory observations: Node CSV 57.71 MiB,
Python CSV 58.27 MiB, PDF 58.01 MiB, deploy-first 57.78 MiB,
deploy-second 56.82 MiB, rollback 56.91 MiB. Это наблюдения контейнера,
а не замер общего пика памяти машины.

## Images и dependency evidence

Runner перед сценарием читает actual Docker image inspect: RepoDigest, image ID и
`org.wenay.examples.dependencies`. Report содержит оба результата inspect; own prepared
manifest содержит ровно те же два immutable digest references. Сырых отдельных inspect JSON
в текущем work каталоге нет: evidence ниже сохранено в report, новый inspect не выполнялся.

| Release | Immutable RepoDigest и observed image ID |
| --- | --- |
| first | wenay-examples.local/documents@sha256:de2ac5336dea92df527a230a7bdf9fca99a3655f681f49730038cccdf34cf259 |
| second | wenay-examples.local/documents@sha256:d6bdd286438c794ec20c6befeba89308a59d9f4c1a1a4436d3c87f8c3861612f |

Observed ID каждой image в этом store равен соответствующему `sha256:<hash>`;
это факт этих inspect, не правило заменять manifest digest произвольным config ID.
Report fingerprints:

- Hosting package+lock: `9f8e0dc7498f490528a43a7c0ad5831222dc9d9b1f9bfd64cc667b6a65da2d01`.
- Documents package+lock и labels обеих images: `8e00cc190d487d61fde40e6155dd0ea3026c858a924b4caa84b7cb3fd3b92e4b`.

Labels проверяют dependency fingerprint, не source tree. Последующие source изменения без
изменения package/lock всё равно требуют fresh build/images и новой приёмки. First/second —
release варианты текущего исходника, не восстановление старого source/archive и не Q02 migration.

## Покрытие трёх отдельных запусков

| Сохранённый selected run | At UTC | Product modes | Result |
| --- | --- | --- | --- |
| [selected три](hosting-live-selected-20260926.md) | 18:31:07.455 | Organizer, Pizzeria, Support | 3/3 PASS |
| [следующие семь](hosting-live-seven-20260926.md) | 18:41:50.371 | Metering, CRM, Booking, Forms, Monitoring, Approvals, Content | 7/7 PASS |
| Documents, этот отчёт | 18:47:17.128 | Documents | 1/1 PASS |

Совокупно **11/11 локальных продуктовых режимов** имеют сохранённый live deploy/update/rollback
результат в трёх отдельных прогонах. Историческое «Documents pending» в seven report описывает
состояние до последнего запуска; этот отчёт дополняет его, не переписывая прошлый evidence.
Текущий work/report.json содержит только Documents, не объединённый JSON на 11 продуктов.
Это не общий current merged gate и не PASS будущей интеграции G01→COPT: изменившиеся продукты
после объединения веток требуют новых outputs/images и проверок итогового состояния.
Optional generic runtime Node→Python→Node не добавлялся к этим продуктовым прогонам.

## Границы приёмки

Внешний HTTPS, TLS, DNS, reverse proxy, удалённый сервер и clean-server bootstrap **не приняты**.
Q11 publicOrigin configuration и его browser ACL/retry evidence — отдельный срез.
Этот human Documents live harness не вызывает machine productDocuments upload/start/status/result,
не принимает owner keys UI, key expiry/revoke или Q06 metering integration. Их отдельные backend,
browser и composition проверки нельзя заменить этим Docker PASS.

Harness имеет finally cleanup собственных resources/sessions/agent/host, deployments,
run-owned volume и проверенного временного directory. Log/report подтверждают нормальный exit0;
новый независимый Docker inventory audit cleanup здесь не выполнялся.

Для повторения после fresh frontend build и preparation:

```text
node scripts/prepare-live-images.mjs --only=documents
node scripts/hosting-live-gate.mjs --only=documents --images=work/hosting-live-images/product-images.json
```

Commit scope этого этапа — только данный durable report. Generated work JSON/log/manifest,
build outputs, UI/scaffold/план/STATUS и соседние Q05/Q06 изменения сюда не входят.
