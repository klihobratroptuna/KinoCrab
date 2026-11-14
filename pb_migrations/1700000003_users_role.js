///
migrate(
	(app) => {
		const users = app.findCollectionByNameOrId('users');
		users.fields.add(
			new Field({
				name: 'role',
				type: 'text'
			})
		);
		app.save(users);
	},
	(app) => {
		const users = app.findCollectionByNameOrId('users');
		users.fields.removeByName('role');
		app.save(users);
	}
);
