import { Card } from '../ui';

const SECTIONS: { title: string; tips: string[] }[] = [
  {
    title: 'Before you start',
    tips: [
      'Wipe the phone lens. Most blurry, hazy restaurant photos come from a smudged lens.',
      'Turn the flash off. Use the light that is already there.',
      'Clean up the background: no reservation screens, receipts, staff-only areas, cleaning supplies or clutter.',
      'Ask the kitchen for a plate that looks exactly like what guests get. Never style a dish differently from how it is served.',
    ],
  },
  {
    title: 'Light',
    tips: [
      'Daylight from a window or the patio is best. Put the dish beside the light, not under it.',
      'Late afternoon and the hour before sunset give warm, soft light, which is ideal for the patio.',
      'In the evening, use the restaurant’s own lighting and candles. Hold still, or rest your elbows on the table, to avoid blur.',
      'Avoid overhead spotlights directly above a plate: they make harsh shadows.',
    ],
  },
  {
    title: 'Food and wine',
    tips: [
      'Shoot from straight above for flat dishes such as pizzas and salads, and from the side at table height for tall dishes and glasses.',
      'Fill most of the frame with the dish. Step closer instead of zooming in.',
      'Include a hint of context, like a wine glass, a hand or the table, so it feels like a real evening and not a menu photo.',
      'For wine, pour while someone takes the photo, or show the bottle label clearly and the right way up.',
    ],
  },
  {
    title: 'The patio and the room',
    tips: [
      'Take one wide photo that shows the space: the cover overhead, the heaters, the tables set.',
      'Hold the phone level. Tilted walls and posts look careless.',
      'Show the heaters on when you describe the patio as heated.',
    ],
  },
  {
    title: 'People and privacy',
    tips: [
      'Never post a guest who can be recognised unless they have clearly agreed. Hands, backs and blurred backgrounds are safer.',
      'Ask staff and the chef before featuring them.',
      'Do not photograph tickets, the reservation book, guest names or table notes.',
    ],
  },
  {
    title: 'Before you post',
    tips: [
      'Take several shots and choose the sharpest. Make a carousel of 3 to 5 photos: close-up, context, wide.',
      'Edit gently: straighten, crop and brighten a little. Avoid heavy filters so food colours stay true.',
      'Use the photos that match the approved post. If the photo changes what the post promises, check with whoever approved it.',
    ],
  },
];

export function PhotoGuide() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Photo guide</h1>
        <p className="text-sm text-stone-600">
          Practical tips for phone photos of the food, the wine and the patio. Each draft from the assistant also includes a photo plan for that post.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {SECTIONS.map((s) => (
          <Card key={s.title} title={s.title}>
            <ul className="list-disc space-y-2 pl-5 text-sm">
              {s.tips.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </Card>
        ))}
      </div>
    </div>
  );
}
