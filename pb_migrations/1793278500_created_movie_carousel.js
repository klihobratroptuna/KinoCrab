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
        "help": "Идентификатор карточки в адресе источника (/film/<id>).",
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
        "help": "Оценка Kinopoisk, строка вида «7.4». Пустая, пока оценки нет — карточка тогда без строки оценки.",
        "hidden": false,
        "id": "text1996625596",
        "max": 0,
        "min": 0,
        "name": "rating",
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
        "help": "Номер фильма в Kinopoisk по точному совпадению названия; пусто, если тайтла там нет.",
        "hidden": false,
        "id": "text1874843240",
        "max": 0,
        "min": 0,
        "name": "kinopoiskId",
        "pattern": "",
        "presentable": false,
        "primaryKey": false,
        "required": false,
        "system": false,
        "type": "text"
      },
      {
        "autogeneratePattern": "",
        "help": "Идентификатор Kodik (movie-... или foreign-movie-...), найденный по названию, когда номера фильма нет.",
        "hidden": false,
        "id": "text2342255404",
        "max": 0,
        "min": 0,
        "name": "kodikId",
        "pattern": "",
        "presentable": false,
        "primaryKey": false,
        "required": false,
        "system": false,
        "type": "text"
      }
    ],
    "id": "pbc_1653049656",
    "indexes": [
      "CREATE INDEX IF NOT EXISTS EX_movie_carousel_day ON movie_carousel (day)"
    ],
    "listRule": "",
    "name": "movie_carousel",
    "system": false,
    "type": "base",
    "updateRule": "",
    "viewRule": ""
  });

  return app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_1653049656");

  return app.delete(collection);
})
