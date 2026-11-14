// Замена $app/environment для Node: window там нет, поэтому browser = false — ровно
// так же SvelteKit отвечает на сервере. Модули, которые проверяют browser, работают без
// localStorage и без кэша снимков (preSearch в Node держит счёт дня в памяти процесса).
export const browser = typeof globalThis.window !== 'undefined';
export const server = !browser;
export const dev = false;
