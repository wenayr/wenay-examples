# common2 2.18.0: массивы объектов в публичном schemaCommand

**Закрыто:** опубликован и применён common2 2.18.1. Typecheck, полный npm test, обе сборки и браузерные сценарии рецептуры/чек-листа проходят. [Результат 0.9.0](../changes/0.9.0.md). Ниже сохранено исходное воспроизведение.

При переходе потребителя с локального scaffold на `wenay-common2/service` обнаружена недостающая возможность. Пример использует массивы объектов в `setMenuItem.recipe` (`ingredientId`, `quantity`) и `workSaveTask.checklist` (`title`, `done`, необязательный массив).

Публичный `tFieldSpec` разрешает только `{array: tFieldKind}`. Компиляция `{array: {object: {...}}}` завершается TS2322. Это не только проблема деклараций: `buildInputValidate` вызывает `checkScalar` для каждого элемента массива, а `inputJsonSchema` ищет scalar JSON по объекту.

Минимальный сценарий для опубликованной версии:

```ts
import {buildInputValidate, inputJsonSchema, schemaCommand} from 'wenay-common2/service'

const schema = {recipe: {array: {object: {ingredientId: 'string', quantity: 'number'}}}} as const
const command = schemaCommand(schema, {apply(_ctx: unknown, input) {return input.recipe[0].quantity}})
buildInputValidate(schema)({recipe: [{ingredientId: 'dough', quantity: 250}]})
inputJsonSchema(schema)
```

Ожидается: один и тот же DSL выводит точные типы, проверяет каждый объект и строит OpenAPI `items` с `properties`, обязательными полями и `additionalProperties: false`. Реализовать рекурсивную спецификацию элемента массива в существующем DSL; не добавлять отдельную систему схем. Сохранить primitive arrays и optional-массивы, отклонять null, неверные поля/типы и нечисловые quantity, показывать путь с индексом в ошибке. Убедиться, что обязательность элемента не превращает массив в набор optional/undefined значений.

Приёмка: compile-only positive/negative проверки точных аргументов и результата, runtime вложенной валидации, OpenAPI items; публикация patch-версии; typecheck, inventory/organizer/network сценарии потребителя без изменения формы существующих команд или ослабления проверки входа.

Потребитель использует опубликованную patch-версию. Установленный пакет вручную не исправлялся.
