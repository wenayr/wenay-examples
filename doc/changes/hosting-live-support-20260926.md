# Q03 — свежий live Docker сценарий Support

26 сентября 2026, 14:46 UTC. Исходный checkout `codex/library-upgrade-20260926`.
`node scripts/hosting-live-gate.mjs --only=support` завершился с кодом 0 за 33,925 секунды.
Deploy первого образа → update второго → rollback первого прошли с сохранением обращения
и вложения через публичный RPC маршрут. Это один из одиннадцати продуктовых сценариев Q03.

Образы собраны из текущего Support с точными npm зависимостями. Метка dependencies:
`7fbe2f693d957d78b2a44414408a64fa09a7903b31d16a1222a5a1064f14beb8`.

| Образ | RepoDigest |
| --- | --- |
| support:first | `wenay-examples.local/support@sha256:f3da7bd5af213f99cd4879e359862c2a39ffe378bc8c59e6452da53e2cc63a80` |
| support:second | `wenay-examples.local/support@sha256:f9873c486571c3d251be17b9b609cb0613d039461ed55f475fd763adef255650` |

Запуск последовательный, лимит контейнера 256 MiB. Локальный машинный отчёт
`work/hosting-live/report.json` и лог `work/hosting-live/support.log` сохраняют детали запуска.
Полный gate раньше завершился как INCOMPLETE: у прежних образов отсутствовали актуальные
dependency labels. Остальные десять сценариев требуют свежих образов и повторной проверки.
Удалённый сервер, TLS, домен, HA и установленный клиент этим запуском не приняты.
