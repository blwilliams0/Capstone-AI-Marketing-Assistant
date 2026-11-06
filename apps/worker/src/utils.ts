export const logger = {
  info: (message: string) => console.log('[WORKER]', message),
  error: (message: string) => console.error('[WORKER ERROR]', message),
  warn: (message: string) => console.warn('[WORKER WARN]', message),
};
