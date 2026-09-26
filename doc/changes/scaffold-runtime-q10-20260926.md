# Q10: автономный Support-copy runtime smoke

26 сентября 2026. **Driver подготовлен, actual execution pending root.**
`node --check scripts/scaffold-runtime-check.mjs` PASS; npm ci/typecheck/build/native smoke пока не запускались.
Source syntax check не доказывает корректность generated TypeScript или runtime acceptance.
Independent read-only review подтвердил phase deadline/stop barrier, IPC disconnect и abort generation guards.
Дополнительный npm same-config-path P2 исправлен раздельными user/global paths; final re-review pending.
Actual timeout cleanup тоже pending root.

## Scope и запуск

Новый `scripts/scaffold-runtime-check.mjs` использует existing createSaasExample, собственный mkdtemp
`wenay-scaffold-runtime-q10-` и never-existing child Warranty Desk. Source app, scaffold generator,
canonical shared files, root package/locks/user archives не меняет. Ни один прежний temp/profile не трогает.

```text
node scripts/scaffold-runtime-check.mjs
node scripts/scaffold-runtime-check.mjs --npm-cli "C:/path/to/npm/bin/npm-cli.js"
```

Default npm CLI ищется рядом с actual node executable: node_modules/npm/bin/npm-cli.js.
Если отсутствует, driver завершается до создания temp; explicit argument указывает existing installed npm.
Driver проверяет exact package/lock versions и names, запускает npm ci без audit/fund,
сверяет lock SHA256 до/после. Отдельный очищенный child env сохраняет только OS runtime variables;
user provider/AI/OIDC/config secrets не наследуются. Npm user/global configs явно два разных own
пустых файла user.npmrc/global.npmrc (один путь npm отвергает как double-loading),
cache own temp, registry public npm; пользовательский .npmrc/cache не используются.
Нет local library/node_modules link или paid provider.
Registry/install/build относятся к будущему последовательному root запуску, сейчас не выполнены.

## Предметное расширение только generated copy

Existing ticketCreate urgent SLA меняется1hour→30minutes: единственная hours table urgent1→0.5.
Normal24h/high4h сохраняются. Existing domain-check urgent assertion3600000→1800000 обновляется
строго под новые business semantics, остальные assertions не ослабляются. Exact single-anchor guards
останавливают driver при изменении donor source вместо произвольной замены.
New backend/q10-copy-check.ts — scoped fixture, не новая application инфраструктура.

Planned phases: npm-ci → copied typecheck → copied build → copied domain-check → conversation-check
→ new q10-copy-check. Это subset, не full donor npm test или current merged gate.

Native smoke создаёт настоящие authority и два serving node processes, использует опубликованный
createServiceClient/describeService, native commands/views и owned conversation resource:

- Urgent due interval1800000; normal/high regression; same requestId returns same receipt, один ticket.
- Owner/agent/customer/outsider, revision conflict, customer private-write denial, org/private-read isolation.
- Retained resource rejects after native memberRole revoke и current view removes membership.
- Actual serving process termination → client endpoint failover, same store object, новый native reply.
- Authority stop/restart, receipt and revision survive; no journal insertion/synthetic replay receipt.
- Closed clients/resources/nodes/authority → cold fs.cp own data to new directory, per-file bytes SHA256
  equality before restart, restored native views/history/current revoked role и receipt; source bytes unchanged.

Restore — **cold directory copy**, не wenay-cold-backup-1 format/hot snapshot/historical migration.
Generated scaffold intentionally excludes root-dependent backup-check; driver не выдаёт его отсутствие за PASS.
Resources закрываются раньше clients, процессы bounded existing createProcess cleanup, outer finally удаляет
только exact absolute temp с parent+prefix guard и подтверждает отсутствие. Phase timings/cleanup выводятся.
Phase deadline: npm ci10minutes, остальные2minutes. Native child получает IPC abort и закрывает own
resources/clients/nodes/authority, затем выходит; parent ждёт15seconds. Если зависает, parent останавливает
только собственное spawned process tree (Windows taskkill/PID/T, POSIX detached group) и ждёт exit.
При неподтверждённой остановке directory сохраняется, удаление запрещено. Timeout всегда FAIL.
После confirmed normal close native child снимает abort listener и disconnect IPC, не держит event loop.
Abort flag запрещает новые host/node/client/resource поколения во время cleanup.

## Границы приёмки

Root repeat session15011 EXIT0: все подготовленные phases PASS; первый FAIL не скрыт.
Первый root actual session55452 EXIT1: independent npm ci PASS (145 packages, 10.248s),
затем generated typecheck выявил optional dueAt и process.disconnect. Driver исправлен
явным assert dueAt != undefined до каждой арифметики и optional disconnect?.() под
existing connected guard. В первом запуске native execution не достигнут.
Первый FAIL сохранён; cleanup absence подтверждена root, не заменена молчаливым skip.
Repeat actual timings: npmci7575ms, type631ms, build1347ms, domain3065ms,
conversation2150ms, native11895ms. Actual native PASS: Warranty SLA30min, normal24h/
high4h, currentroles/private/history, exact receipt retry, endpoint failover sameStore,
restart и cold directory restore. Root проверил отсутствие обоих собственных temp
directories HDUZRc/46F3WS и неизменность user TASK SHA. Node/npm notice и allow-script
warning не означают изменения глобальных установок/настроек. Это generated-copy subset;
browser/mobile, machine/paid provider и full backup format по-прежнему не приняты здесь.
Browser/mobile/installed app, paid AI/content/machine flows и full donor suite здесь не выполняются.
Q10 human journey и report затрат требуют отдельных actual outcomes; этот runnable fixture их не заменяет.
Commit scope для этого подготовленного slice: новый helper и этот durable report; own progress временный.
