export const config = {
  supabaseUrl: process.env.SUPABASE_URL || '',
  supabaseKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  pollInterval: parseInt(process.env.WORKER_POLL_INTERVAL || '30000'),
};

export const logger = {
  info: (message: string) => console.log('[WORKER]', message),
  error: (message: string) => console.error('[WORKER ERROR]', message),
  warn: (message: string) => console.warn('[WORKER WARN]', message),
};
