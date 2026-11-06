export interface Job {
  id: string;
  type: 'publish_social';
  status: 'pending' | 'processing' | 'completed' | 'failed';
  payload: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export const jobs = {
  processPublishSocial: async (job: Job) => {
    console.log('[JOB] Processing publish:', job.id);
    // In production, this would:
    // 1. Check user permissions
    // 2. Verify brand rules
    // 3. Call social media API
    // 4. Update job status
    return { success: true };
  },
};
