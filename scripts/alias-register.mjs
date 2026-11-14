// Точка входа для «node --import ./scripts/alias-register.mjs».
// В Node 24 флаг --experimental-loader убран, поэтому загрузчик алиасов регистрируется
// через module.register — так работает и на Node 20.6+, и на Node 24.
import { register } from 'node:module';

register('./alias-loader.mjs', import.meta.url);
