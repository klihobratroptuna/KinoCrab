/// <reference path="../pb_data/types.d.ts" />
// Поле country — страна карточки карусели «Сериалы». Его пишет проход из той же строки
// Kodik, которая даёт постер, жанр и оценку (material_data.countries), а если строка страну
// не назвала, поле заполняет ответ TMDB (origin_country). Поле нужно для правила: в этой
// вкладке не показываем Южную Корею и Китай. Проверили 2026-11-03: поле добавили через API,
// поэтому файл записан с проверкой — повторный прогон ничего не делает, и модель не
// возвращается (исполнитель миграций считает любое значение ошибкой).
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_544223901");
  if (!collection) return null;

  if (collection.fields.some((field) => field.name === "country")) return null;

  collection.fields.addAt(20, new Field({
    "autogeneratePattern": "",
    "help": "",
    "hidden": false,
    "id": "text1103769220",
    "max": 0,
    "min": 0,
    "name": "country",
    "pattern": "",
    "presentable": false,
    "primaryKey": false,
    "required": false,
    "system": false,
    "type": "text"
  }));

  app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_544223901");
  if (!collection) return null;

  const field = collection.fields.findByNameOrId("country");
  if (!field) return null;

  collection.fields.removeById(field.id);

  app.save(collection);
});
