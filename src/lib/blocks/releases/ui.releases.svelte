<script>
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { browser } from '$app/environment';
	import { Button } from '$lib/elements/button';
	import { SeasonCarousel } from '$lib/blocks/seasonCarousel';
	import { DramaCarousel } from '$lib/blocks/dramaCarousel';
	import { MovieCarousel } from '$lib/blocks/movieCarousel';
	import { SeriesCarousel } from '$lib/blocks/seriesCarousel';

	// Один блок — четыре карусели: фильмы (снимок блока «Премьеры» на kinovibe), сериалы
	// (окно ±7 дней по выборке Kodik), аниме (снимок сезона AnimeGO) и дорамы (снимок блока
	// «Дорамы» на kinovibe). Все четыре читают PocketBase, потому что источники читаются в
	// браузере только через прокси nginx, и показывается сохранённый снимок выборки, а не
	// календарь.
	const TABS = [
		{ key: 'movies', label: 'Фильмы', title: 'Фильмы' },
		{ key: 'series', label: 'Сериалы', title: 'Сериалы' },
		{ key: 'anime', label: 'Аниме', title: 'Аниме' },
		{ key: 'dorama', label: 'Дорамы', title: 'Дорамы' }
	];

	// Страница, где живёт блок: на главной basePath = '/' — чтобы стрелки не уводили на /releases.
	export let basePath = '/releases';

	// Вкладка держится в URL, поэтому ссылку можно сохранить. Недели в URL больше нет:
	// календаря недели в блоке нет — фильмы, как аниме и дорамы, показываются каруселью,
	// и стрелок недели тут быть не должно.
	//
	// Reactive statement обязателен: кнопка вкладки делает goto, то есть меняет URL, и
	// только `$:` пересчитывает вкладку при таком изменении. Обычное присваивание один раз
	// оставило бы блок на прежней вкладке — переключение заработало бы только после
	// перезагрузки страницы, когда URL читается заново.
	let tab;
	$: tab = browser ? normalizeTab($page.url.searchParams.get('type')) : 'movies';

	function normalizeTab(value) {
		return TABS.some((item) => item.key == value) ? value : 'movies';
	}

	function url(tabKey) {
		// Фильмы — вкладка по умолчанию, поэтому для неё параметр не пишем.
		return tabKey == 'movies' ? basePath : `${basePath}?type=${tabKey}`;
	}
</script>

<!-- Переключатель каруселей стоит над панелью, на фоне страницы, а не внутри серой
	 подложки. -->
<div class="head">
	<div class="tabs">
		{#each TABS as item (item.key)}
			<Button
				dark
				nav
				toggle
				active={tab == item.key}
				title={item.title}
				on:click={() => goto(url(item.key))}
			>
				{item.label}
			</Button>
		{/each}
	</div>
</div>

<section class="releases">
	<!-- Стрелок недели и ссылки «В ленту» тут больше нет: фильмы листаются каруселью,
		 как аниме и дорамы, и стрелки у неё внутри блока. -->

	{#if tab == 'movies'}
		<MovieCarousel />
	{:else if tab == 'series'}
		<SeriesCarousel />
	{:else if tab == 'anime'}
		<SeasonCarousel />
	{:else}
		<DramaCarousel />
	{/if}
</section>

<style lang="scss">
	// Карусель — панель в том же языке, что и остальные поверхности: фон карточки,
	// тонкая линия, радиус 14.
	section {
		display: flex;
		flex-direction: column;
		gap: 16px;
		max-width: 1920px;
		margin: 0 40px 16px;
		padding: 14px 16px;
		align-self: stretch;
		border-radius: 14px;
		border: 1px solid var(--hairline, rgba(255, 255, 255, 0.08));
		background: var(--card, #16161a);
		box-shadow: none;

		@media (max-width: 768px) {
			margin: 0 16px 16px;
			padding: 14px;
		}
	}

	/* Строка переключателя теперь над панелью, на фоне страницы: те же отступы, что у
	   панели, без подложки. */
	.head {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 16px;
		max-width: 1920px;
		margin: 0 40px 12px;
		align-self: stretch;

		@media (max-width: 768px) {
			margin: 0 16px 10px;
			flex-wrap: wrap;
			gap: 8px;
		}
	}

	/* Переключатель без серой подложки: голые тексты в одну строку, активная
	   вкладка — белым, на наведении та же лёгкая заливка, что у остальных кнопок.
	   Кнопку рендерит ui.button.svelte, поэтому :global. */
	.tabs {
		display: inline-flex;
		flex-wrap: wrap;
		gap: 4px;

		:global(button.toggle) {
			flex-direction: row;
			width: auto;
			height: auto;
			justify-content: center;
			text-align: center;
		}

		// Активная вкладка отличается только цветом текста, без серой подложки.
		:global(button.toggle.active) {
			background: transparent;
		}

		@media (max-width: 768px) {
			gap: 2px;
		}
	}
</style>
