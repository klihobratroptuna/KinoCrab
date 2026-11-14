/// <reference path="../pb_data/types.d.ts" />
// Поле rating для drama_carousel. Раньше оценки у дорам не было: блок показывал только
// строку серий, потому что источника оценки не было (ui.dramaCarousel.svelte, строка 14).
//
// Теперь оценку даёт Кинопоиск по номеру из строки Kodik. Замер 2026-11-04: отдельный путь
// v2.1/ratings отвечает 400 на любом id, поэтому оценку читаем из ответа v2.2/films/<id>
// (200), поля ratingKinopoisk и ratingImdb — тот же путь, что src/lib/shared/api/getFilm.js
// и filmCache. По дорамам lordserials.fan: 6648249 -> КП 8.6 (34226 голосов), IMDb 8.4;
// 9027270 -> 7.9/7.6; 8261500 -> 8.3/7.7; 4934994 -> 8.4/8.5.
//
// Поле текстовое, как в season_carousel: оценка может отсутствовать (у «Идеальной работы»
// номер 7791629... 7791628 отвечает с ratingKinopoisk null — тайтл новый), и числовое поле
// не различает «оценки нет» и ноль.
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_2449271769")

  if (collection.fields.getByName("rating")) return null

  const rating = new Field({
    "help": "Оценка: Кинопоиск по номеру из строки Kodik, иначе MyDramaList из material_data. Пустое — оценки нет.",
    "hidden": false,
    "id": "text1793800001",
    "name": "rating",
    "required": false,
    "system": false,
    "type": "text"
  })

  collection.fields.addAt(collection.fields.length, rating)

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_2449271769")

  const field = collection.fields.getByName("rating")

  if (!field) return null

  collection.fields.remove(field)

  return app.save(collection)
})
