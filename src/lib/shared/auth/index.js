import { writable } from 'svelte/store';
import pb from '$lib/shared/pocketbase';

export const user = writable(pb.authStore.isValid ? pb.authStore.model : null);

// Кэш проверки на одну загрузку страницы: компоненты вызывают confirmSession
// несколько раз (профиль: complex.subHeader.svelte:30 и ui.films.svelte:139).
// SDK по умолчанию отменяет повторный одинаковый запрос по ключу method+path,
// поэтому первый из двух приходил с ошибкой (замер 2026-11-07: status 0,
// isAbort true — «The request was autocancelled»), и вход сбрасывался при
// обновлении страницы. Кэш сбрасывает resetSessionCheck() — её вызывает
// afterNavigate в src/routes/+layout.svelte: хук работает только внутри
// компонента, а этот файл — обычный модуль, и вызов хука отсюда давал ошибку
// «Function called outside component initialization» (видно в консоли на замере).
let sessionCheck = null;

pb.authStore.onChange(() => {
	sessionCheck = null;
	user.set(pb.authStore.isValid ? pb.authStore.model : null);
});

export function resetSessionCheck() {
	sessionCheck = null;
}

export async function authWithProvider(provider = 'google') {
	return await pb.collection('users').authWithOAuth2({ provider });
}

export async function authWithPassword(email, password) {
	return await pb.collection('users').authWithPassword(email, password);
}

export async function register(email, password) {
	return await pb.collection('users').create({
		email,
		password,
		passwordConfirm: password
	});
}

export function logout() {
	pb.authStore.clear();
}

// Сессия лежит в localStorage и живёт по сроку токена, а не по записи пользователя.
// Замер 2026-11-07 на базе, пересозданной вместе с томом: токен был живой,
// authStore.isValid true, но записи пользователя уже нет — PocketBase на чтение
// списка молча отдавал пустой список (0 строк вместо ошибки), а на запись списка
// отвечал 400. Страница выглядела так, будто вход есть и ничего не сохраняется.
// Поэтому вход подтверждаем обращением к своей записи: её нет — сессию сбрасываем,
// страница показывает форму входа. Чужую запись read-правило users не отдаёт
// (viewRule = id = @request.auth.id, замер: чужая запись 404).
export async function confirmSession() {
	if (!pb.authStore.isValid) return null;

	const id = pb.authStore.model.id;
	if (sessionCheck && sessionCheck.id === id) return sessionCheck.promise;

	const promise = (async () => {
		try {
			// $autoCancel: false — проверку не отменяет дублирующий запрос, и сама
			// она не отменяет другие: ключ не регистрируется.
			return await pb.collection('users').getOne(id, { $autoCancel: false });
		} catch (error) {
			// Сбрасываем вход только когда записи действительно нет (404).
			// status 0 — это не «пользователя нет», а отсутствие ответа: сеть
			// не прошла, запрос прерван или отменён. Такой случай не должен
			// выбрасывать из аккаунта: раньше catch ловил всё подряд, и при
			// обновлении страницы первый из двух одинаковых запросов получал
			// авто-отмену — пользователя выходило из аккаунта. Причина видна
			// в UI: блок списка пишет, что база не ответила.
			if (error.status === 404) {
				pb.authStore.clear();
				return null;
			}

			return pb.authStore.model;
		}
	})();

	sessionCheck = { id, promise };

	return promise;
}
