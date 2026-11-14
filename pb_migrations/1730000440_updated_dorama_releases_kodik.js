migrate(
	(app) => {
		const collection = app.findCollectionByNameOrId('dorama_releases');

		// Id записи Kodik (вид serial-77852). У дорам нет номера фильма в Kinopoisk, поэтому
		// Alloha и Collaps их не находят, а Kodik находит дораму только по названию: id из
		// результата поиска — это единственный путь к плееру для дорам без записи Shikimori.
		// get-player по этому id отвечает и по публичному токену плеера (проверено запросом),
		// поэтому поиск нужен только скраперу, а не странице.
		collection.fields.add(new Field({ name: 'kodikId', type: 'text' }));

		// Как именно нашли запись Kodik: совпало имя из списка, оригинальное название, имя без
		// номера сезона или это единственный результат. Плюс отметка, что Kodik проверили и
		// записи нет — иначе каждый цикл искал бы дораму заново.
		collection.fields.add(new Field({ name: 'kodikNote', type: 'text' }));

		app.save(collection);
	},
	(app) => {
		const collection = app.findCollectionByNameOrId('dorama_releases');

		if (collection.fields.has('kodikId')) {
			collection.fields.removeByName('kodikId');
		}

		if (collection.fields.has('kodikNote')) {
			collection.fields.removeByName('kodikNote');
		}

		app.save(collection);
	}
);
