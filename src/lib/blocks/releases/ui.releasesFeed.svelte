<script>
	import { onMount, onDestroy } from 'svelte';
	import { browser } from '$app/environment';
	import pb from '$lib/shared/pocketbase';
	import { ReleaseTile } from '$lib/elements/release';
	import { Button } from '$lib/elements/button';
	import { CalendarIcon, RefreshIcon } from '$lib/shared/icons';
	import { keyOf, todayKey } from '$lib/shared/moscowDate';

	// 10 плиток в ряд, подгружаем по три ряда (30 релизов) при прокрутке.
	const PER_PAGE = 30;
	// Запас по краям экрана: следующая страница грузится раньше, чем пользователь
	// упирается в конец ленты.
	const ROOT_MARGIN = 300;

	let items;
	let page = 1;
	let hasMore = false;
	let loading = false;
	let refreshing = false;
	let archive = false;
	let unsubscribe;
	let observer;
	let sentinel;
	// Заглушка видна экрану сейчас. IntersectionObserver сообщает только об изменении
	// состояния, поэтому без этого флага невозможно понять, что контента меньше экрана.
	let sentinelVisible = false;

	// Остаток суточной квоты API ПоискКино на страницу больше не показываем: синк
	// по-прежнему получает свою часть, но на экране об этом ничего не пишут.

	// Лента всегда начинается с текущей даты — дата по Москве (Europe/Moscow),
	// независимо от часового пояса браузера посетителя. Даты сравниваем как строки YYYY-MM-DD.
	function today() {
		return todayKey();
	}

	function dateKey(value) {
		return keyOf(value);
	}

	function matches(record) {
		const day = dateKey(record.date);
		if (!day) return false;
		const start = today();
		return archive ? day < start : day >= start;
	}

	function sortReleases(list) {
		return [...list].sort((a, b) => {
			const left = dateKey(a.date);
			const right = dateKey(b.date);
			if (left == right) return String(a.title || '').localeCompare(String(b.title || ''));
			return archive ? right.localeCompare(left) : left.localeCompare(right);
		});
	}

	function sortParam() {
		return archive ? '-date' : 'date';
	}

	function filterParam() {
		const start = today();
		return archive ? `date < "${start}"` : `date >= "${start}"`;
	}

	onMount(() => {
		if (!browser) return;

		subscribe();

		// Бесконечная лента: как только упёрлись в нижнюю заглушку — подгружаем следующую страницу.
		observer = new IntersectionObserver(
			(entries) => {
				sentinelVisible = entries.some((entry) => entry.isIntersecting);
				if (sentinelVisible) fillViewport();
			},
			{ rootMargin: `${ROOT_MARGIN}px 0px` }
		);

		if (sentinel) observer.observe(sentinel);

		load();
	});

	onDestroy(() => {
		if (observer) observer.disconnect();
		if (unsubscribe) unsubscribe();
	});

	// Подписка на Realtime API PocketBase: лента меняется без перезагрузки страницы,
	// когда фоновый скрапер (сервис release-sync) дописал или обновил релиз.
	async function subscribe() {
		try {
			unsubscribe = await pb.collection('releases').subscribe('*', (event) => {
				// PocketBase 0.40 отдаёт запись в поле record (в старых версиях — data).
				const record = event.record || event.data;
				if (!record || !items || !matches(record)) return;

				if (event.action == 'delete') {
					items = items.filter((item) => item.id != record.id);
					return;
				}

				const index = items.findIndex((item) => item.id == record.id);

				if (index >= 0) {
					items = items.map((item) => (item.id == record.id ? record : item));
				} else {
					items = sortReleases([...items, record]);
				}
			});
		} catch (error) {
			console.error(error);
		}
	}

	async function fetchPage(target) {
		return pb.collection('releases').getList(target, PER_PAGE, {
			filter: filterParam(),
			sort: sortParam()
		});
	}

	async function load() {
		if (loading) return;
		loading = true;
		page = 1;

		try {
			const result = await fetchPage(page);
			hasMore = result.page < result.totalPages;
			items = result.items;
		} catch (error) {
			console.error(error);
			if (!items) items = [];
		}

		loading = false;
		await fillViewport();
	}

	async function loadMore() {
		if (loading || !hasMore || !items) return;
		loading = true;

		try {
			const result = await fetchPage(page + 1);
			const known = new Set(items.map((item) => item.id));
			items = [...items, ...result.items.filter((item) => !known.has(item.id))];
			page = result.page;
			hasMore = page < result.totalPages;
		} catch (error) {
			console.error(error);
		}

		loading = false;
	}

	// Одна подгрузка не повторяется сама: IntersectionObserver сообщает только об
	// изменении состояния. Если экран вмещает меньше 30 плиток, заглушка остаётся
	// видимой и событий больше не будет — поэтому проверяем её видность вручную.
	async function fillViewport() {
		for (let guard = 0; guard < 12 && hasMore && items && !loading && sentinelOnScreen(); guard++) {
			await loadMore();
		}
	}

	function sentinelOnScreen() {
		if (sentinelVisible) return true;
		if (!sentinel) return false;
		return sentinel.getBoundingClientRect().top < window.innerHeight + ROOT_MARGIN;
	}

	async function refresh() {
		if (refreshing) return;
		refreshing = true;
		await load();
		refreshing = false;
	}

	function showArchive() {
		if (archive) return;
		archive = true;
		items = undefined;
		load();
	}

	function showFeed() {
		if (!archive) return;
		archive = false;
		items = undefined;
		load();
	}
</script>

<section class="feed">
	<div class="top">
		<h2>
			<CalendarIcon />
			{archive ? 'Архив релизов' : 'Лента релизов'}
		</h2>
		<div class="nav">
			<Button toggle dark active={!archive} title="Релизы начиная с сегодняшнего дня" on:click={showFeed}>
				Лента
			</Button>
			<Button toggle dark active={archive} title="Релизы раньше сегодняшнего дня" on:click={showArchive}>
				Архив релизов
			</Button>
			<Button circle dark nav title="Обновить ленту" on:click={refresh}>
				<RefreshIcon />
			</Button>
		</div>
	</div>

	{#if !items}
		<p class="loader">Загрузка…</p>
	{:else if items.length}
		<ul>
			{#each items as release (release.id)}
				<li>
					<ReleaseTile {release} />
				</li>
			{/each}
		</ul>
	{:else}
		<div class="nothing">
			<CalendarIcon />
			<h3>Пусто</h3>
			<p>{archive ? 'В архиве пока нет релизов.' : 'С сегодняшнего дня релизов нет — смотрите архив.'}</p>
		</div>
	{/if}

	<div class="sentinel" bind:this={sentinel}>
		{#if loading}
			<p class="loader">Подгружаем…</p>
		{:else if hasMore}
			<p class="loader">Листай дальше — подгрузим ещё {PER_PAGE} релизов.</p>
			<Button dark nav title="Подгрузить следующую страницу" on:click={loadMore}>
				Подгрузить ещё {PER_PAGE}
			</Button>
		{:else if items && items.length}
			<p class="loader">Больше релизов нет.</p>
		{/if}
	</div>
</section>

<style lang="scss">
	section {
		display: flex;
		flex-direction: column;
		gap: 20px;
		max-width: 1920px;
		padding: 20px 40px;
		align-self: stretch;

		@media (max-width: 768px) {
			padding: 16px;
		}
	}

	.top {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		flex-wrap: wrap;
	}

	h2 {
		display: flex;
		align-items: center;
		gap: 10px;
		font-weight: 700;
		font-size: 20px;
		line-height: 130%;
		color: var(--white, #fff);
	}

	.nav {
		display: flex;
		align-items: center;
		gap: 12px;
	}

	ul {
		display: grid;
		grid-template-columns: repeat(10, minmax(0, 1fr));
		align-items: flex-start;
		list-style: none;
		gap: 12px;

		li {
			display: flex;
			/* Без этого заголовки в одну строку растягивают колонки и лента выходит за край вёрстки. */
			min-width: 0;
		}

		@media (max-width: 1500px) {
			grid-template-columns: repeat(8, 1fr);
		}

		@media (max-width: 1200px) {
			grid-template-columns: repeat(6, 1fr);
		}

		@media (max-width: 1024px) {
			grid-template-columns: repeat(5, 1fr);
		}

		@media (max-width: 768px) {
			grid-template-columns: repeat(3, 1fr);
		}

		@media (max-width: 480px) {
			grid-template-columns: repeat(2, 1fr);
		}
	}

	.loader {
		font-weight: 400;
		font-size: 14px;
		line-height: 160%;
		color: var(--gray);
	}

	.sentinel {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		flex-wrap: wrap;
	}

	.nothing {
		h3 {
			font-weight: 700;
			font-size: 18px;
			line-height: 135%;
			color: var(--white, #fff);
		}

		p {
			font-weight: 400;
			font-size: 14px;
			line-height: 160%;
			color: var(--gray);
		}
	}
</style>
