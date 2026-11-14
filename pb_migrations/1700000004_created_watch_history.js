///
migrate(
	(app) => {
		const collection = new Collection({
			name: 'watch_history',
			type: 'base',
			fields: [
				{
					name: 'user',
					type: 'relation',
					required: true,
					collectionId: app.findCollectionByNameOrId('users').id,
					maxSelect: 1,
					cascadeDelete: false
				},
				{
					name: 'film_id',
					type: 'relation',
					required: true,
					collectionId: app.findCollectionByNameOrId('films').id,
					maxSelect: 1,
					cascadeDelete: false
				},
				{
					name: 'lastviewed',
					type: 'date'
				}
			]
		});
		app.save(collection);
	},
	(app) => {
		app.delete(app.findCollectionByNameOrId('watch_history'));
	}
);
