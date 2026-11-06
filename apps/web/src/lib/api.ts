import { createApi } from '@tanstack/react-query';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';

export const api = createApi({
  baseQuery: async ({ endpoint }: { endpoint: string }) => {
    const res = await fetch(\\\\);
    const data = await res.json();
    
    if (!res.ok) {
      throw new Error(data.error || 'API Error');
    }
    
    return { data };
  },
  endpoints: (build) => ({
    getHealth: build.query({
      query: () => '/health',
    }),
  }),
});

export const { useGetHealthQuery } = api;
export { api as apiSlice };
