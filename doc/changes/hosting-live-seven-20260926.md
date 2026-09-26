# Q03: свежая live Docker приёмка семи продуктов

26 сентября 2026, ORIGINAL. Root выполнил настоящий Docker live gate для
Metering, CRM, Booking, Forms, Monitoring, Approvals и Content.
`work/hosting-live/report.json`: at **2026-09-26T18:41:50.371Z**,
complete=true, code=0, ровно семь selected rows; у каждой status=pass,
code=0 и пустой reason. Reviewer прочитал report, семь logs и image manifest;
Docker, builds и tests повторно не запускал, исходники не менял.

## Результаты

| Product | Existing Hosting script | Seconds | Результат logs |
| --- | --- | ---: | --- |
| metering | test:metering | 36.109 | first → second → rollback; stable route, session reconnect, persistent key/ledger |
| crm | test:crm | 34.578 | first → second → rollback; stable gateway, durable product state |
| booking | test:booking | 36.420 | first → second → rollback; stable gateway, durable product state |
| forms | test:forms | 39.008 | first → second → rollback; stable gateway, durable product state |
| monitoring | test:monitoring | 32.715 | first → second → rollback; stable gateway, durable product state |
| approvals | test:approvals | 28.468 | first → second → rollback; stable gateway, durable product state |
| content | test:content | 36.053 | first → second → rollback; stable gateway, durable product state |

Logs: `work/hosting-live/{metering,crm,booking,forms,monitoring,approvals,content}.log`.
Все 21 stages содержат PASS. Container memory limit — 256 MiB;
наблюдаемые значения в этих logs от 52.72 до 60.99 MiB.
Это отдельные container observations, не measurement общего пика памяти машины.
First/second — release variants свежего исходника, а не historical archive migration.

## Подготовка и provenance

Root подтвердил, что непосредственно перед Docker preparation выполнил свежий
`run-all build --only=<семь выбранных приложений>` для всех семи frontend outputs.
Затем `scripts/prepare-live-images.mjs` последовательно собрал first и second
из существующих Dockerfiles с exact pinned bases и собственными tags
`wenay-examples.local/<product>:{first,second}`.
Настоящий Docker daemon 29.7.2 уже подтверждён root в этом сеансе.

Helper проверяет actual RepoDigest, image ID и
`org.wenay.examples.dependencies`, повторно inspect digest и только после успешной
проверки пишет отдельный atomic own manifest. Прочитанный
`work/hosting-live-images/product-images.json` содержит ровно эти 14 digest references;
каждый совпадает с соответствующей записью report. Report фиксирует matching dependency
labels для обеих images каждого приложения.

Hosting package+lock fingerprint во всех rows:
`9f8e0dc7498f490528a43a7c0ad5831222dc9d9b1f9bfd64cc667b6a65da2d01`.

| Application | Verified dependency label, first и second |
| --- | --- |
| metering | bc75ac5f44a82a977a2eb1a7241d8b76da5f497f2e29c03e49b3eb11f7785ab6 |
| crm | e886c3b5e6adc3ff549660ca9373a612099535c5d23d16d7c2a227fa4732501f |
| booking | a5da7988315aefa8d353d7b29ca750e6c44e2cb78defd2f5af022e8bfaa02b2d |
| forms | 929acc99adcbb4da43f2d17a8b1f26dc6f9303568881d6e5ad5c81fb83f3142e |
| monitoring | 9a3dd6d17932fc09cd17e69899c5354fffaf6fb541c89d286f7c551132b90aa9 |
| approvals | 6d6568008cc9d826b67ad6d92becbaf8da25dd0114d1eee72c9ee34ee368aaff |
| content | 2d5dc27fbc6239fd6dab9cc14741b875a8a7b632dc769a72e7a6cc34e28accc9 |

Package+lock fingerprint доказывает соответствие dependency metadata.
Он не является hash исходников или frontend artifacts. Свежесть source в этом результате
подкреплена отдельным подтверждением root о реальных frontend builds непосредственно
перед preparation. После source changes без смены dependencies images всё равно надо
пересобрать; совпадения labels недостаточно.

## Сохранённые immutable images

В таблице ниже полный digest имеет форму `wenay-examples.local/<product>@sha256:<hash>`.
В этом Docker image store report image ID каждой image равен `sha256:<hash>`;
это фактический результат inspect, а не правило подмены RepoDigest config ID.

| Product/release | SHA-256 immutable reference |
| --- | --- |
| metering-first | a22f9abb02d854d4551d8138e45bc823cb12de3b516d61c9258d48774d64bbda |
| metering-second | 5ac2c1e7abad10c846c0a1cc69918925290cd47f470540197cde8f984774cfc1 |
| crm-first | f7cecc727e74372c8a97d57661c03056aa4affea40a1d081d83160c75399bd19 |
| crm-second | 5e127e1225a3da42c256a89501c0ebb3944cdee7185b3acd077cda228a37a4d4 |
| booking-first | e3ab053299f6529ec34d14e8b15d2f81a0f2ffc5b821542bcf999eba54e4d07c |
| booking-second | 6635f2a200fca76da421efc10f020035ee0de04b00b9267d289c889538d84a7e |
| forms-first | c5cccd1e84db7abb472fe547493680b5fa4488846388e73430d03fad96ea0871 |
| forms-second | 30458438d6fea8e6fa131a318c165049ba8bc14a48ae3bf02879abfc43860133 |
| monitoring-first | 6128a164df752a4b6fb9e1122bcc7d59fc252ed6626697f256b3c43bc06cf770 |
| monitoring-second | e3117beb32ff68f84c014be589aac508a5f2364b1064a96785bc829a55b5d709 |
| approvals-first | 17c310b7226841dba313d9376008a9c3cb2dc1b3c2956a7a82b6b9c4f6e338a9 |
| approvals-second | 14359d45a0d2161c47375fdce97ac215278ec6793f2e340781373805c898a7e5 |
| content-first | 8b34cb75849724c04c5e05edb1a959fed20ed3e59f6e010ae01b5967c9685117 |
| content-second | c774c81a2585ff2cf3594e42661b6c25ad83bd778f706ad2ee3bebb967453c90 |

## Совокупный статус и границы

Этот отчёт вместе с неизменённым
[selected3 evidence](hosting-live-selected-20260926.md) подтверждает **10/11** свежих
product selections: Organizer, Pizzeria, Support и семь продуктов выше.
**Documents остаётся pending** после Q05 machine/source изменений; ни этот запуск,
ни исправленный Hosting processor type alias не принимают его Docker live scenario.
Полный Q03 ещё не объявляется завершённым. Optional generic Node→Python→Node runtime
этими product selections также не принят.

Root отдельно подтвердил финальные Hosting typecheck/test/build после dependency изменений:
3/3 PASS, округлённые durations 0.9/10.8/0.7 seconds. Это отдельный Q11 результат;
он не добавляет product row к этому report и не доказывает внешний TLS/DNS/proxy.
Q05 cross-app type narrowing в documents-live-check.ts остаётся частью Q05 integration.
Q02 historical archive, Q08 budgets и browser acceptance относятся к собственным этапам.

Этот durable файл входит в Q03 evidence scope вместе с существующим runner/helper
и предыдущим selected3 report. Generated work reports/logs/manifest и build outputs
не входят в source commit. Q11 publicOrigin и Q05 Documents changes сохраняются отдельно.
