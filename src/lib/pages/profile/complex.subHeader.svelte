<script>
	import watchHistory from '$lib/shared/scripts/watchHistory';
	import { goto, afterNavigate } from '$app/navigation';
	import { Button } from '$lib/elements/button';
	import { Login } from '$lib/blocks/login';
	import { UiLogout } from '$lib/blocks/logout';
	import { DeleteIcon } from '$lib/shared/icons';
	import pb from '$lib/shared/pocketbase';
	import { confirmSession } from '$lib/shared/auth';

	export let activeList = 'history';
	let nav;
	let historyList = [];
	let isLogin = pb.authStore.isValid;

	// Токен в localStorage жив по сроку, даже когда записи пользователя уже нет
	// (замер 2026-11-07 на базе, пересозданной вместе с томом): страница показывала
	// имя и вкладки «Смотрю» / «Буду смотреть», а списки оставались пустыми, потому что
	// чтение молча вернуло 0 строк, а запись списка отвечала 400. Сессию подтверждаем
	// обращением к своей записи: её нет — вход сбрасываем, показываем форму входа.
	async function checkSession() {
		if (!pb.authStore.isValid) {
			isLogin = false;
			return;
		}

		isLogin = Boolean(await confirmSession());
	}

	checkSession();

	function setActiveList(list) {
		activeList = list;
	}

	function clearWatchHistory() {
		localStorage.setItem('watch_history', JSON.stringify([]));
		goto(''); // обновляет страницу
	}

	function scrollFade() {
		let scrolled = nav.scrollLeft / (nav.scrollWidth - nav.clientWidth);
		if (scrolled < 0.01) {
			nav.style =
				'mask-image: linear-gradient(90deg,transparent 0%,rgba(0, 0, 0, 1) 0%,rgba(0, 0, 0, 1) 90%,transparent 100%)';
		}
		if (scrolled > 0.01 && scrolled < 0.99) {
			nav.style =
				'mask-image: linear-gradient(90deg,transparent 0%,rgba(0, 0, 0, 1) 10%,rgba(0, 0, 0, 1) 90%,transparent 100%)';
		}
		if (scrolled > 0.99) {
			nav.style =
				'mask-image: linear-gradient(90deg,transparent 0%,rgba(0, 0, 0, 1) 10%,rgba(0, 0, 0, 1) 100%,transparent 100%)';
		}
	}

	afterNavigate(() => {
		historyList = watchHistory.get();
		checkSession();
	});
</script>

<section>
	{#if !isLogin}
		<Login />
	{/if}
	<div class="top">
		<h2>Профиль</h2>
		{#if isLogin}
			<div class="user">
				<p>{pb.authStore.model?.email?.split('@')[0]}</p>
				<UiLogout />
			</div>
		{/if}
	</div>

	<div class="bottom">
		<nav bind:this={nav} on:scroll={scrollFade}>
			<Button toggle active={activeList == 'history'} on:click={() => setActiveList('history')}>
				История
			</Button>
			{#if isLogin}
				<Button toggle active={activeList == 'view'} on:click={() => setActiveList('view')}>
					Смотрю
				</Button>
				<Button toggle active={activeList == 'planned'} on:click={() => setActiveList('planned')}>
					Буду смотреть
				</Button>
			{/if}
		</nav>
		<!-- {#if activeList == 'history' && historyList.length}
			<button on:click={clearWatchHistory}>
				<Button circle dark vibro>
					<DeleteIcon />
				</Button>
				<span>Очистить список «История»</span>
			</button>
		{/if} -->
	</div>
</section>

<style lang="scss">
	section {
		display: flex;
		max-width: 1920px;
		padding: 20px 40px;
		flex-direction: column;
		gap: 40px;
		align-self: stretch;

		@media (max-width: 768px) {
			flex: none;
			padding: 16px;
		}
	}

	.top {
		display: flex;
		align-items: center;
		gap: 24px;

		h2 {
			font-weight: 700;
			font-size: 32px;
			line-height: 137%;
			color: var(--white);
		}

		.user {
			display: flex;
			flex: 1 0 0;
			justify-content: flex-end;
			gap: 32px;
			align-items: center;

			p {
				font-family: var(--font-family);
				font-weight: 700;
				font-size: 18px;
				line-height: 133%;
				color: var(--yellow);
			}
		}
	}

	.bottom {
		display: flex;
		justify-content: space-between;
	}

	nav {
		overflow-x: scroll;
		transition: all 0.25s ease;
		mask-image: linear-gradient(90deg, rgba(0, 0, 0, 1) 90%, transparent 100%);
		display: flex;
		flex: 1 0 0;
		gap: 10px;

		&::-webkit-scrollbar {
			width: 0px;
			height: 0px;
		}

		:global(button) {
			padding: 10px 20px;
		}
	}

	button {
		appearance: none;
		border: none;
		background: none;
		padding: 0;
		display: flex;
		align-items: center;
		gap: 12px;

		font-weight: 500;
		font-size: 14px;
		line-height: 129%;
		color: var(--white);
		transition: all 0.25s ease;

		@media (max-width: 768px) {
			span {
				display: none;
			}
		}

		&:active {
			transform: scale(90%);
		}

		&:hover {
			:global(.circle) {
				padding: 7px;
				background: rgba(255, 255, 255, 0.25);

				:global(svg path) {
					stroke: var(--yellow, #fce802);
				}
			}
		}

		:global(.circle) {
			padding: 7px;
		}
	}
</style>
