<script>
	import watchHistory from '$lib/shared/scripts/watchHistory';
	import { goto } from '$app/navigation';
	import { ArrowIcon, DeleteIcon } from '$lib/shared/icons';
	import { onMount } from 'svelte';
	import { apiGetFilm } from '$lib/shared/api';
	import viewportObserver from '$lib/shared/scripts/viewportObserver';
	import filmCache from '$lib/shared/scripts/filmCache';
	import { cardDoc, cachedCard } from '$lib/shared/poiskkino';
	import { isKodikId, isKinopoiskId } from '$lib/shared/kodik';

	export let canDelete = false;
	export let film;
	let rating = film.rating || film.ratingKinopoisk;
	let problem = '';

	// Запасные данные от API ПоискКино: постер с яндексового CDN и платформы, где тайтл
	// смотрят официально. Берём из кэша, если тайтл уже запрашивали; иначе один запрос,
	// и только когда квота позволяет (запас для суточного синка, см. poiskkino.js).
	let alt = null;
	let posterTried = false;

	// Пока постер не ошибся, показываем основной адрес. После ошибки — яндексовский CDN,
	// иначе запасной постер никогда не выйдет на экран: первое значение тут всегда важнее.
	$: poster = posterTried && alt?.posterPreview
		? alt.posterPreview
		: film.posterUrlPreview || film.posterUrl || alt?.posterPreview || '';
	$: platforms = alt?.platforms || [];

	function filmId() {
		return film.film_id || film.filmId || film.kinopoiskId || film.id;
	}

	// Ссылка только когда чем открыть: числовой номер Kinopoisk или id записи Kodik.
	// Карточку, которую резерв поиска нашёл по одному имени и без плеера, наружу не ведём —
	// по правилу она остаётся внутренней, и href у неё отсутствует.
	//
	// Карточку передаём аргументом, а не читаем переменную внутри: выражение шаблона
	// пересобирается только по именам, которые читает напрямую. Год и тип приходят из
	// Kinopoisk после первого рендера — карточка запрашивает их, когда попадает в экран,
	// и без аргумента ссылка осталась бы собранной из неполных данных (замер 2026-11-11:
	// href карточки «Очень странные дела» был без type=series, хотя тип на ней уже
	// показывался).
	function cardHref(card) {
		if (card.link) return card.link;

		const id = card.film_id || card.filmId || card.kinopoiskId || card.id;

		if (!isKinopoiskId(id) && !isKodikId(id)) return '';

		// Карточка блока «Связанное»: в ответе endpoint есть только номер в Kinopoisk,
		// года, типа и признаков плеера в нём нет. Раньше из-за этого карточка оставалась
		// без ссылки, и клик по ней неёл никуда (замер 2026-11-11 на странице «Институт»:
		// у карточки «Очень странные дела» href отсутствовал). Страница поиска при этом
		// ведёт наружу по любому числовому номеру, и страница /watch сама проверяет плеер
		// по этому номеру — отказ был только здесь, и это разнобой. Теперь карточка
		// ведёт на плеер, а проверка происходит там, где она и была: на открытой странице,
		// без лишнего запроса на каждую карточку списка.
		//
		// Имя в адрес передаём, потому что при неудаче по номеру страница /watch ищет
		// запись по имени карточки. Режим добавляем, когда тип уже известен: для сериала
		// он меняет фильтр типа в том поиске по имени.
		const title = card.nameRu ? `&title=${encodeURIComponent(card.nameRu)}` : '';
		const mode = card.type === 'TV_SERIES' || card.type === 'MINI_SERIES' ? '&type=series' : '';

		return isKinopoiskId(id) ? `/watch?kp=${id}${mode}${title}` : `/watch?id=${id}${mode}${title}`;
	}

	function deleteHandler() {
		watchHistory.remove(film);
		goto('');
	}

	function reletionType(type) {
		switch (type) {
			case 'SIMILAR':
				return 'Похожее';
			case 'SEQUEL':
				return 'Продолжение';
			case 'PREQUEL':
				return 'Предыстория';
			case 'VERSION':
				return 'Версия фильма';
			case 'SPIN_OFF':
				return 'Спин-офф';
			case 'SPUN_OFF_FROM':
				// Обратное направление: карточка — первоисточник, а текущий тайтл вышел из него.
				return 'Первоисточник спин-оффа';
			case 'REMAKE':
				return 'Ремейк';
			case 'SPOOFED':
				return 'Пародия';
			case 'SPOOFS':
				return 'Пародия';
			default:
				return type;
		}
	}

	function showType(type) {
		switch (type) {
			case 'FILM':
				return 'Фильм';
			case 'TV_SERIES':
				return 'Сериал';
			case 'MINI_SERIES':
				return 'Мини-сериал';
			case 'VIDEO':
				return 'Короткометражка';
			default:
				return type;
		}
	}

	async function getResource(){
		if (film.description) {
			return;
		}

		// Карточку резерва не просим у Kinopoisk: резерв включился именно потому, что
		// Kinopoisk не ответил, и запрос на каждую карточку только замедлил бы страницу.
		if (film.fromFallback) {
			return;
		}

		const id = filmId();

		// Сначала кэш: если карточку уже получали, второй запрос к API не нужен. Источник
		// отвечает нестабильно, и без кэша карточка оставалась пустой — это и видно
		// в списке «Смотрю»: undefined вместо названия и битый постер.
		const cached = filmCache.get(id);

		if (cached) {
			film = { ...film, ...cached };
			rating = film.rating || film.ratingKinopoisk;
			return;
		}

		try {
			// Один запрос на id, а не на карточку: очередь отдаёт тот же результат
			// всем карточкам с этим id (запись может быть и в «Смотрю», и в «Похожем»),
			// и не пускает больше четырёх запросов одновременно.
			const moreInfo = await filmCache.load(id, apiGetFilm);

			if (moreInfo.failed) {
				problem = `Kinopoisk ${moreInfo.reason || 'не ответил'} — данных нет, id ${id}`;
				return;
			}

			film = { ...film, ...moreInfo };
			rating = film.rating || film.ratingKinopoisk;
			filmCache.set(id, film);
		} catch (error) {
			problem = `Kinopoisk API не ответил (${error?.message || 'сеть'}) — данных нет, id ${id}`;
			console.error(error);
		}
	}

	// Один запрос на тайтл, и только когда он ещё не в кэше и квота позволяет. Ответ
	// кэшируется в localStorage, поэтому повторный визит на страницу запрос не делает.
	async function getExtra() {
		const id = filmId();

		// Только числовой номер Kinopoisk: id записи Kodik (movie-111996) этому API не
		// подходит, и запрос с ним был бы просто потерей квоты.
		if (!id || !isKinopoiskId(id)) return;

		const hit = cachedCard(id);

		if (hit) {
			alt = hit;
			return;
		}

		const doc = await cardDoc(id);

		if (doc && !doc.failed) alt = doc;
	}

	// Постер берём с kinopoiskapiunofficial.tech, и этот хост в браузере ловит обрыв
	// соединения. При ошибке картинки пробуем адрес того же постера с яндексового CDN
	// (300x450) — он отвечает стабильнее, потому что это другой маршрут.
	async function posterFallback() {
		if (posterTried) return;

		posterTried = true;
		await getExtra();
	}

	async function loadCard() {
		await getResource();
		await getExtra();
	}
</script>

<a
	use:viewportObserver
	on:enterViewport={loadCard}
	href={cardHref(film) || undefined}
>
	<li>
		{#if poster}
			<img src={poster} alt="Постер" loading="lazy" inert on:error={posterFallback} />
		{:else}
			<div class="no-poster">постера нет</div>
		{/if}
		<div class="text">
			<h3 title={film.nameRu || film.nameEn || film.nameOriginal || `Фильм ${filmId()}`}>
				{film.nameRu || film.nameEn || film.nameOriginal || `Фильм ${filmId()}`}
			</h3>
			<time>{film.year || ''}</time>
			<kbd>{showType(film.type) || ''}</kbd>
			{#if film.relationType}
				<kbd>{reletionType(film.relationType) || ''}</kbd>
			{/if}
			<p title={film.description || problem || ''}>
				{film.description || problem || ''}
			</p>
			{#if platforms.length}
				<div class="watch-on" title="Где тайтл смотрят официально">
					Смотрят официально: {platforms.join(', ')}
				</div>
			{/if}
			<div>
				{#if rating > 0}
					<mark class:okey={rating > 3.9 && rating < 7} class:bad={rating < 4}>
						{rating || ''}
					</mark>
				{:else}
					<span></span>
				{/if}
			</div>
		</div>
		<div class="actions">
			{#if canDelete}
				<button class="delete" on:click|preventDefault={deleteHandler} title="Удалить">
					<DeleteIcon />
				</button>
			{/if}
			<div class="arrow">
				<ArrowIcon />
			</div>
		</div>
	</li>
</a>

<style lang="scss">
	a {
		min-width: 0;
	}

	li {
		display: flex;
		gap: 12px;
		border: 1px solid var(--hairline, rgba(255, 255, 255, 0.08));
		border-radius: 12px;
		padding: 20px;
		background: var(--card, #16161a);
		transition: all 0.25s ease;
		user-select: none;

		&:hover:not(:has(.delete:hover)) {
			background: var(--card-hi, #1b1b21);
			border-color: var(--hairline-hi, rgba(255, 255, 255, 0.14));

			h3 {
				color: var(--white, #fff);
			}

			.arrow {
				:global(svg path) {
					stroke: var(--white, #fff);
				}
			}
		}

		@media (max-width: 768px) {
			padding: 16px;
		}
	}

	img {
		border-radius: 10px;
		min-width: 150px;
		height: 200px;
		object-fit: cover;

		@media (max-width: 768px) {
			border-radius: 4px;
			min-width: 80px;
			height: 86px;
		}
	}

	.no-poster {
		display: flex;
		align-items: center;
		justify-content: center;
		min-width: 150px;
		height: 200px;
		border-radius: 8px;
		background: rgba(255, 255, 255, 0.06);
		color: var(--gray);
		font-size: 14px;

		@media (max-width: 768px) {
			min-width: 80px;
			height: 86px;
		}
	}

	.text {
		min-width: 0;
	}

	h3 {
		font-weight: 700;
		font-size: 18px;
		line-height: 135%;
		color: var(--white, #fff);
		margin-bottom: 8px;
		transition: color 0.25s ease;
		text-overflow: ellipsis;
		white-space: nowrap;
		overflow: hidden;
	}

	time {
		font-weight: 700;
		font-size: 18px;
		line-height: 125%;
		color: var(--gray);
		display: inline-block;
		margin-bottom: 16px;
	}

	kbd {
		font-weight: 400;
		font-size: 14px;
		line-height: 130%;
		color: var(--gray);
		background: rgba(255, 255, 255, 0.08);
		border-radius: 8px;
		padding: 4px 8px;
		margin-bottom: 16px;
	}

	p {
		font-weight: 400;
		font-size: 14px;
		line-height: 160%;
		color: var(--gray);
		max-height: 92px;
		display: -webkit-box;
		-webkit-line-clamp: 4;
		line-clamp: 4;
		-webkit-box-orient: vertical;
		overflow: hidden;
		text-overflow: ellipsis;
		margin-bottom: 16px;

		@media (max-width: 768px) {
			display: none;
		}
	}

	.watch-on {
		font-weight: 400;
		font-size: 14px;
		line-height: 145%;
		color: var(--gray);
		margin-bottom: 16px;

		@media (max-width: 768px) {
			font-size: 13px;
		}
	}

	span {
		font-weight: 400;
		font-size: 14px;
		line-height: 130%;
		color: var(--gray);
	}

	mark {
		font-weight: 700;
		font-size: 18px;
		line-height: 135%;
		background: none;
		color: var(--green);

		&.okey {
			color: #fc9802;
		}
		&.bad {
			color: var(--red);
		}
	}

	.actions {
		display: flex;
		gap: 12px;
		position: absolute;
		bottom: 24px;
		right: 20px;
		:global(svg path) {
			transition: stroke 0.25s ease;
			stroke: var(--white, #fff);
		}
	}

	button {
		border: none;
		background: none;
		padding: 0;
	}
	.delete {
		&:hover {
			z-index: 2;
			:global(svg path) {
				stroke: var(--yellow);
			}
		}
	}
</style>
