migrate(
	(app) => {
		const collection = app.findCollectionByNameOrId('dorama_releases');

		// Оригинальное название — фактическое поле карточки источника («Оригинальное
		// название», например Ribaiasan). Оно нужно для поиска на Shikimori: русское имя
		// дорамы часто не совпадает с названием в его базе, и по оригинальному имени
		// совпадений больше. Описание карточки скрипт по-прежнему не читает и не хранит.
		collection.fields.add(new Field({ name: 'originalTitle', type: 'text' }));

		// Как именно нашли совпадение: имя источника, оригинальное название, имя без номера
		// сезона или единственный результат. Это видно на странице плеера, чтобы спортивное
		// совпадение не выглядело надёжным.
		collection.fields.add(new Field({ name: 'matchNote', type: 'text' }));

		app.save(collection);
	},
	(app) => {
		const collection = app.findCollectionByNameOrId('dorama_releases');

		if (collection.fields.has('originalTitle')) {
			collection.fields.removeByName('originalTitle');
		}

		if (collection.fields.has('matchNote')) {
			collection.fields.removeByName('matchNote');
		}

		app.save(collection);
	}
);
