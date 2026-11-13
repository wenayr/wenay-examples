# История monitoring

Абзацы, ранее стоявшие в README приложения. Актуальное состояние — [README](../../apps/monitoring/README.md) и [STATUS](../STATUS.md).

Окончательная самостоятельная копия из 45 файлов прошла установку, typecheck, build и все пять тестовых наборов. Frontend `Ds-uNzwM`. Docker `wenay-examples.local/monitoring:first` закреплён digest `sha256:589508fa96052de97263053baf18d36190714c73bddd39cd2848a4ba0d40d271`, `second` — `sha256:cf22892929dcead44e4ef2e99d75979227573e3d0dc6f1162a1605805420a2f9`. Лимит контейнера 256 MiB, снимки при проверке 56.62–57.49 MiB. Совместимые релизы отличаются меткой; миграция несовместимого формата не заявляется. Подробности и найденное улучшение встроенного probe: [отчёт об упаковке](../../doc/reports/monitoring-packaging.md).
