import { describe, it, expect } from 'vitest';
import { countWords, splitIntoSections } from './sections.js';
import { toOrQuery } from './service.js';

describe('splitIntoSections', () => {
  it('splits at headings and keeps the parent heading path', () => {
    const s = splitIntoSections('Doc', '# Strategy\nIntro.\n\n## Locals\nReasons to return.\n\n## Tourists\nDiscovery.');
    expect(s.map((x) => x.heading)).toEqual(['Strategy', 'Strategy › Locals', 'Strategy › Tourists']);
    expect(s[1]!.body).toBe('Reasons to return.');
  });

  it('uses the title when there are no headings', () => {
    expect(splitIntoSections('Hours', 'Open 5pm to 9pm.')).toEqual([{ heading: 'Hours', body: 'Open 5pm to 9pm.' }]);
  });

  it('splits very long sections on paragraph boundaries', () => {
    const para = Array.from({ length: 200 }, () => 'word').join(' ');
    const s = splitIntoSections('Doc', `# Long\n${[para, para, para, para].join('\n\n')}`);
    expect(s.length).toBeGreaterThan(1);
    expect(s[0]!.heading).toBe('Long (part 1)');
    for (const x of s) expect(countWords(x.body)).toBeLessThanOrEqual(600);
  });
});

describe('toOrQuery', () => {
  it('builds an OR query from meaningful words and strips punctuation', () => {
    expect(toOrQuery("How should we market a wine dinner? (locals!)")).toBe('how | should | market | wine | dinner | locals');
    expect(toOrQuery("'; DROP TABLE x; --")).toBe('drop | table');
    expect(toOrQuery('a ?')).toBeNull();
  });
});
