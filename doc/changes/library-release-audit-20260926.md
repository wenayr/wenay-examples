# B00 — аудит опубликованных версий и всех копий библиотек

Фактическое время проверки: **2026-09-26 18:13:56–18:14:07 UTC**.
Read-only npm metadata; install/update/pack, dependencies/locks/source/node_modules,
конфигурация npm, планы и коммиты не изменялись. Repro и тяжёлые проверки не запускались.

## Результат публичного registry

| Пакет | npm latest | Установлено / точная dependency | Последняя публикация | Registry modified |
| --- | --- | --- | --- | --- |
| wenay-common2 | 3.1.1 | 3.1.1 / 3.1.1 | 2026-09-24T13:52:34.638Z | 2026-09-24T13:52:34.795Z |
| wenay-react2 | 5.0.0 | 5.0.0 / 5.0.0 | 2026-09-24T14:56:48.510Z | 2026-09-24T14:56:48.667Z |

Полные npm time maps не содержат более поздних версий. Отдельная проверка публичного
`https://registry.npmjs.org` вернула только dist-tag latest для каждого пакета.
Нового опубликованного релиза относительно exact installed **3.1.1 / 5.0.0 нет**.
Installed/declared значения непосредственно сверены во всех app package.json,
package-lock.json и установленных package manifests обоих checkout. Расширенная
проверка копий завершилась **2026-09-26 18:15:22 UTC**.

## Полная ширина package/lock/installed

Для каждого потребителя проверены declared dependency, lock root declaration,
lock node_modules version и реальный installed package manifest. Все четыре значения
совпадают: common2 **3.1.1**, react2 **5.0.0**, без caret/tilde/local alias.
Resolved lock entries указывают на опубликованные tarballs registry.npmjs.org:
`wenay-common2-3.1.1.tgz` / `wenay-react2-5.0.0.tgz`.

| Приложение | Original package + lock + installed | Graph package + lock + installed |
| --- | --- | --- |
| approvals | 3.1.1 / 5.0.0 | 3.1.1 / 5.0.0 |
| booking | 3.1.1 / 5.0.0 | 3.1.1 / 5.0.0 |
| content | 3.1.1 / 5.0.0 | 3.1.1 / 5.0.0 |
| crm | 3.1.1 / 5.0.0 | 3.1.1 / 5.0.0 |
| documents | 3.1.1 / 5.0.0 | 3.1.1 / 5.0.0 |
| forms | 3.1.1 / 5.0.0 | 3.1.1 / 5.0.0 |
| hosting | 3.1.1 / 5.0.0 | 3.1.1 / 5.0.0 |
| metering | 3.1.1 / 5.0.0 | 3.1.1 / 5.0.0 |
| monitoring | 3.1.1 / 5.0.0 | 3.1.1 / 5.0.0 |
| pizzeria | 3.1.1 / 5.0.0 | 3.1.1 / 5.0.0 |
| support | 3.1.1 / 5.0.0 | 3.1.1 / 5.0.0 |
| chat | Приложения в original ещё нет | 3.1.1 / 5.0.0 |
| catalog | Не потребляет библиотеки | Не потребляет библиотеки |

Original содержит **11** пар package/lock потребителей, graph — **12** (с новым chat).
Физически проверены **23** app копии, **46** library installed manifests;
после объединения это **12 уникальных приложений** для будущей миграции, а не 23.
Оба UI Pizzeria/Organizer используют один app package/lock; отдельной тринадцатой
dependency migration для Organizer нет. Catalog и пользовательский facade-map
не включать в library consumer count автоматически.

Команды проверки:

```text
npm view wenay-common2 version time --json
npm view wenay-react2 version time --json
npm view wenay-common2 dist-tags repository.url time.modified --json --registry=https://registry.npmjs.org
npm view wenay-react2 dist-tags repository.url time.modified --json --registry=https://registry.npmjs.org
```

Первичные официальные ссылки: [common2 npm metadata](https://registry.npmjs.org/wenay-common2),
[react2 npm metadata](https://registry.npmjs.org/wenay-react2),
[common2 repository](https://github.com/wenayr/wenay-common2).
Repository URL common2 получен непосредственно из npm metadata; у react2 поле
repository.url этим запросом не возвращено, URL репозитория не угадывался.

## Пять открытых repro и основание следующей миграции

Ни одна из пяти задач не может считаться исправленной новым релизом: такого релиза
сейчас нет. Сохраняется ранее подтверждённое состояние точной npm версии:

- AI-POLICY-INVALIDATION — native вывод после внешней смены policy.
- AI-RESOURCE-LIFECYCLE — позднее завершение native consumer с process fatal.
- CONVERSATION-RECEIPT-POLICY — повтор receipt до current policy.
- CONVERSATION-RESOURCE-LIFECYCLE — conversation consumer terminal/error lifecycle.
- SERVICE-COMMAND-RECEIPT-ACL — native HTTP receipt retry до current command.allow.

Две AI задачи находятся в original [CURRENT-HANDOFF](../library-tasks/CURRENT-HANDOFF.md);
три новые Conversation/Service задачи и их public repro сохранены в graph C03 `e97161a`.
Branch registry объединять при интеграции, не терять graph подтверждения.

Changelog новой версии не исследовался, потому что более новой опубликованной версии
не найдено. Не переносить возможные unreleased GitHub изменения в dependencies и не
объявлять исправление по названию commit. После появления релиза: прочитать опубликованные
release notes/public contracts, прогнать конкретные expect-fixed и lifecycle критерии
через публичные exports точной версии, затем обновлять приложения отдельными коммитами
с удалением только доказанно заменённых обходов и повторной runtime/browser приёмкой.

Следующее: root сохраняет текущие этапы. Оснований для dependency migration по этому
registry snapshot нет; повторить B00 только при новой публикации или новом запросе.

Одна ограниченная следующая primary-source проверка: сравнить semantics публичного
service command principal RPC, native REST/byToken и server corridor entrypoints на
receipt retries для SERVICE-COMMAND-RECEIPT-ACL. Итог — точная матрица, где current
allow проверяется до stored/in-flight receipt, а где нет, и минимальный общий критерий
исправления. Использовать опубликованные API/source, не менять библиотеку и не строить
вторую receipt систему. Это уточнение реального дефекта; runtime fix не заявляется.
