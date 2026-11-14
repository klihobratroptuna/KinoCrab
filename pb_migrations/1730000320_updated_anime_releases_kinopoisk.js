migrate(
	(app) => {
		const collection = app.findCollectionByNameOrId('anime_releases');

		// Kinopoisk id аниме — чтобы плитка календаря открывала ту же страницу плеера,
		// что и плитка фильма (/watch?id=...): источники игроков ищут материалы по номеру
		// фильма в Kinopoisk, по id Shikimori они ничего не находят.
		//
		// typeWeb у Shikimori нет (проверено introspection'ом), но есть externalLinks,
		// где вид kind == "kinopoisk" содержит ссылку вида
		// https://www.kinopoisk.ru/series/382731/. Её и разбирает scripts/scrape-anime.mjs.
		// Пустое поле означает, что аниме нет в Kinopoisk: для таких плиток остаётся
		// внутренняя карточка /anime?id=...
		collection.fields.add(new Field({ name: 'kinopoiskId', type: 'text' }));

		app.save(collection);
	},
	(app) => {
		const collection = app.findCollectionByNameOrId('anime_releases');

		if (collection.fields.has('kinopoiskId')) {
			collection.fields.removeByName('kinopoiskId');
		}

		app.save(collection);
	}
);
