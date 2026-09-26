# Q03: live Docker acceptance выбранных трёх продуктов

2026-09-26, ORIGINAL. Источник: свежий root `work/hosting-live/report.json`, три соседних logs и `work/hosting-live-images/product-images.json`. Readonly review не запускал Docker, builds или tests и не менял source. **Принят только selected набор organizer, pizzeria, support: 3/3 PASS. Полный Q03/все продукты не приняты.**

## Фактический результат

Report timestamp `2026-09-26T18:31:07.455Z`, complete=true, code=0, selected ровно organizer/pizzeria/support. Каждая row status=pass, code=0, reason пуст. Root подтвердил настоящий Linux Docker daemon 29.7.2; это не HTTP Docker fixture.

| Selected scenario | Existing hosting command | Seconds | Log assertions |
| --- | --- | ---: | --- |
| organizer | test:public-address, HOSTING_APP_KIND=organizer | 38.577 | Stages 0/1/2: advertised gateway RPC + Store + SC1 screen/chat + durable AI receipt |
| pizzeria | test:public-address, HOSTING_APP_KIND=pizzeria | 39.439 | Stages 0/1/2: тот же публичный product path и durable AI receipt |
| support | test:support | 30.946 | Deploy first → second → rollback: stable route/RPC session, durable ticket и attachment, container limit 256 MiB |

Organizer/Pizzeria gate использует полный public-address сценарий, а не rest-only сокращение. Существующие сценарии проверяют замену first→second и rollback на одном долговечном томе, reconnect исходного native client, стабильный advertised gateway. First/second построены из текущего дерева с разным APP_RELEASE; это не историческая migration прежней версии source и не Q02 old archive acceptance.

Не выбраны и **не приняты этим report**: metering, documents, crm, booking, forms, monitoring, approvals, content — оставшиеся восемь product scenarios. Дополнительный generic runtime Node→Python→Node также не запускался в этом selected наборе. Exit0 узкого набора не означает полный live gate PASS.

## Реальные шесть images и dependency labels

В report каждой пары сохранены действительные manifest RepoDigest, image ID и `org.wenay.examples.dependencies`. Prepared own manifest содержит те же шесть digest references. Organizer/Pizzeria label берётся от общего apps/pizzeria package+lock; Support — от apps/support.

| Product/release | Verified immutable reference |
| --- | --- |
| organizer-first | wenay-examples.local/organizer@sha256:9c1c223907a65d6d6356d7e2ae57ea30b22285be15032f53a9e74169be4a6dd3 |
| organizer-second | wenay-examples.local/organizer@sha256:87e9e15dc4c5e41990a1fce99ee428dbbf95c700150eca9f0f6e5c827136b3f7 |
| pizzeria-first | wenay-examples.local/pizzeria@sha256:6111a9aa0e839531b4d4e1e6a7a68dcf2fe0c4b765ab3c4008eff62d9343996d |
| pizzeria-second | wenay-examples.local/pizzeria@sha256:ded598c1cee3a9f4fd55b4a54f823e2ea749f8d54a1904307e00857605c7424b |
| support-first | wenay-examples.local/support@sha256:c05f1733326258aa7ff295dc69dedf3ecab7f372ff35e2802c29db951aa1a3c4 |
| support-second | wenay-examples.local/support@sha256:bfd20d930fb44b39bdc3d48277af560f730c03c54249c247a16cfe1161347ab9 |

В данной Docker image store ID каждой image равен `sha256:` части указанного digest; это наблюдаемый результат inspect, а не основание подменять manifest digest произвольным config ID.

Report package+lock fingerprints:

- Hosting: `9f8e0dc7498f490528a43a7c0ad5831222dc9d9b1f9bfd64cc667b6a65da2d01`.
- Pizzeria/Organizer, обе images каждой пары: `4bfc15f8139291a617eb2a8adc0eb0b69480c8f13ec0b6da2d5701c040e79b85`.
- Support, обе images: `7fbe2f693d957d78b2a44414408a64fa09a7903b31d16a1222a5a1064f14beb8`.

Gate проверяет действительные local images и label соответствие package+lock, но не независимое содержимое node_modules/source tree внутри image. Labels доверены builder. После source изменения без npm изменений image всё равно надо пересобрать; прежний label сам по себе не доказывает свежесть source. Этот report относится к root freshly prepared шести images и записанному selected run.

## Bounded preparation helper

`scripts/prepare-live-images.mjs` готовит выбранные eleven product modes последовательно, first затем second. Organizer/Pizzeria используют apps/pizzeria Dockerfile и APP_MODE, остальные nine — свой существующий Dockerfile. App frontend build outputs root готовит заранее; helper их не собирает. Все product FROM проверяются на existing exact sha256 pin. Build argv задаёт --memory 768m, APP_RELEASE и shared fingerprint label, только own `wenay-examples.local/<product>:{first,second}` tags.

Public Node execFile без shell: windowsHide=true, ten-minute build timeout, fifteen-second inspect timeout, bounded output. DOCKER_BIN и child CLI-directory PATH поддержаны. После build проверяются own RepoTag, own RepoDigest namespace, valid image ID и matching label; дополнительный inspect digest должен вернуть тот же ID/label. Missing RepoDigest завершает preparation ошибкой, без придумывания digest или registry push. Dependency fingerprint перепроверяется после build и до записи manifest.

Только после всех проверок atomic rename публикует собственный `work/hosting-live-images/product-images.json`; temporary file уникален и убирается в finally. Manifest содержит только current selection, старые непроверенные записи не merge. Helper не пишет apps/hosting/data и не создаёт/удаляет чужие containers/images, не делает push/prune. `--plan` сначала валидирует параметры и читает только metadata, затем печатает argv без Docker calls или file writes.

Invocation для воспроизведения выбранного пути (при подготовленных frontend outputs и доступном Docker CLI):

```text
node scripts/prepare-live-images.mjs --only=organizer,pizzeria,support
node scripts/hosting-live-gate.mjs --only=organizer,pizzeria,support --images=C:\Users\wenay\WebstormProjects\wenay-examples\work\hosting-live-images\product-images.json
```

Для Organizer/Pizzeria новый HOSTING_PRODUCT_IMAGES_FILE позволяет existing check читать отдельный own manifest; остальные products используют установленные first/second tags и самостоятельно закрепляют их digest. Gate не пишет STATUS и не подменяет run-all logs. Existing [LIVE-GATE](../../apps/hosting/LIVE-GATE.md) описывает runner/preparation/proof boundaries; его историческая фраза о непроведённых Docker builds относится к более раннему audit runner, свежий selected результат записан здесь.

## Границы относительно соседних этапов

Q11 publicOrigin resource/UI, owner/admin ACL, HTTPS configuration и внешний TLS/DNS/proxy этим selected run не приняты: сценарии используют existing stable локальный advertised gateway. Forced WebSocket через каждый product container не заявляется; generic local gateway-ws fixture является отдельным уровнем evidence. Container limits не являются замером общего memory peak машины.

Свежий Hosting typecheck сначала обнаружил Q05 cross-app union regression в documents-live-check.ts после расширения Documents resources. Исправление только типов явно специализирует processor; subsequent `npm run typecheck` exit0 подтверждён отдельно. Это **Q05 integration typefix**, не часть Q03 runner/helper commit и не новый Documents live acceptance. Q02 текущий backup/historical archive, Q01 lazy panels и Q08 manifest budgets также отдельные scope.

## Exact Q03 commit scope для root review

Whole files:

- `scripts/hosting-live-gate.mjs`
- `scripts/prepare-live-images.mjs`
- `apps/hosting/LIVE-GATE.md`
- `apps/hosting/backend/stateful-live-check.ts` — только current delta чтения HOSTING_PRODUCT_IMAGES_FILE; другие изменения при появлении отделить.
- `apps/hosting/DOCKER.md` — current delta уточнения existing gateway-ws proof и ссылки LIVE-GATE.
- `doc/changes/hosting-live-selected-20260926.md` — этот durable результат.

Mixed root `package.json`: включить только добавление `check:hosting-live`. Изменения check:repo/status:bundles принадлежат Q08 и не входят.

Не включать Q11 endpoint/resource/runtime/server/frontend/service/tests/README изменения и hosting package.json test wiring; Q05 `backend/documents-live-check.ts` typefix; любые Documents changes; Q01/Q02 Pizzeria changes; Q08 Vite/status/generated catalog; shared plan/journal. Local work reports/logs/manifest и generated build outputs не коммитить. Финальное сохранение root выполняет после собственного дополнительного review, этого отчёта недостаточно для объявления полного Q03 закрытым.
