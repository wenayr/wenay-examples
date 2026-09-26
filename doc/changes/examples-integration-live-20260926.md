# Merged examples: local Hosting Docker live gate

26 September 2026. Managed INTEGRATION `codex/examples-integration-20260926`, source tree
`e4944c34ecc8659d0071d9405820c53c61f135a5` (root-confirmed tested tree; HEAD independently read).
Root actual run completed at **2026-09-26T19:26:40.573Z**: **complete=true, exit code 0, 11/11 PASS**.
Evidence was read from `work/hosting-live/report.json` and all eleven corresponding log tails.
This report preserves the merged local Docker gate separately from earlier ORIGINAL selected runs.

## Accepted behavior and limits

All eleven product modes passed first deployment, second deployment and rollback through the local
stable gateway, with their product-specific durable state/read assertions. Organizer and Pizzeria
logs confirm advertised gateway RPC + Store + SC1 screen/chat + durable AI receipt across three stages.
Support confirms RPC sessions, durable tickets and attachments. Metering confirms reconnect and
persistent key/ledger. Documents confirms stable live sessions, Node/Python CSV, real PDF, approved
exports and original bytes. CRM, Booking, Forms, Monitoring, Approvals and Content confirm stable
gateway and durable product state at each stage.

The gate inspected actual image IDs/RepoDigests and `org.wenay.examples.dependencies` labels.
The application fingerprint below is package+lock metadata, not a source freshness hash; exact source
identity is recorded separately above. Image dependency labels equal the corresponding application
fingerprint in all 22 reported image records. Existing tags for nine products were inspected to pinned
RepoDigests; Organizer/Pizzeria input references themselves are pinned digests.

This accepts the local merged product selection. It does not accept external HTTPS/TLS/domain/SSH,
clean-server installation/bootstrap, server peak memory, load/capacity/HA, or the generic `runtime`
scenario (not selected). Log memory observations are samples under the configured 256 MiB product
limits, not peak measurements. Final repository check:all was still running when this report was
prepared; no result for that independent gate is claimed here. No Docker/build/tests were started
by the report author, and generated STATUS/plans/NEXT were not edited.

## Actual rows

Hosting package+lock fingerprint shared by all rows:
`9f8e0dc7498f490528a43a7c0ad5831222dc9d9b1f9bfd64cc667b6a65da2d01`.

| Product | Script | Seconds | Result / exit | Application package+lock fingerprint |
| --- | --- | ---: | --- | --- |
| organizer | `test:public-address` | 43.369 | PASS / 0 | `ba31e1fa026cda7b43bda336519b74e01f27790a21f33a21274c0459a6653f15` |
| pizzeria | `test:public-address` | 34.787 | PASS / 0 | `ba31e1fa026cda7b43bda336519b74e01f27790a21f33a21274c0459a6653f15` |
| support | `test:support` | 32.595 | PASS / 0 | `7fbe2f693d957d78b2a44414408a64fa09a7903b31d16a1222a5a1064f14beb8` |
| metering | `test:metering` | 35.068 | PASS / 0 | `bc75ac5f44a82a977a2eb1a7241d8b76da5f497f2e29c03e49b3eb11f7785ab6` |
| documents | `test:documents` | 43.495 | PASS / 0 | `8e00cc190d487d61fde40e6155dd0ea3026c858a924b4caa84b7cb3fd3b92e4b` |
| crm | `test:crm` | 33.590 | PASS / 0 | `e886c3b5e6adc3ff549660ca9373a612099535c5d23d16d7c2a227fa4732501f` |
| booking | `test:booking` | 36.107 | PASS / 0 | `a5da7988315aefa8d353d7b29ca750e6c44e2cb78defd2f5af022e8bfaa02b2d` |
| forms | `test:forms` | 37.925 | PASS / 0 | `929acc99adcbb4da43f2d17a8b1f26dc6f9303568881d6e5ad5c81fb83f3142e` |
| monitoring | `test:monitoring` | 38.717 | PASS / 0 | `9a3dd6d17932fc09cd17e69899c5354fffaf6fb541c89d286f7c551132b90aa9` |
| approvals | `test:approvals` | 27.979 | PASS / 0 | `6d6568008cc9d826b67ad6d92becbaf8da25dd0114d1eee72c9ee34ee368aaff` |
| content | `test:content` | 36.697 | PASS / 0 | `2d5dc27fbc6239fd6dab9cc14741b875a8a7b632dc769a72e7a6cc34e28accc9` |

## All 22 verified image records

First/second below follow the image order preserved in actual JSON. Each digest is the full RepoDigest;
for this run the reported image ID equals its `sha256:` suffix. All records retain the exact reference
used by the gate, including tag inputs. Logs are `work/hosting-live/<product>.log`.

| Product / image | Actual input reference | Verified RepoDigest |
| --- | --- | --- |
| organizer / first | `wenay-examples.local/organizer@sha256:0b61e7a4ea19086491aecc9637cf38373de75d830b6f5f95de0d75b93ed08b47` | `wenay-examples.local/organizer@sha256:0b61e7a4ea19086491aecc9637cf38373de75d830b6f5f95de0d75b93ed08b47` |
| organizer / second | `wenay-examples.local/organizer@sha256:4726c6a0245194379c0b37d574902c935aa18603c4ff2346a3363d6d9d923c63` | `wenay-examples.local/organizer@sha256:4726c6a0245194379c0b37d574902c935aa18603c4ff2346a3363d6d9d923c63` |
| pizzeria / first | `wenay-examples.local/pizzeria@sha256:9caec56ad09e13f77898793f33ea8b1931b5cce2a3862101cac18c57df0985e0` | `wenay-examples.local/pizzeria@sha256:9caec56ad09e13f77898793f33ea8b1931b5cce2a3862101cac18c57df0985e0` |
| pizzeria / second | `wenay-examples.local/pizzeria@sha256:7b475bb009fde30194e6d67d4753a142e5f56a9c4bf694736ed8bdb9e7a9de38` | `wenay-examples.local/pizzeria@sha256:7b475bb009fde30194e6d67d4753a142e5f56a9c4bf694736ed8bdb9e7a9de38` |
| support / first | `wenay-examples.local/support:first` | `wenay-examples.local/support@sha256:08155b422a0fef2e483d920ecbbc5fa67f89e025903c62175401fac3e265502d` |
| support / second | `wenay-examples.local/support:second` | `wenay-examples.local/support@sha256:afaa2684e0556dfd18d8c3d0f5e61d9b314486dccf11fc3ddc5ab5165b435d5e` |
| metering / first | `wenay-examples.local/metering:first` | `wenay-examples.local/metering@sha256:20cdaf0b0149f43a7fee71e690582398c8d9346cef0313a6956309342fe58260` |
| metering / second | `wenay-examples.local/metering:second` | `wenay-examples.local/metering@sha256:dbffe3c0fba591667b985314751b585d72b4448e4267b8655e8921ff4d4351ac` |
| documents / first | `wenay-examples.local/documents:first` | `wenay-examples.local/documents@sha256:4ca94fc3a9ec420acf88c4a55ff7300499b574b430322df08e8623a7a6ca58c3` |
| documents / second | `wenay-examples.local/documents:second` | `wenay-examples.local/documents@sha256:cd8587376772cf7c1d33308fb455805666bb26cb0dce492e7d978128bdb6bdfa` |
| crm / first | `wenay-examples.local/crm:first` | `wenay-examples.local/crm@sha256:487bf74075409d95db3266f76dccbe866ce3e762c26c366ac83e81aa1756eace` |
| crm / second | `wenay-examples.local/crm:second` | `wenay-examples.local/crm@sha256:b82b02cb5745464baa44f4e770bfbd79347d1608a184069c6ba0d2ca792ab67f` |
| booking / first | `wenay-examples.local/booking:first` | `wenay-examples.local/booking@sha256:659b1e924929466d6dd6eae5ffd0f87ea39b7e4877d9a71e6dd4f021e42abe7b` |
| booking / second | `wenay-examples.local/booking:second` | `wenay-examples.local/booking@sha256:7b802b5a935e8dd64330a3cee82b9b9d6a31dd8a357a5a456e6b8e369ffd35b2` |
| forms / first | `wenay-examples.local/forms:first` | `wenay-examples.local/forms@sha256:30b1b4cc01c6e7eb544391f92e4ab36d61821091752863ce6fdfd98b17880dd5` |
| forms / second | `wenay-examples.local/forms:second` | `wenay-examples.local/forms@sha256:e439af6c8fb91bbeeade747089aed9784917b82aeb492473aacc75d88d47cf35` |
| monitoring / first | `wenay-examples.local/monitoring:first` | `wenay-examples.local/monitoring@sha256:4af4fe8d802b51854d76ab491d307fc3638f33cf5b0c0250f3671f38b399df1b` |
| monitoring / second | `wenay-examples.local/monitoring:second` | `wenay-examples.local/monitoring@sha256:fff7a2cede266c8844a1a5c557d9956d608be0b46cae4463ebc51258f89521f0` |
| approvals / first | `wenay-examples.local/approvals:first` | `wenay-examples.local/approvals@sha256:e7fa4a3d071d56e4b93505ed6491d2c00d8f35bff6b357f269511ef596bbdab5` |
| approvals / second | `wenay-examples.local/approvals:second` | `wenay-examples.local/approvals@sha256:8850818b159257342caa6bd4b78a1e148e3fdf0fa58e963a2083364253f4b724` |
| content / first | `wenay-examples.local/content:first` | `wenay-examples.local/content@sha256:49de9cf39b3899a08a5cde2880b0b7a3bf42523174a972985b12ee34169b60cc` |
| content / second | `wenay-examples.local/content:second` | `wenay-examples.local/content@sha256:00ed4c7d8aac3358956a17b6c66cf2ff2213bf4007403d1860310f8cc7ec8462` |

Historical selected-run evidence remains unchanged. This new merged gate supersedes the
previous lack of a single eleven-product merged local run; it does not erase the external/installation
boundaries or imply that unselected independent checks passed.
