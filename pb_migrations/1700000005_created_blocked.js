///
migrate(
	(app) => {
		const collection = new Collection({
			name: 'blocked',
			type: 'base',
			fields: [
				{
					name: 'film_id',
					type: 'relation',
					required: true,
					collectionId: app.findCollectionByNameOrId('films').id,
					maxSelect: 1,
					cascadeDelete: false
				},
				{
					name: 'reason',
					type: 'text'
				}
			]
		});
		app.save(collection);
	},
	(app) => {
		app.delete(app.findCollectionByNameOrId('blocked'));
	}
);
