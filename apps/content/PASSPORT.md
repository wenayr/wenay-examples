# Folio · контент и публикации

Паспорт примера. Актуальные результаты проверок — [STATUS](../../doc/STATUS.md), подробности — [README](README.md).

- **Сценарий:** Блоки страницы, изображения, замечания и согласование версии, расписание, публикация и откат
- **Роли:** автор, редактор, издатель, читатель
- **Порт:** 3817; версия примера: 0.1.0
- **Внешние зависимости:** нет
- **Топология:** authority владеет версиями и расписанием; узлы обслуживают проекции; поддержка читает публикации
- **Проверки:** `npm test` — домен, ресурсы, помощник, сеть; `npm run test:integration` — чтение из поддержки (только в исходном репозитории)
- **Своя копия:** `node scripts/create-saas-example.mjs content <каталог>`
- **Размещение:** —
- **Отчёты:** [backend](../../doc/internal/acceptance/CONTENT-BACKEND-ACCEPTANCE.md), [интерфейс](../../doc/internal/acceptance/CONTENT-UI-ACCEPTANCE.md)

## Ограничения

Пять типов блоков без произвольного HTML. Универсального конструктора сайтов нет. Подсказки ИИ демонстрационные.

## Механизмы библиотек

Список собирается `scripts/status.mjs` из фактических импортов приложения.

<!-- status:imports -->
`wenay-common2`, `wenay-common2/ai`, `wenay-common2/observe`, `wenay-common2/server/blob`, `wenay-common2/server/fs`, `wenay-common2/server/process`, `wenay-common2/service`, `wenay-common2/service/client`, `wenay-common2/service/host`, `wenay-common2/service/server`, `wenay-react2/react`, `wenay-react2/ui`
<!-- /status:imports -->
