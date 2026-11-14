<script>
	import { browser } from '$app/environment';
	import { page } from '$app/stores';
	import pb from '$lib/shared/pocketbase';
	import { CalendarIcon, ExternalIcon } from '$lib/shared/icons';
	import { formatRu, keyOf } from '$lib/shared/moscowDate';

	// Внутренняя страница карточки аниме: сюда ведут плитки календаря, у которых нет
	// kinopoiskId. Плитка с kinopoiskId ведёт прямо на /watch?id=... — там плеер, как у
	// фильма. Источники плеера (Alloha, Collaps, Kodik) ищут материал по номеру фильма в
	// Kinopoisk, по id Shikimori они ничего не находят, поэтому без kinopoiskId остаётся
	// карточка: постер, жанры, рейтинг, описание и даты серий из календаря.
	let record;
	let dates = [];
	let failed = false;
	let posterFailed = false;

	// id = shikimoriId из записей, date — день, с которого пришла плитка (для подсветки).
	$: id = browser ? $page.url.searchParams.get('id') : '';
	$: clicked = browser ? keyOf($page.url.searchParams.get('date') || '') : '';

	// Данные читает только браузер: PocketBase пишет серверный скрапер, а на prerender
	// запрос к PocketBase был бы обращён к localhost:8090, которого в сборке нет.
	$: if (browser && id) load(id);

	async function load(animeId) {
		failed = false;
		record = undefined;
		dates = [];

		try {
			// Строковые значения в фильтре PocketBase в одинарных кавычках: с двойными
			// фильтр работает как с плейсхолдерами параметров (тот же нюанс, что и в
			// scripts/scrape-anime.mjs).
			const list = await pb.collection('anime_releases').getFullList({
				filter: `shikimoriId='${animeId}'`,
				sort: '-date'
			});

			if (!list.length) {
				failed = true;
				return;
			}

			// Поля карточки есть в каждой записи этого аниме — берём самую свежую.
			record = list[0];
			dates = list
				.map((item) => ({ date: keyOf(item.date), episode: Number(item.episode || 0) }))
				.sort((a, b) => a.date.localeCompare(b.date));
		} catch (error) {
			console.error(error);
			failed = true;
		}
	}

	function genres(value) {
		return String(value || '')
			.split(',')
			.map((item) => item.trim())
			.filter(Boolean);
	}

	// Статус Shikimori переводим для человека: в записях он приходит как
	// ongoing / released / anons.
	const STATUS = { ongoing: 'выходит', released: 'вышло', anons: 'анонсировано' };

	function showStatus(value) {
		return STATUS[String(value || '').toLowerCase()] || value || '';
	}
</script>

<div class="page-anime">
	<section class="top">
		<h2>{record?.title || 'Карточка аниме'}<span>{record?.year || ''}</span></h2>
	</section>

	{#if failed}
		<div class="nothing">
			<CalendarIcon />
			<h3>Ничего не нашли</h3>
			<p>
				Страница читает PocketBase, поэтому карточка есть только для аниме, которое уже попало в
				календарь (сервис anime-sync). Проверьте id в ссылке или вернитесь к
				<a href="/releases?type=anime">календарю аниме</a>.
			</p>
		</div>
	{:else if !record}
		<p class="loader">Загрузка…</p>
	{:else}
		<section class="card">
			<div class="poster">
				{#if record.poster && !posterFailed}
					<img src={record.poster} alt="" on:error={() => (posterFailed = true)} />
				{:else}
					<span>{(record.title || record.titleEn || '?').trim().charAt(0).toUpperCase()}</span>
				{/if}
			</div>

			<div class="text">
				<h3>{record.title}</h3>
				{#if record.titleEn && record.titleEn != record.title}
					<p class="original">{record.titleEn}</p>
				{/if}

				<p class="meta">
					{[record.kind, record.year, showStatus(record.status)].filter(Boolean).join(' · ')}
					{#if record.score}
						<span class="score"> · рейтинг {record.score}</span>
					{/if}
				</p>

				{#if genres(record.genres).length}
					<p class="meta">{genres(record.genres).join(', ')}</p>
				{/if}

				<p class="meta">
					{#if record.episodesTotal}
						серий: {record.episodesTotal}
					{:else}
						серий: {record.episode} из неизвестного количества
					{/if}
				</p>

				<p class="desc">
					{record.description || 'Описания нет — Shikimori не прислал текст для этого аниме.'}
				</p>

				{#if dates.length}
					<h4>Даты релизов</h4>
					<ul>
						{#each dates as item (item.date)}
							<li class={item.date == clicked ? 'now' : ''}>
								<time>{formatRu(item.date, true)}</time>
								<span>{item.episode ? `серия ${item.episode}` : 'релиз'}</span>
							</li>
						{/each}
					</ul>
				{/if}

				{#if record.kinopoiskId}
					<a class="source" href={`/watch?id=${record.kinopoiskId}`}>Смотреть в плеере проекта</a>
				{/if}

				<a class="source" href={record.shikimoriUrl} rel="nofollow noopener">
					Карточка на Shikimori <ExternalIcon />
				</a>
			</div>
		</section>
	{/if}
</div>

<style lang="scss">
	.page-anime {
		display: flex;
		flex-direction: column;
		align-items: center;
		flex: 1 0 0;
		width: 100%;
	}

	.top {
		display: flex;
		max-width: 1920px;
		padding: 20px 40px;
		gap: 24px;
		align-items: center;
		align-self: stretch;

		@media (max-width: 768px) {
			flex: none;
			padding: 16px;
		}
	}

	h2 {
		font-weight: 700;
		font-size: 32px;
		line-height: 137%;
		color: var(--white);

		@media (max-width: 1024px) {
			display: flex;
			align-items: flex-start;
			justify-content: center;
			flex-direction: column;
			gap: 12px;
		}

		span {
			margin-left: 12px;
			color: var(--gray);

			@media (max-width: 1024px) {
				margin-left: 0;
				font-weight: 700;
				font-size: 16px;
				line-height: 125%;
			}
		}
	}

	.card {
		display: flex;
		max-width: 1920px;
		padding: 0 40px 40px;
		gap: 24px;
		align-self: stretch;

		@media (max-width: 768px) {
			flex-direction: column;
			padding: 0 16px 24px;
			gap: 16px;
		}
	}

	.poster {
		width: 260px;
		aspect-ratio: 2 / 3;
		flex: none;
		border-radius: 12px;
		border: 1px solid var(--hairline, rgba(255, 255, 255, 0.08));
		background: #121216;
		overflow: hidden;

		img {
			display: block;
			width: 100%;
			height: 100%;
			object-fit: cover;
		}

		span {
			display: flex;
			align-items: center;
			justify-content: center;
			width: 100%;
			height: 100%;
			font-weight: 700;
			font-size: 48px;
			color: var(--gray);
		}

		@media (max-width: 768px) {
			width: 180px;
		}
	}

	.text {
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 10px;

		h3 {
			font-weight: 600;
			font-size: 24px;
			letter-spacing: -0.01em;
			line-height: 135%;
			color: var(--white, #fff);
		}

		h4 {
			margin-top: 10px;
			font-weight: 600;
			font-size: 16px;
			letter-spacing: -0.01em;
			color: var(--white, #fff);
		}

		.original,
		.meta {
			font-weight: 400;
			font-size: 14px;
			line-height: 140%;
			color: var(--gray, #8b8f98);
		}

		.desc {
			font-weight: 400;
			font-size: 15px;
			line-height: 155%;
			color: var(--white, #fff);
			white-space: pre-wrap;
		}

		.score {
			color: var(--white, #fff);
		}

		ul {
			list-style: none;
			display: grid;
			grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
			gap: 8px;

			li {
				display: flex;
				justify-content: space-between;
				gap: 10px;
				padding: 8px 12px;
				border: 1px solid var(--hairline, rgba(255, 255, 255, 0.08));
				border-radius: 10px;
				background: var(--card, #16161a);

				&.now {
					border-color: var(--hairline-hi, rgba(255, 255, 255, 0.14));
					background: var(--card-hi, #1b1b21);

					span {
						color: var(--white, #fff);
					}
				}

				span {
					color: var(--gray, #8b8f98);
				}
			}
		}

		.source {
			margin-top: 12px;
			display: inline-flex;
			align-items: center;
			gap: 8px;
			font-weight: 500;
			font-size: 14px;
			color: var(--gray, #8b8f98);
			text-decoration: none;

			transition: color ease 0.25s;

			@include hover {
				color: var(--white, #fff);
			}
		}
	}

	.nothing {
		max-width: 1920px;
		padding: 0 40px 40px;
		align-self: stretch;

		@media (max-width: 768px) {
			padding: 0 16px 24px;
		}

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

	.loader {
		font-weight: 400;
		font-size: 14px;
		line-height: 160%;
		color: var(--gray);
	}
</style>
