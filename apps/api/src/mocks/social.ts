import { Request, Response } from 'express';

export const mockSocial = {
  connect: (req: Request, res: Response) => {
    const { platform } = req.body;
    
    console.log('[MOCK Social] Connecting:', platform);
    
    res.json({
      success: true,
      data: {
        id: 'mock-connection-' + Date.now(),
        platform: platform,
        connected_at: new Date().toISOString(),
        status: 'connected',
        capabilities: ['publish_photo', 'publish_caption']
      }
    });
  },

  publish: (req: Request, res: Response) => {
    const { payload } = req.body;
    
    console.log('[MOCK Social] Publishing:', JSON.stringify(payload, null, 2));
    
    // Mock successful publish
    res.json({
      success: true,
      data: {
        id: 'mock-post-' + Date.now(),
        external_id: 'IG-' + Math.random().toString(36).substring(2, 15),
        published_at: new Date().toISOString(),
        status: 'published',
        platform: payload.platform,
        media_url: payload.media_url,
        caption: payload.caption.substring(0, 100) + '...'
      }
    });
  }
};
