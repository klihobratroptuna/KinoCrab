migrate(
	(app) => {
		const collection = app.findCollectionByNameOrId('dorama_releases');

		// Kinopoisk id дорамы — чтобы на странице плеера работали источники, которые ищут
		// материал только по номеру фильма/сериала в Kinopoisk (Alloha и Collaps). У дорам
		// этого номера в самом источнике (doramatv) нет, поэтому id приносит Shikimori:
		// externalLinks вида https://www.kinopoisk.ru/series/382731/. Его разбирает
		// scripts/scrape-doramas.mjs (шаг --shikimori), пишет только скрапер.
		//
		// Пустое поле — дорамы нет в Kinopoisk: для такой плитки остаётся Kodik, который
		// находит её по id Shikimori (поле shikimoriId).
		collection.fields.add(new Field({ name: 'kinopoiskId', type: 'text' }));

		app.save(collection);
	},
	(app) => {
		const collection = app.findCollectionByNameOrId('dorama_releases');

		if (collection.fields.has('kinopoiskId')) {
			collection.fields.removeByName('kinopoiskId');
		}

		app.save(collection);
	}
);
