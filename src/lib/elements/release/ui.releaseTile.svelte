<script>
	import { formatRu, keyOf } from '$lib/shared/moscowDate';
	import { posterUrl } from '$lib/shared/doramaPoster';

	export let release;

	// Дата берётся из значения PocketBase как строка YYYY-MM-DD, поэтому она одна
	// для всех посетителей — московская, без сдвига по часовому поясу браузера.
	function showDate(value) {
		const key = keyOf(value);
		return key ? formatRu(key) : '';
	}

	// Плитка ведёт внутрь проекта: фильм — на /watch?id=..., аниме — тоже на /watch, но там
	// его ищут плееры. Номер фильма в Kinopoisk нужен Alloha и Collaps, поэтому когда он
	// известен — идём прямо по нему, иначе по id Shikimori: там аниме ищет Kodik (по id или
	// по названию записи), но только по личному токену из .env. Дату серии держим в адресе,
	// чтобы с плеера можно было попасть на карточку календаря в нужный день. Наружу
	// (на Shikimori) ведём только если внутренней страницы построить нельзя — без id.
	// Дорамы тоже ведут на /watch: внутренней страницы у них нет, а плееры ищут материал по
	// номеру фильма в Kinopoisk — у дорам этого номера нет. Там играет Kodik: по id своей
	// записи (поле kodikId, его пишет скрапер --fill-kodik), по id Shikimori или по названию.
	// Поиск по названию нужен только скраперу: он работает по токену из .env, а страница
	// играет по уже записанному id без поиска.
	$: dayKey = keyOf(release.date);
	$: href = release.kinopoiskId
		? `/watch?id=${release.kinopoiskId}`
		: release.shikimoriId
			? `/watch?id=${release.shikimoriId}&type=anime${dayKey ? `&date=${dayKey}` : ''}`
			: release.doramatvId
				? `/watch?id=${release.doramatvId}&type=dorama${dayKey ? `&date=${dayKey}` : ''}`
				: release.sourceUrl || release.shikimoriUrl || '';
	// Ссылка наружу — только случай без id: внутренние ссылки всегда относительные.
	$: external = /^https?:/i.test(href);
	// Постер дорамы грузим через прокси: CDN источника отвечает 403 на наш referer.
	$: poster = posterUrl(release);
	// Постер может отсутствовать (API без постера) или не загрузиться — показываем заглушку.
	let failed = false;

	$: fallback = (release.title || release.titleEn || '?').trim().charAt(0).toUpperCase();
</script>

<svelte:element
	this={href ? 'a' : 'div'}
	class="card"
	class:clickable={!!href}
	href={href || undefined}
	target={external ? '_blank' : undefined}
	rel={external ? 'nofollow noopener' : undefined}
	title={release.title}
>
	<div class="poster">
		{#if poster && !failed}
			<img src={poster} alt="" loading="lazy" inert on:error={() => (failed = true)} />
		{:else}
			<span>{fallback}</span>
		{/if}
	</div>
	<div class="text">
		<h3>{release.title}</h3>
		<time>{showDate(release.date)}</time>
		<!-- У аниме показываем ещё номер серии, которая выходит в этот день. -->
		{#if release.episode}
			<span class="episode">серия {release.episode}</span>
		{/if}
	</div>
</svelte:element>

<style lang="scss">
	.card {
		display: flex;
		flex-direction: column;
		gap: 10px;
		width: 100%;
		min-width: 0;
		/* Плитка по высоте контента: пустого места под датой нет. */
		align-self: flex-start;
		border: 1px solid var(--hairline, rgba(255, 255, 255, 0.08));
		border-radius: 12px;
		padding: 12px;
		background: var(--card, #16161a);
		user-select: none;

		transition: all ease 0.25s;

		@include hover {
			&.clickable {
				background: var(--card-hi, #1b1b21);

				h3 {
					color: var(--white, #fff);
				}
			}
		}
	}

	/* Постер всегда в одной рамке 2:3 — поэтому все плитки одинакового размера. */
	.poster {
		aspect-ratio: 2 / 3;
		min-width: 0;
		border-radius: 10px;
		border: 1px solid var(--hairline, rgba(255, 255, 255, 0.08));
		background: #121216;
		overflow: hidden;

		img {
			display: block;
			width: 100%;
			height: 100%;
			object-fit: cover;
		}

		/* Заглушка, когда постера нет или картинка не загрузилась. */
		span {
			display: flex;
			align-items: center;
			justify-content: center;
			width: 100%;
			height: 100%;
			font-weight: 700;
			font-size: 28px;
			color: var(--gray);
		}
	}

	.text {
		min-width: 0;

		/* Номер серии — только для аниме-плиток, у фильмов поля нет. */
		.episode {
			font-weight: 400;
			font-size: 14px;
			line-height: 130%;
			color: var(--gray);
		}
	}

	h3 {
		font-weight: 600;
		font-size: 15px;
		letter-spacing: -0.01em;
		line-height: 135%;
		color: var(--white, #fff);
		text-overflow: ellipsis;
		white-space: nowrap;
		overflow: hidden;

		transition: color ease 0.25s;
	}

	time {
		font-weight: 400;
		font-size: 13px;
		line-height: 130%;
		color: var(--gray-soft, #6a6e77);
	}
</style>
