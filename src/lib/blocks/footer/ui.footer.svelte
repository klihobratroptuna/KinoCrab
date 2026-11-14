<script>
	import { Dmca } from '$lib/blocks/modals';
	import { TelegramIcon, TmdbIcon } from '$lib/shared/icons';

	let dmcaModal = false;
</script>

<footer>
	<div>
		<a class="tg" href="https://t.me/+CtT26G_ZF_k5ODMy" target="_blank"> <TelegramIcon /> Мы в Telegram </a>
		<p class="credit">
			<!-- Логотип и строка обязательны по условиям использования TMDB (документация:
			https://www.themoviedb.org/documentation/api — «This product uses the TMDB API but is
			not endorsed or certified by TMDB»). Строка нужна только там, где карточка берёт постер
			из TMDB: src/lib/shared/tmdbPoster/index.js. Здесь она внутри блока, как в макете.
			Непрозрачность 3% — по желанию владельца сайта; при наведении строка становится
			читаемой, чтобы атрибуция оставалась доступной. -->
			<a href="https://www.themoviedb.org/" target="_blank">
				<TmdbIcon />
				<span>Этот продукт использует TMDB API, но не одобрен и не сертифицирован TMDB</span>
			</a>
		</p>
		<nav>
			<button type="button" on:click={() => (dmcaModal = true)}>Правообладателям</button>
			<span>•</span>
			<a href="/legal/tos">Соглашение</a>
			<span>•</span>
			<a href="/legal/privacy">Конфиденциальность</a>
		</nav>
	</div>
</footer>
<Dmca bind:isShow={dmcaModal} />

<style lang="scss">
	footer {
		display: flex;
		flex-direction: column;
		gap: 12px;
		align-self: stretch;
		padding: 20px 40px 40px 40px;
		max-width: 1920px;

		@media (max-width: 768px) {
			padding: 16px 16px 40px;
			flex: 1 0 auto;
			width: 100%;
		}
	}

	.credit {
		margin: 0;
		display: flex;
		align-items: center;
		justify-content: flex-start;
		flex: 1 1 auto;
		gap: 10px;
		flex-wrap: wrap;
		opacity: 0.03;
		color: var(--gray, #c0c0c0);
		font-family: Inter;
		font-size: 13px;
		font-style: normal;
		font-weight: 400;
		line-height: 18px;

		// На наведении строка становится читаемой: атрибуция TMDB обязательна,
		// а в обычном состоянии она затемнена до 3% по желанию владельца сайта.
		@include hover {
			opacity: 1;
		}

		a {
			display: flex;
			align-items: center;
			gap: 10px;
			color: inherit;

			span {
				text-decoration-line: none;
			}

			@include hover {
				color: var(--white, #fff);
			}
		}

		:global(svg) {
			flex: 0 0 auto;
		}
	}

	/* Подвал — одна аккуратная строка: без карточки, только верхняя линия */
	div {
		display: flex;
		width: 100%;
		justify-content: space-between;
		align-items: center;
		gap: 24px;
		padding: 18px 0;
		align-self: stretch;
		border: none;
		border-top: 1px solid var(--hairline, rgba(255, 255, 255, 0.08));
		border-radius: 0;
		background: transparent;
		box-shadow: none;
		backdrop-filter: none;

		@media (max-width: 768px) {
			align-items: flex-start;
			flex-direction: column;
			gap: 16px;
		}
	}

	.tg {
		display: flex;
		align-items: center;
		gap: 10px;
		color: var(--white, #fff);

		/* text-14-bold */
		font-family: Inter;
		font-size: 13px;
		font-style: normal;
		font-weight: 600;
		line-height: 18px; /* 128.571% */
		text-decoration: none;

		@include hover {
			color: var(--white, #fff);
		}
	}

	nav {
		display: flex;
		align-items: center;
		gap: 14px;

		@media (max-width: 768px) {
			align-items: flex-start;
			flex-direction: column;
		}

		span {
			color: var(--gray-soft, #6a6e77);
			/* text-16-bold */
			font-family: Inter;
			font-size: 12px;
			font-style: normal;
			font-weight: 400;
			line-height: 20px; /* 125% */

			@media (max-width: 768px) {
				display: none;
			}
		}

		button, a {
			padding: 0;
			appearance: none;
			background: none;
			border: none;
			color: var(--gray, #8b8f98);
			font-family: Inter;
			font-size: 13px;
			font-style: normal;
			font-weight: 400;
			line-height: normal;
			text-decoration-line: underline;
			cursor: pointer;

			@include hover {
				color: var(--white, #fff);
				text-decoration-line: none;
			}
		}
	}
</style>
