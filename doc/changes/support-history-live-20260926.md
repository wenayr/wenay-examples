# Q08 Support: свежие images после изменения истории

26 сентября 2026, managed INTEGRATION, source HEAD14d0276. Support source соответствует
перенесённому 53f5224; typecheck/test/build в post-transfer run18952 PASS0.8/34.4/1.7s.
Сам общий run18952 завершился exit1 на недостающем Chat scaffold metadata, исправленном отдельно.

Root пересобрал only Support first/second через prepare-live-images и inspected RepoDigests.
Затем hosting-live-gate --only=support с этим manifest: complete=true/code0,
2026-09-26T19:44:34.530Z, PASS36.666s. Deployment first/second/rollback сохранили
stable route, RPC session, durable ticket и attachment; product limit256MiB.

- First: `wenay-examples.local/support@sha256:12298b176c4b127bcefd6c8e4711ca6f8639a088d57f73f8fd504aa4a642a728`.
- Second: `wenay-examples.local/support@sha256:30e5fa9d7643364d5fa8d1b534a7e046d2e1d76058b8d8e0a95079d71b5b00ec`.
- Support package+lock fingerprint: `7fbe2f693d957d78b2a44414408a64fa09a7903b31d16a1222a5a1064f14beb8`.
- Hosting package+lock fingerprint: `9f8e0dc7498f490528a43a7c0ad5831222dc9d9b1f9bfd64cc667b6a65da2d01`.

Этот повтор покрывает новые Support assets; прежний [all11 report](examples-integration-live-20260926.md)
остаётся отдельным baseline e4944c3 с прежними images. External HTTPS/bootstrap и peak memory
не проверялись. Новый raw check:all95073 после исправления scaffold завершился
PASS EXIT0:38actual checks, scaffold10/sync101/15/style494/0/links814/0;
[отдельный итог](examples-post-transfer-gate-20260926.md).
