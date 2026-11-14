/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = new Collection({
    "createRule": "",
    "deleteRule": "",
    "fields": [
      {
        "autogeneratePattern": "[a-z0-9]{15}",
        "help": "",
        "hidden": false,
        "id": "text3208210256",
        "max": 15,
        "min": 15,
        "name": "id",
        "pattern": "^[a-z0-9]+$",
        "presentable": false,
        "primaryKey": true,
        "required": true,
        "system": true,
        "type": "text"
      },
      {
        "autogeneratePattern": "",
        "help": "День снимка в московской дате (YYYY-MM-DD). Показываем только последний день.",
        "hidden": false,
        "id": "text1186403937",
        "max": 0,
        "min": 0,
        "name": "day",
        "pattern": "",
        "presentable": false,
        "primaryKey": false,
        "required": true,
        "system": false,
        "type": "text"
      },
      {
        "help": "Позиция карточки в карусели источника, от 1.",
        "hidden": false,
        "id": "number2161764012",
        "max": null,
        "min": null,
        "name": "pos",
        "onlyInt": false,
        "presentable": false,
        "required": false,
        "system": false,
        "type": "number"
      },
      {
        "autogeneratePattern": "",
        "help": "Идентификатор карточки в адресе источника (/series/<id>).",
        "hidden": false,
        "id": "text1612316607",
        "max": 0,
        "min": 0,
        "name": "kinovibeId",
        "pattern": "",
        "presentable": false,
        "primaryKey": false,
        "required": false,
        "system": false,
        "type": "text"
      },
      {
        "autogeneratePattern": "",
        "help": "",
        "hidden": false,
        "id": "text724990059",
        "max": 0,
        "min": 0,
        "name": "title",
        "pattern": "",
        "presentable": false,
        "primaryKey": false,
        "required": false,
        "system": false,
        "type": "text"
      },
      {
        "autogeneratePattern": "",
        "help": "Строка серий из карточки источника, например «1-5 Серия из 32».",
        "hidden": false,
        "id": "text3100301471",
        "max": 0,
        "min": 0,
        "name": "episode",
        "pattern": "",
        "presentable": false,
        "primaryKey": false,
        "required": false,
        "system": false,
        "type": "text"
      },
      {
        "exceptDomains": [],
        "help": "",
        "hidden": false,
        "id": "url762383602",
        "name": "poster",
        "onlyDomains": [],
        "presentable": false,
        "required": false,
        "system": false,
        "type": "url"
      },
      {
        "autogeneratePattern": "",
        "help": "",
        "hidden": false,
        "id": "text1061607967",
        "max": 0,
        "min": 0,
        "name": "sourceUrl",
        "pattern": "",
        "presentable": false,
        "primaryKey": false,
        "required": false,
        "system": false,
        "type": "text"
      },
      {
        "autogeneratePattern": "",
        "help": "Запись календаря дорам, если тайтл в ней есть; иначе пусто.",
        "hidden": false,
        "id": "text3561911627",
        "max": 0,
        "min": 0,
        "name": "doramatvId",
        "pattern": "",
        "presentable": false,
        "primaryKey": false,
        "required": false,
        "system": false,
        "type": "text"
      },
      {
        "autogeneratePattern": "",
        "help": "Идентификатор Kodik (serial-... или movie-...), найденный по названию.",
        "hidden": false,
        "id": "text2342255404",
        "max": 0,
        "min": 0,
        "name": "kodikId",
        "pattern": "",
        "presentable": false,
        "required": false,
        "system": false,
        "type": "text"
      }
    ],
    "id": "pbc_2449271769",
    "indexes": [
      "CREATE INDEX IF NOT EXISTS EX_idx ON drama_carousel (day)"
    ],
    "listRule": "",
    "name": "drama_carousel",
    "system": false,
    "type": "base",
    "updateRule": "",
    "viewRule": ""
  });

  return app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_2449271769");

  return app.delete(collection);
})
