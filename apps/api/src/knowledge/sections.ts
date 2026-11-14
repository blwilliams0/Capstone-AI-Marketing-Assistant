export interface Section {
  heading: string;
  body: string;
}

const MAX_SECTION_WORDS = 600;

export function countWords(text: string): number {
  const m = text.trim().match(/\S+/g);
  return m ? m.length : 0;
}

/**
 * Splits Markdown or plain text into searchable sections at headings (#, ##, ###).
 * Each section's heading includes its parent headings ("Recommendations › Channels") so a search
 * hit still makes sense on its own. Long sections are split on paragraph boundaries.
 */
export function splitIntoSections(title: string, text: string): Section[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const path: string[] = [];
  const raw: Section[] = [];
  let buf: string[] = [];
  let heading = title;

  const flush = () => {
    const body = buf.join('\n').trim();
    if (body) raw.push({ heading, body });
    buf = [];
  };

  for (const line of lines) {
    const m = /^(#{1,3})\s+(.+?)\s*#*\s*$/.exec(line);
    if (m) {
      flush();
      const level = m[1]!.length;
      path.length = level - 1;
      path[level - 1] = m[2]!.replace(/\*\*/g, '').trim();
      heading = path.filter(Boolean).join(' › ') || title;
    } else {
      buf.push(line);
    }
  }
  flush();

  const out: Section[] = [];
  for (const s of raw) {
    if (countWords(s.body) <= MAX_SECTION_WORDS) {
      out.push(s);
      continue;
    }
    let part: string[] = [];
    let words = 0;
    let n = 1;
    for (const para of s.body.split(/\n\s*\n/)) {
      const w = countWords(para);
      if (words + w > MAX_SECTION_WORDS && part.length > 0) {
        out.push({ heading: `${s.heading} (part ${n++})`, body: part.join('\n\n') });
        part = [];
        words = 0;
      }
      part.push(para);
      words += w;
    }
    if (part.length > 0) out.push({ heading: n > 1 ? `${s.heading} (part ${n})` : s.heading, body: part.join('\n\n') });
  }
  return out.length > 0 ? out : [{ heading: title, body: text.trim() }];
}
