import { Fragment, type ReactNode } from 'react';

/**
 * Shows AI text with light formatting: **bold** becomes bold, and "#" heading marks are removed
 * (the heading text is shown in bold). Everything else stays plain text. No HTML is ever
 * interpreted, so model output cannot inject markup.
 */
export function RichText({ text }: { text: string }) {
  const lines = text.split('\n');
  return (
    <>
      {lines.map((line, i) => {
        const heading = /^\s{0,3}#{1,6}\s+(.*)$/.exec(line);
        const content = heading ? <strong>{bold(heading[1]!.replace(/\*\*/g, ''))}</strong> : bold(line);
        return (
          <Fragment key={i}>
            {content}
            {i < lines.length - 1 && '\n'}
          </Fragment>
        );
      })}
    </>
  );
}

function bold(line: string): ReactNode[] {
  return line.split(/\*\*(.+?)\*\*/g).map((part, j) => (j % 2 === 1 ? <strong key={j}>{part}</strong> : part));
}
