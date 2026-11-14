<script>
	import { goto } from '$app/navigation';
	import { ModalBox } from '$lib/elements/mobalBox';
	import { authWithProvider, authWithPassword, register } from '$lib/shared/auth';

	export let isShow;

	let mode = 'login'; // 'login' | 'register'
	let email = '';
	let password = '';
	let passwordConfirm = '';
	let error = '';
	let loading = false;

	function switchMode(newMode) {
		mode = newMode;
		error = '';
	}

	async function submit() {
		error = '';

		if (password.length < 8) {
			error = 'Пароль должен быть не короче 8 символов';
			return;
		}

		if (mode === 'register' && password !== passwordConfirm) {
			error = 'Пароли не совпадают';
			return;
		}

		loading = true;
		try {
			if (mode === 'login') {
				await authWithPassword(email, password);
			} else {
				await register(email, password);
				// после регистрации сразу входим
				await authWithPassword(email, password);
			}
			isShow = false;
			goto('/profile');
		} catch (e) {
			if (e?.response?.data?.email?.code === 'validation_invalid_email') {
				error = 'Некорректный email';
			} else if (e?.response?.code === 400 && mode === 'register') {
				error = 'Аккаунт с таким email уже существует';
			} else if (e?.response?.code === 400) {
				error = 'Неверный email или пароль';
			} else {
				error = 'Ошибка сети. Попробуйте ещё раз';
			}
		} finally {
			loading = false;
		}
	}

	async function auth() {
		error = '';
		loading = true;
		try {
			await authWithProvider('google');
			isShow = false;
			goto('/profile');
		} catch (e) {
			error = 'Не удалось войти через Google';
		} finally {
			loading = false;
		}
	}
</script>

<ModalBox bind:isShow>
	<h2 slot="title">{mode === 'login' ? 'Вход в Kinofree' : 'Регистрация'}</h2>
	<section slot="content">
		<form on:submit|preventDefault={submit}>
			<input type="email" bind:value={email} placeholder="Email" autocomplete="email" required />
			<input
				type="password"
				bind:value={password}
				placeholder="Пароль"
				autocomplete={mode === 'login' ? 'current-password' : 'new-password'}
				minlength="8"
				required
			/>
			{#if mode === 'register'}
				<input
					type="password"
					bind:value={passwordConfirm}
					placeholder="Повторите пароль"
					autocomplete="new-password"
					minlength="8"
					required
				/>
			{/if}

			<button type="submit" disabled={loading}>
				{loading ? 'Подождите...' : mode === 'login' ? 'Войти' : 'Создать аккаунт'}
			</button>

			{#if error}
				<p class="error">{error}</p>
			{/if}
		</form>

		<div class="divider"><span>или</span></div>

		<button type="button" class="provider" on:click={auth} disabled={loading}>
			<img src="/icons/google.svg" alt="google" />
			Войти через Google
		</button>

		<p class="switch">
			{#if mode === 'login'}
				Нет аккаунта?
				<button type="button" on:click={() => switchMode('register')}>Зарегистрироваться</button>
			{:else}
				Уже есть аккаунт?
				<button type="button" on:click={() => switchMode('login')}>Войти</button>
			{/if}
		</p>
	</section>
</ModalBox>

<style lang="scss">
  section {
    display: flex;
    flex-direction: column;
    gap: 24px;
  }

  h2 {
    width: max-content;
  }

  form {
    display: flex;
    flex-direction: column;
    gap: 12px;

    input {
      padding: 12px 16px;
      border-radius: 12px;
      border: 1px solid var(--hairline, rgba(255, 255, 255, 0.08));
      background: rgba(255, 255, 255, 0.04);
      color: var(--white, #fff);
      font-family: Inter;
      font-size: 14px;
      outline: none;
      transition: border-color 0.25s ease;

      &:focus {
        border-color: var(--hairline-hi, rgba(255, 255, 255, 0.14));
      }
    }

    button[type='submit'] {
      margin-top: 8px;
      padding: 12px 16px;
      border: none;
      border-radius: 12px;
      background: var(--white, #fff);
      color: var(--black, #000);
      font-family: Inter;
      font-weight: 600;
      letter-spacing: -0.01em;
      font-size: 14px;
      cursor: pointer;
      transition: all 0.25s ease;

      &:hover {
        box-shadow: 0 10px 24px rgba(255, 255, 255, 0.12);
      }

      &:disabled {
        opacity: 0.6;
        cursor: wait;
      }
    }
  }

  .error {
    color: var(--white, #fff);
    font-family: Inter;
    font-size: 13px;
  }

  .divider {
    display: flex;
    align-items: center;
    gap: 12px;
    color: var(--gray, #8b8f98);
    font-family: Inter;
    font-size: 13px;

    &::before,
    &::after {
      content: '';
      flex: 1;
      height: 1px;
      background: var(--hairline, rgba(255, 255, 255, 0.08));
    }
  }

  .provider {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    padding: 12px 16px;
    border-radius: 12px;
    border: 1px solid var(--hairline, rgba(255, 255, 255, 0.08));
    background: rgba(255, 255, 255, 0.05);
    color: var(--white, #fff);
    font-family: Inter;
    font-weight: 600;
    letter-spacing: -0.01em;
    font-size: 14px;
    cursor: pointer;
    transition: all 0.25s ease;

    &:hover {
      border-color: var(--hairline-hi, rgba(255, 255, 255, 0.14));
      background: rgba(255, 255, 255, 0.08);
    }

    &:disabled {
      opacity: 0.6;
    }

    img {
      width: 20px;
      height: 20px;
    }
  }

  .switch {
    text-align: center;
    color: var(--gray, #c0c0c0);
    font-family: Inter;
    font-size: 13px;

    button {
      background: none;
      border: none;
      padding: 0;
      color: var(--yellow, #fce802);
      font-family: Inter;
      font-size: 13px;
      cursor: pointer;
      text-decoration: underline;
    }
  }
</style>
