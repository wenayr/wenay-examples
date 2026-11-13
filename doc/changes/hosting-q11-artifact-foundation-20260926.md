# Q11-B: Hosting source/assets installation artifact foundation

26 сентября 2026, ORIGINAL. Это упаковка и проверка входа установки, не установленный
Linux runtime и не приёмка Q11 целиком. Apps/agent/backend/package/plans не меняются.

## Явный candidate profile

Ubuntu Server 24.04 LTS amd64, Node major 24, glibc Linux и local Docker Engine Unix socket.
Docker официально перечисляет Ubuntu Noble 24.04 и amd64 в поддерживаемой матрице:
[Docker Engine Ubuntu requirements](https://docs.docker.com/engine/install/ubuntu/).
Node 24 Linux x64 prebuilt binaries используют glibc 2.28+:
[Node 24 migration/platform notes](https://nodejs.org/en/blog/migrations/v22-to-v24).
Это обоснованный target candidate, не actual clean-server/profile PASS.
OS/Node/Engine installation и systemd/SSH/TLS/firewall provisioning не выполнялись.

Текущий Hosting использует публичные runLeaderProcess/createHostingRuntime authority
и startDockerAgent с createResourceScope/createReconciler/createServiceClient. Новый
runtime/transport не нужен. Authority читает отдельный HOSTING_ACCOUNTS_FILE и token
secrets; agent использует HOSTING_URL/AGENT credentials/data и local Docker socket.
Artifact не содержит эти значения. Наличие Dockerfiles product examples не создаёт
Hosting Linux installer; app-level Hosting Dockerfile отсутствует.

## Маленький CLI контракт

scripts/hosting-installation.mjs имеет pack и отдельный verify. Pack требует clean tracked
Hosting source, берёт exact git HEAD bytes, package/lock/tsconfig, tracked frontend source,
транзитивный backend import graph двух entrypoints server.ts/agent-main.ts и public assets.
Tests/live scenarios, secrets, data/work/node_modules, untracked source не копируются.
Из public экспортируются только index/manifest и явно referenced Vite assets;
старые unreferenced hashed chunks и посторонние файлы не попадают в архив.
Local import вне backend или untracked import запрещён. Этот target экспортирует Docker
agent, не LXD profile. Остальные package scripts/checks не обещаны runtime bundle.

Default pack выполняет fresh Vite build exact committed source в собственном staging.
--reuse-public явно допускает уже подготовленные ORIGINAL assets и записывает
freshnessVerifiedByPackager:false; их свежесть не выдаётся за самостоятельно доказанную.
Root сообщил actual ORIGINAL Hosting build PASS 1.4s до 661a870 и отсутствие последующих
Hosting frontend/backend/package/lock изменений. Именно эти assets разрешены для первого
light fixture; новую сборку во время full integration gate не запускать.

tar.gz содержит manifest с per-file SHA256/size, source revision/app, package version,
exact dependency versions/lock fingerprint, builder platform/Node, target и runtime commands.
installedRuntime:false: это source + assets. tsx 4.23.1 находится в devDependencies;
target требует Node24 и `npm ci --include=dev --no-audit --no-fund` на Linux, затем
`node --import tsx backend/server.ts` / `node --import tsx backend/agent-main.ts`.
[npm ci include semantics](https://docs.npmjs.com/cli/v11/commands/npm-ci/) объясняет
явное включение dev dependencies. NODE_ENV=production/omit=dev без include ломает этот
контракт. node_modules Windows не копируются; Linux-specific optional/native dependencies
должны устанавливаться и проверяться на настоящем Linux builder/host по exact lock.

Verify требует отдельно предоставленный expected SHA256 и exact target; manifest hash
внутри bundle не заменяет доверенный digest из reviewable plan. Проверяются file set,
required files, SHA/size, lock/direct versions и Vite referenced assets. Архив только
читается через tar stdout, без filesystem extraction; links/directories/special/duplicate
entries запрещены. Доверие к provenance не равно подписи: digest надо доставить по
отдельному доверенному каналу. Installer/extraction/activation этим CLI не реализованы.

```powershell
node scripts/hosting-installation.mjs pack --output=work/hosting-installation.tar.gz --target=ubuntu-24.04-linux-x64-node24 --reuse-public
node scripts/hosting-installation.mjs verify --artifact=work/hosting-installation.tar.gz --sha256=<pack-output-sha256> --target=ubuntu-24.04-linux-x64-node24
node scripts/hosting-installation-check.mjs
```

## Проверки и оставшееся

Light fixture подготовлен: настоящий tar archive и separate verify, wrong expected hash,
wrong target, missing entry, corrupt inner bytes с правильным outer SHA и wrong manifest
target. Fixture owned .test-data directory удаляется в finally. Actual lightweight fixture
**PASS exit 0, 6.641s** на final source с existing root-approved assets; повторная Vite сборка не запускалась.
Style обоих новых scripts PASS, 1 file/0 каждый; targeted diff-check PASS.
Windows Node v24.18.0/bsdtar 3.8.8 проверили настоящий архив, не Linux runtime.
Это не Linux/npm/install/readiness proof. Первоначальный tar CRLF listing parser исправлен
на native newline recognition; bytes содержимого и file hashes не нормализуются.

Следующий этап должен независимо проверить fresh build path и Linux Node24/npm ci
include=dev, authority descriptor/agent authenticated readiness, protected secrets/data
вне versioned artifact и точный preflight OS/arch/runtime/socket/owned roots. Затем отдельные
installation activation, restart, interruption, rollback, public HTTPS/native WS/RPC.
Artifact SHA/target verification не проверяет эти host facts. OCI pinned product image,
SSH host key, service manager и TLS остаются отдельными границами; никаких OS действий,
новых credentials storage, image pull, publish, deployment или claims whole Q11 здесь нет.

## P2 snapshot integrity correction

Readonly review обнаружил TOCTOU: проверка hash читала bytes, а subsequent tar calls
снова открывали заменяемый original path. Это исправлено до дальнейшей приёмки:
createInstallationVerifier создаёт private own mkdtemp snapshot ровно checked bytes
через wx/mode0400; все tar list/content операции читают только этот snapshot. Finally
проверяет owned root/name и удаляет snapshot как при успехе, так и при process error.
CLI verify использует native tar по умолчанию; public factory принимает только process
runner boundary для композиции/проверки, без production test flags или skip-hash режима.

Контролируемый fixture заменяет original path другим valid tar bundle с wrong target
при первом real tar call **после** SHA/snapshot. Каждый последующий tar path сверяется
с private snapshot. Вернувшийся manifest равен original trusted manifest, original bytes
уже отличаются от expected SHA, а новая verify original path отклоняется. Проверены
cleanup success и process failure. Final lightweight actual **PASS exit0, 5.460s**;
прежние corrupt/missing/wrong-target negatives также PASS, style двух scripts 0 и
targeted diff-check 0. Fresh Vite/Linux/Docker/installer не запускались этим исправлением.

## Root fresh-build acceptance

После завершения общего integration gate root выполнил default pack без --reuse-public:
PASS exit0, 4.195 s. Отдельный CLI verify PASS; manifest содержит mode:fresh-vite-build,
freshnessVerifiedByPackager:true, installedRuntime:false и source
2163a0f5365cc0d48f92a0cbb3ebf2766b55636f. Собственный артефакт:
`work/hosting-installation/hosting-2163a0f.tar.gz`, SHA256
`2db1137cbb77ca2819ac07a9629cb548587c842d988f29be8dffae901b9ae0a7`.
Lock SHA256: `0b2893fadac829a0bc8d244ea3072e9e666c879c4e75ecc927d785485f8e5f45`.
Vite warning о будущем native config loader и own staging outDir не означал failure;
существующий public каталог и пользовательские данные не очищались.
Root повтор snapshot/negative fixture ранее PASS exit0, 5.543 s.
Windows fresh source/assets packaging принят; Linux npm/install/readiness остаются pending.
