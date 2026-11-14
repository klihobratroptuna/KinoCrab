<script>
	import { afterNavigate } from '$app/navigation';
	import { resetSessionCheck } from '$lib/shared/auth';
	import { Layout } from '$lib/pages/(global)/layout';

	// Проверка входа кэшируется на одну загрузку страницы (см. src/lib/shared/auth/index.js).
	// Сброс здесь: afterNavigate работает только внутри компонента, а auth — обычный модуль.
	afterNavigate(() => resetSessionCheck());
</script>

<Layout>
	<slot />
</Layout>
