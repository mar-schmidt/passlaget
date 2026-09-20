import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const url = env.VITE_SUPABASE_URL?.trim(),
    key = env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (Boolean(url) !== Boolean(key))
    throw new Error(
      'Ange både Supabase-adress och publicerbar nyckel, eller lämna båda tomma för demo.',
    );
  if (key) {
    let legacyAnon = false;
    try {
      legacyAnon =
        JSON.parse(Buffer.from(key.split('.')[1] || '', 'base64url').toString()).role === 'anon';
    } catch {
      /* newer publishable keys are not JWTs */
    }
    if (!key.startsWith('sb_publishable_') && !legacyAnon)
      throw new Error(
        'Frontend kräver en publicerbar Supabase-nyckel. Hemliga nycklar får inte byggas in i webbsidan.',
      );
    if (!url?.startsWith('https://') && !/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(url || ''))
      throw new Error('Använd HTTPS för Supabase-adressen, eller en lokal testserver.');
  }
  return { plugins: [react()], base: env.VITE_BASE_PATH || '/', build: { sourcemap: false } };
});
