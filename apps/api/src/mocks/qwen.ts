import { Request, Response } from 'express';

export const mockQwen = {
  chat: (req: Request, res: Response) => {
    const { messages, task_type } = req.body;
    
    console.log('[MOCK Qwen] Task:', task_type);
    
    // Mock response based on task type
    let content = '';
    if (task_type === 'brand_rule_extract') {
      content = JSON.stringify({
        rules: [
          {
            category: 'voice',
            title: 'Premium Carmel Dining',
            content: 'We emphasize local ingredients, seasonal changes, and exceptional hospitality.',
            priority: 10,
            confidence: 0.95
          }
        ],
        confidence: 0.92,
        uncertainty: ['Specific menu items need kitchen confirmation'],
        citations: []
      });
    } else if (task_type === 'marketing_question') {
      content = JSON.stringify({
        answer: 'For local retention, focus on weekly specials, loyalty programs, and community events.',
        evidence: ['Marketing Strategy v1.0, Section 3.2'],
        confidence: 0.88
      });
    } else {
      content = JSON.stringify({
        answer: 'I can help with marketing strategy, brand guidelines, and campaign planning.',
        confidence: 1.0
      });
    }
    
    res.json({
      id: 'mock-' + Date.now(),
      object: 'chat.completion',
      created: Date.now(),
      model: 'qwen3.8-flash',
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: content
        },
        finish_reason: 'stop'
      }],
      usage: {
        prompt_tokens: 100,
        completion_tokens: 50,
        total_tokens: 150
      }
    });
  },

  embeddings: (req: Request, res: Response) => {
    const { input } = req.body;
    const dimensions = 1024; // AWS Bedrock Titan V2
    
    const embeddings = Array.isArray(input) 
      ? input.map(() => Array(dimensions).fill(0.01))
      : [Array(dimensions).fill(0.01)];
    
    res.json({
      object: 'list',
      data: embeddings.map((embedding, i) => ({
        object: 'embedding',
        embedding,
        index: i
      })),
      model: 'amazon.titan-embed-text-v1',
      usage: {
        prompt_tokens: input.toString().length / 10,
        total_tokens: input.toString().length / 10
      }
    });
  }
};
