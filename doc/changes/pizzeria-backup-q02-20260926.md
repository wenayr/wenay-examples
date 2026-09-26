# Q02: текущий составной cold backup Pizzeria

2026-09-26. ORIGINAL, exact common2 3.1.1/react2 5.0.0. Независимо прочитаны `backend/backup-check.ts`, package.json, PASSPORT.md, README backup delta и существующие backup/restore scripts. Тяжёлые проверки не запускались. **Current cold backup принят по свежему подтверждённому root runner и фактическим assertions. Historical archive прежней версии не принят; полный Q02 остаётся незавершённым.**

## Что реально проверяет fixture

Fixture запускает настоящий child process Pizzeria с собственным SERVICE_DATA_DIR, портом 0 и случайными retained secrets. Данные создаются только через public service/HTTP/resource facades. Owner chat использует public syncStoreReplayBatch. Сначала закрываются подписки/resources/clients и останавливается process; только потом вызываются existing `scripts/backup.mjs` и `restore.mjs`. После restore запускается новый процесс на другом каталоге. Это cold copy; работающий writer и paid/external AI не проверяются.

| Состав архива | Доказательство до/после restore |
| --- | --- |
| Order + автоматическая kitchen task | Реальный placeOrder, ожидание order/task, сохранение count и address. После restart task присутствует, same requestId возвращает прежний order id и count не увеличивается |
| Photo blob | Owner HTTP upload image/png; bytes проверены до backup и после restart. Manifest содержит photos path |
| Chat room/message | Room и post созданы до backup. После restart same create возвращает room, same post возвращает message; replay содержит message ровно один раз |
| Chat attachment blob + ACL | Uploaded fixture.txt, restored bytes совпадают у owner и chef member. После membership revoke retained chef resource download отклоняется |
| Completed demo AI | demo-tasks даёт два proposal items; manifest содержит runs.replay. После restart proposals deep-equal, same createRun возвращает тот же id в completed, altered input при том же requestId отклоняется |

Так покрываются composed business archive, service order receipt, room/message receipts и completed AI identity/checkpoint. Same attachment upload requestId после restore отдельно не вызывается: утверждать проверенный attachment-upload receipt нельзя. Photo GET по дизайну публичный; fixture доказывает photo bytes, а **blob ACL assertion относится к chat attachment**, не к photo endpoint. Не проверяются незавершённые AI runs/recovery, внешний provider или каждое вспомогательное состояние Pizzeria.

## Negative archive и cleanup

Backup без `--i-stopped-it` отклоняется. Удачная копия содержит complete marker, manifest и весь recursive data tree, включая photos/chat/AI. Restore с mismatched `--data-version=pizzeria-6` против записанного `pizzeria-5` отклоняется до создания target. Это **metadata compatibility guard**, а не изменение настоящей schema или миграция прежнего native archive.

Для отдельной broken copy fixture заменяет photo bytes строкой corrupted и проверяет ошибку size/hash с отсутствующим restore target. Конкретная мутация меняет размер, поэтому runtime assertion непосредственно доказывает size corruption rejection. Existing restore source также проверяет sha256 всех manifest files до создания target, однако отдельный equal-size hash-corruption случай этим новым fixture не выполнен. Missing complete/truncated manifest/path escape также не являются новыми assertions этого fixture.

Пути живут в одном own mkdtemp каталоге под realpath(tmpdir). Finally останавливает child и перед recursive rm проверяет exact parent и собственный pizzeria-backup prefix. Production apps/pizzeria/data и пользовательские архивы не используются. Source файлы backup/restore helper не менялись в этом срезе.

## Свежая evidence

Root прямо подтвердил свежий последовательный runner перед Docker build: `node scripts/run-all.mjs typecheck test build --only=pizzeria`, 3/3 PASS. Это подтверждение отличает headers ниже от неподтверждённых исторических logs. Readonly сравнение current package+lock fingerprint совпало с каждым header: `4bfc15f8139291a617eb2a8adc0eb0b69480c8f13ec0b6da2d5701c040e79b85`.

| Проверка | Code/status | Seconds | Header UTC |
| --- | --- | ---: | --- |
| Typecheck | 0 / ok | 0.924 | 2026-09-26 18:21:08.230 |
| npm test | 0 / ok | 71.721 | 2026-09-26 18:22:19.952 |
| Build | 0 / ok | 2.491 | 2026-09-26 18:22:22.446 |

`work/run-all/pizzeria-test.log` включает вызов `npm run test:backup` и его PASS cold backup lines. package.json добавляет test:backup последним шагом npm test, значит aggregate PASS относится и к этой fixture. Build/typecheck подтверждают текущий app, но не подменяют restore assertions. Docker/browser evidence в этот report не добавляется.

## Точный оставшийся historical шаг

Нужен составной архив, созданный **настоящим старым committed/released кодом и его точными зависимостями**, до рассматриваемого перехода. Источник пока не выбран/не представлен; нельзя заменить его текущим fixture с прежним metadata number. В isolated copy старого кода создать order/task, photos, chat/attachments и completed AI receipt, остановить writer, сохранить исходный archive вместе с old commit/release, dependency versions, командами создания и hashes/provenance. Не использовать и не изменять пользовательские данные.

Затем копию этого archive открыть/восстановить текущим кодом и проверить реальные native version/migration behavior, порядок/replay, значения, receipts при retry, restored attachment ACL/revoke, negative/incomplete archive поведение. Сверить hashes исходного старого archive до и после эксперимента: исходник неизменен. Назвать точные old source и команды в отдельном durable historical report. Если формат действительно несовместим, описать явный migration/restore путь и проверить его вместо объявления acceptance по одному metadata guard. Стратегия Q02 требует этот шаг отдельно от уже принятого current cold backup.

## Следующий отдельный commit: exact scope

- `apps/pizzeria/backend/backup-check.ts` — новый composed fixture.
- `apps/pizzeria/package.json` — test:backup script и включение в npm test; dependency/lock изменений здесь нет.
- `apps/pizzeria/PASSPORT.md` — только обновлённая строка проверок с test:backup.
- `apps/pizzeria/README.md` — только backup paragraph под «Хранение и развёртывание»; lazy UI paragraphs уже относятся к отдельному Q01.
- `doc/changes/pizzeria-backup-q02-20260926.md` — этот результат и явный historical остаток.

Не включать canonical DeferredPanel/copies/scaffold/sync-map/frontend (Q01), Vite manifests/status/root package infrastructure (Q08), Hosting source/helpers/live docs, generated app outputs/logs, другие отчёты или shared plan. Existing backup.mjs/restore.mjs используются, но в Q02 commit не входят, поскольку не изменены.
