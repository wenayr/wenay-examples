# Q11-B: bounded Ubuntu Linux runtime fixture

26 сентября 2026, ORIGINAL. Actual root repeat session25390 **EXIT0** после узкого
TMPDIR fix; первый session63344 завершился EXIT1. Это public-runtime proof после принятого Windows
source/assets artifact, не SSH/systemd/TLS/clean-server installation acceptance.
Ownership: новый scripts/hosting-linux-runtime-check.mjs, этот report и own progress.
Existing artifact verifier/apps/package/agent/plans не менялись.

## Exact Linux profile и read-only pinning

Ubuntu24.04 LTS linux/amd64 + glibc2.39 + Node24.18.0. Runtime OS не Debian/Alpine.
Официальный Node Bookworm image используется только как donor `/usr/local` toolchain,
который подключается readonly к настоящему Ubuntu container. Agent/socket не добавлены.
Два официальных child platform manifest pins получены read-only через Docker Hub registry:

- Ubuntu24.04 amd64: `ubuntu:24.04@sha256:496754492fb28b4d3049432f2ca787449331e23fb14f0dd3fffea86bf5a93eb4`.
  Index digest `sha256:008173c23f95b170204355c12626cb5a965d779a7e1283b09e9cffbb1bf33ca3`.
- Node24.18.0 Bookworm slim amd64 donor:
  `node:24.18.0-bookworm-slim@sha256:d45d78e7929b46875bbd4e29bea672d5bc48186c6c3588306521c815e78352d6`.
  Index digest `sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d`;
  actual registry config подтверждает linux/amd64 и NODE_VERSION=24.18.0.

[Ubuntu official image](https://hub.docker.com/_/ubuntu/) и
[Node official image project](https://github.com/nodejs/docker-node) — источники provenance.
[Node24.18.0 official release](https://nodejs.org/ko/blog/release/v24.18.0) содержит Linux x64
binary. Tag сам по себе mutable; driver использует конкретный amd64 child digest,
проверяет local image platform/RepoDigest/ImageID после pull/cache lookup.
Registry pinning не означает, что Node toolchain уже запущен на Ubuntu.

## Verified input и fixture границы

Root выбирает только собственный Hosting artifact из work/hosting-installation с external
known SHA256. Сначала existing verifyInstallation проверяет archive SHA/target/file set/
inner bytes. Перед extraction driver ещё раз читает bytes, сверяет external SHA, сохраняет
own immutable snapshot и вызывает тот же verifier; tar extraction только checked own
snapshot в новый owned .test-data payload. Исходный artifact не изменяется, user archives
и host данные не используются. Digest не берётся из недоверенного manifest.
На новой filesystem-extraction границе дополнительно проверяются canonical POSIX names:
normalize(name)==name, нет dot/empty/backslash/duplicate alias paths. Это guard driver,
existing stdout-only verifier не расширяется и остаётся frozen.

Donor container не стартует. Native Docker volume creation/copy populates `/usr/local`
из pinned donor image; отдельный Ubuntu container использует этот owned readonly volume
с volume-nocopy. Это публичная Docker boundary, не собственный image builder/installer.
Наличие Node binary/npm и совместимость glibc подтверждает только actual run; если native
volume population не сработает, fixture обязан FAIL, не менять target на Debian/Alpine.

Runtime container: память768MiB/swap768MiB, CPU1, PID128, user1000:1000, cap-dropALL,
no-new-privileges, readonly root, own executable tmpfs512MiB и readonly fixture bind.
Нет published ports, host socket, agent или privileged mode. Npm использует сеть только
для actual dependency installation, cache/node_modules/config/data — собственный tmpfs.
Native npmci timeout180s, probe40s, Docker run240s. Контейнеры/volume имеют unique names
и exact owned label; finally inspect label before rm, только свои ресурсы/каталог удаляются.
Pinned image cache не удаляется; prune отсутствует. Cleanup failures видимы, не скрываются.

## Что runnable driver должен доказать

До npm: actual /etc/os-release Ubuntu24.04, process linux/x64/v24.18.0 и glibc2.39.
Затем настоящий `npm ci --include=dev --no-audit --no-fund` внутри Ubuntu по verified lock,
без Windows node_modules. Каждый direct dependency version сверяется с manifest;
tsx4.23.1 dev dependency включена явно.

Authority backend/server.ts стартует с synthetic AccountConfig и random fixture secrets
через обычный `node --import tsx`; protected JSON mode0600 и data directory mode0700.
Descriptor /api/client и native createServiceClient credentials login + identity.me
проверяются реально. CreateProject/repeat идут по public native RPC receipts, dashboard
имеет один project. Fresh artifact static index/JS отвечают через обычный authority HTTP.
Node client закрывается и child server получает SIGTERM/ожидается exit; при отказе bounded
SIGKILL остаётся fixture cleanup. Секреты не печатаются и не включены в artifact/command line.

## Exact root commands после свободного heavy slot

Лёгкий plan проверяет artifact, но не обращается к Docker:

```powershell
node scripts/hosting-linux-runtime-check.mjs --artifact=work/hosting-installation/hosting-2163a0f.tar.gz --sha256=2db1137cbb77ca2819ac07a9629cb548587c842d988f29be8dffae901b9ae0a7
```

Actual sequential fixture, выполненный root:

```powershell
node scripts/hosting-linux-runtime-check.mjs --run --artifact=work/hosting-installation/hosting-2163a0f.tar.gz --sha256=2db1137cbb77ca2819ac07a9629cb548587c842d988f29be8dffae901b9ae0a7
```

Подготовка не засчитывает эти outcomes. Даже actual PASS принимает лишь isolated Linux
dependency/runtime/authority public API; clean host install, SSH host-key, systemd service
restart, ownership/permissions на реальном OS, agent/Engine socket, HTTPS/DNS/WS/update/
rollback и final public URL требуют своих последующих проверок. InstalledRuntime flag
artifact остаётся false. Этот fixture не устанавливает OS/Node/Docker на host, не
меняет system services, не публикует сайт и не закрывает Q11-P/Q11-B целиком.

Lightweight preparation actual PASS: `node --check`, style1file/0, artifact-only plan
без Docker (external known SHA/target и source2163a0f подтверждены). Pure canonical path
guards PASS: dot/empty/traversal/absolute/backslash/duplicate rejected. Registry HTTP
metadata прочитаны, token не сохранён/не напечатан.

Первый actual root run, session63344, EXIT1: pinned images проверены, Ubuntu runtime
и настоящий Linux npm ci завершились успешно. Authority startup остановился на
tsx ENOENT mkdir /tmp/tsx-1000: readonly root не предоставляет writable /tmp.
Fixture исправлен узко: дочерние npm/probe процессы получают TMPDIR=/run-fixture,
который наследуется authority child и направляет native tsx temporary cache в собственный
writable tmpfs. Root filesystem остаётся readonly; новые mounts/права/root bypass
не добавлены. Первый EXIT1 сохраняется как failure evidence.

Повторный actual root run session25390 **EXIT0**: actual Ubuntu24.04/x64/Nodev24.18.0/
glibc2.39, настоящий npm ci установил 142 packages за 7s. Authority descriptor,
native authenticated RPC, createProject receipt repeat, dashboard и static assets PASS.
Root отдельно проверил cleanup: owned label containers/volumes отсутствуют, собственных
linux-runtime directories не осталось. Это принимает ограниченный Linux runtime subset;
SSH/systemd/HTTPS/bootstrap/clean-server installation и Q11 целиком не приняты.
