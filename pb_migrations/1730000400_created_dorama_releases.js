migrate(
	(app) => {
		const collection = new Collection({
			name: 'dorama_releases',
			type: 'base',
			fields: [
				// Id элемента на источнике (из class="tile ... el_<id>" и data-id).
				{ name: 'doramatvId', type: 'text' },
				{ name: 'slug', type: 'text' },
				{ name: 'title', type: 'text' },
				{ name: 'poster', type: 'url' },
				{ name: 'date', type: 'date' },
				{ name: 'year', type: 'number' },
				{ name: 'status', type: 'text' },
				{ name: 'kind', type: 'text' },
				// Страница дорамы на источнике — наружу ведём только оттуда, внутренних
				// плееров у дорам нет (плееры проекта ищут по номеру Kinopoisk).
				{ name: 'sourceUrl', type: 'url' }
			],
			indexes: [
				'CREATE INDEX IF NOT EXISTS dorama_releases_doramatv_idx ON dorama_releases (doramatvId)',
				'CREATE INDEX IF NOT EXISTS dorama_releases_date_idx ON dorama_releases (date)'
			]
		});

		// Чтение публичное: вкладка «Дорамы» работает без авторизации.
		// Запись — только через скрипт-скрапер (superuser), правила на запись не открываем.
		collection.listRule = '';
		collection.viewRule = '';
		collection.createRule = null;
		collection.updateRule = null;
		collection.deleteRule = null;

		app.save(collection);
	},
	(app) => {
		app.delete(app.findCollectionByNameOrId('dorama_releases'));
	}
);
