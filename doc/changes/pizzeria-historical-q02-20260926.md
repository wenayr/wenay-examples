# Q02: настоящий исторический архив Pizzeria принят

26 сентября 2026, ORIGINAL. Root создал составной fixture настоящим старым Pizzeria
и восстановил его текущим приложением. **Historical library archive acceptance PASS**:
common2 2.21.1 / react2 3.5.1 → common2 3.1.1 / react2 5.0.0,
native schema **5 → 5**. Business schemas 1–4 migration не проверялись.

## Происхождение и фактические исполнения

Managed старый checkout:
`C:\Users\wenay\.codex\worktrees\pizzeria-old-archive\wenay-examples`,
точный commit `234572908e2536f49192b78f9bfecbecff8d6961`.
Это непосредственный parent настоящего Pizzeria library upgrade `746e27c`;
`f65b1af` является более поздним отчётом обновления.
Package и lock старого приложения закрепляют опубликованные common2 2.21.1/react2 3.5.1.
Старые production source/package/lock при создании не менялись.

Root старые npm ci PASS **6.24 s**, syntax PASS; fixture actual exit0 за **8.273 s**,
создан около **2026-09-26 18:48:39 UTC**. Старый child main.ts через существующий IPC
helper создал order/automatic task/photo/chat attachment/completed demo AI.
Старые cold backup/restore CLI подтвердили отдельный old→old restart control.
AI provider отключён, платных вызовов нет.

Первый current verifier прошёл syntax, но exit1 примерно за 4.7 s на неверном test
предположении о top-level message.text. Public ConversationMessage в обеих версиях
хранит blocks; app post создаёт text block version 1. Исправлен только verifier:
точное содержимое blocks плюс conversationId/requestId. Production и архив не менялись.

Второй current run: **exit0, 4.048 s**, evidence timestamp
**2026-09-26T18:50:44.789Z**. Current restore/cold restart, receipts и attachment revoke
PASS. Finally подтвердил неизменность старых input files и удалил только own derivatives.

## Сохранённый fixture и хеши

Root explicitly supplied own generated fixture:
`C:\Users\wenay\AppData\Local\Temp\pizzeria-historical-A5v8pE\archive`.
`expected.json` и `provenance.json` расположены в родительском fixture directory.
Архив — временный generated evidence, не пользовательские данные и не source commit.
Сохранение этого пути на неопределённый срок не гарантируется; процедура создания
воспроизводима из точного старого commit и lock.

| Evidence | SHA-256 |
| --- | --- |
| Old package.json | c6b68481903c6b037bba5e4378d31d736a4924f80bfa0dfbe402014cdf73f8ed |
| Old package-lock.json | 951e35b9c0b796956e0df378f3f55f11e455fdc08a50699fff175af4fa036a15 |
| Old archive manifest.json, до и после current verification | cf8cf11e0e8dc830bc3cc83433a5b022c97d626e5cab406727982b73d20f1d9a |

Manifest `wenay-cold-backup-1`, dataVersion `pizzeria-5`, libraries 2.21.1/3.5.1
создан старым backup из его настоящего package. Verifier проверил source hashes против
старых Git blobs с допустимыми LF/CRLF checkout endings и SHA-256/size всех archive records.
Прежние archive/complete/expected/provenance не перезаписывались.

## Какие public assertions приняты

- Order сохраняет ID, address и count; его прежний requestId возвращает прежний order,
  automatic kitchen task существует после restore и следующего current cold restart.
- PNG доступен с теми же bytes. Chat create/post receipts возвращают прежние native IDs;
  message появляется единожды в history и содержит точный сохранённый text block.
- Attachment download возвращает те же bytes owner и member. На retained chef facade
  после owner membership revoke history становится пустой, download и новый post запрещены.
- Completed demo AI возвращает прежний run ID и state completed; сохранённые proposals
  совпадают, изменённый input при прежнем requestId отвергается.
- Current backup/restore второго поколения имеет честные current 3.1.1/5.0.0 metadata;
  основной набор assertions повторяется после этого cold roundtrip.

Native IDs и inputs передаются через уже созданный expected.json; новая receipt ledger
или альтернативная serialization не вводилась. Existing native client/replay/IPC helper,
media HTTP routes и cold backup CLI обслуживают весь сценарий.

## Фактические команды root

Установка и первоначальный old driver запуск выполнялись в historical checkout:

```powershell
npm ci --prefix C:\Users\wenay\.codex\worktrees\pizzeria-old-archive\wenay-examples\apps\pizzeria
node --check C:\Users\wenay\.codex\worktrees\pizzeria-old-archive\wenay-examples\scripts\pizzeria-historical-fixture.mjs
Set-Location C:\Users\wenay\.codex\worktrees\pizzeria-old-archive\wenay-examples\apps\pizzeria
node --import tsx ../../scripts/pizzeria-historical-fixture.mjs
```

Текущая проверка, включая успешный повтор:

```powershell
node --check C:\Users\wenay\WebstormProjects\wenay-examples\scripts\pizzeria-historical-verify.mjs
Set-Location C:\Users\wenay\WebstormProjects\wenay-examples\apps\pizzeria
node --import tsx ../../scripts/pizzeria-historical-verify.mjs C:\Users\wenay\AppData\Local\Temp\pizzeria-historical-A5v8pE\archive C:\Users\wenay\AppData\Local\Temp\pizzeria-historical-A5v8pE\expected.json C:\Users\wenay\AppData\Local\Temp\pizzeria-historical-A5v8pE\provenance.json
```

## Durable creation driver

Проверенный old driver сохранён в ORIGINAL `scripts/pizzeria-historical-fixture.mjs`.
Единственная adaptation: repository берётся из обязательного абсолютного argv,
а не относительно расположения script. Driver проверяет exact old HEAD, installed
версии, package/lock и отсутствие tracked production/backup/restore Git diff; библиотеки
и existing helper resolve через old apps/pizzeria. Старый script оставлен неизменным.

Root выполнил новый relocated invocation: **exit0, 3.661 s**, generated fixture создан
около **2026-09-26 18:52:51 UTC**. Это отдельная проверка сохранённого ORIGINAL driver,
а не вывод из старого запуска:

```powershell
Set-Location C:\Users\wenay\.codex\worktrees\pizzeria-old-archive\wenay-examples\apps\pizzeria
node --import tsx C:\Users\wenay\WebstormProjects\wenay-examples\scripts\pizzeria-historical-fixture.mjs C:\Users\wenay\.codex\worktrees\pizzeria-old-archive\wenay-examples
```

Driver output даёт новый archive/expected/provenance path; последующий verifier должен
получить именно эти три абсолютных argv, без поиска и угадывания старых данных.

Фактический второй fixture directory:
`C:\Users\wenay\AppData\Local\Temp\pizzeria-historical-4Ozzba`.
Его manifest SHA-256:
`bd20d66ac8d0506f66ca2c4490bc48af77759d0ecc609fc962487f8a921c5066`.
Package/lock hashes прежние. Root current verifier для **этого** archive также прошёл:
**exit0, 3.952 s**, evidence timestamp **2026-09-26T18:53:00.980Z**.
Первое fixture evidence A5v8pE выше остаётся отдельным неизменным proof.

```powershell
Set-Location C:\Users\wenay\WebstormProjects\wenay-examples\apps\pizzeria
node --import tsx ../../scripts/pizzeria-historical-verify.mjs C:\Users\wenay\AppData\Local\Temp\pizzeria-historical-4Ozzba\archive C:\Users\wenay\AppData\Local\Temp\pizzeria-historical-4Ozzba\expected.json C:\Users\wenay\AppData\Local\Temp\pizzeria-historical-4Ozzba\provenance.json
```

Таким образом, сохранённая пара ORIGINAL scripts имеет отдельный actual creation и
current verification PASS; generated fixture по-прежнему не входит в source commit.

## Ограничения и commit scope

Приёмка относится к genuine old library archive schema 5, completed demo AI и backend
public behavior. Schemas 1–4 upgrade, inflight AI recovery, paid provider, browser/network
timings и все открытые библиотечные repro не принимаются этим результатом.
Current metadata-only mismatch checks из
[предыдущего Q02 отчёта](pizzeria-backup-q02-20260926.md) не подменяют historical proof;
теперь историческое evidence получено отдельно настоящим старым writer.

Exact дополнительный source scope: `scripts/pizzeria-historical-fixture.mjs`,
`scripts/pizzeria-historical-verify.mjs` и этот durable report.
Не включать generated archives, work logs, temporary expected/provenance, старый checkout,
product source, dependency changes или соседние Q03/Q05/Q11 этапы.
