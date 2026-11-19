import { z } from 'zod';

/**
 * The brand interview question set. IDs and wording match docs/strategy/BRAND_INTERVIEW_GUIDE.md,
 * so printed notes and in-app answers line up.
 */
export interface InterviewQuestion {
  id: string;
  question: string;
  followUp?: string;
}

export interface InterviewSection {
  id: string;
  title: string;
  /** What answers in this section usually become (shown to the interviewer). */
  becomes: string;
  questions: InterviewQuestion[];
}

export const INTERVIEW_SECTIONS: InterviewSection[] = [
  {
    id: 'A',
    title: 'The Pocket in their words',
    becomes: 'Brand rules',
    questions: [
      { id: 'A1', question: 'How would you describe The Pocket to someone who has never been?', followUp: 'What would you want them to remember afterwards?' },
      { id: 'A2', question: 'What makes The Pocket different from other upscale restaurants in Carmel and Monterey?', followUp: 'Which of those would a guest notice first?' },
      { id: 'A3', question: 'If The Pocket were a person, how would you describe their personality?', followUp: 'Three words you would use, and three you would never want used.' },
      { id: 'A4', question: 'What is the story behind The Pocket: why it exists and what you are proud of?', followUp: 'Is any of that story private or not for marketing?' },
    ],
  },
  {
    id: 'B',
    title: 'Tone and voice',
    becomes: 'Brand rules',
    questions: [
      { id: 'B1', question: 'When The Pocket speaks publicly (social media, website, emails), how should it sound?', followUp: 'Formal or conversational? Warm, witty, understated?' },
      { id: 'B2', question: 'Should The Pocket be seen as "fun"? Or is that something to avoid?', followUp: 'What does "fun" look like that would or would not fit?' },
      { id: 'B3', question: 'Show or describe a restaurant post or ad you liked, and one you disliked. Why?', followUp: 'What made the bad one feel wrong?' },
      { id: 'B4', question: "Are there words, phrases, emojis or styles that should never appear in The Pocket's marketing?", followUp: 'Words like "luxury", "exclusive", "best in Carmel"?' },
    ],
  },
  {
    id: 'C',
    title: 'Guests: locals and visitors',
    becomes: 'Brand rules for the locals and visitors audiences',
    questions: [
      { id: 'C1', question: 'Who are your regulars? What brings them back?', followUp: 'What would make them come back more often?' },
      { id: 'C2', question: 'Who are your visitors? How do they usually find you today?', followUp: 'Inn guests, hotels, concierges, Google, word of mouth?' },
      { id: 'C3', question: "What should a local hear from The Pocket that a tourist doesn't need to, and the reverse?", followUp: 'Is there anything you would say to only one group?' },
      { id: 'C4', question: 'What promise does The Pocket make to every guest?', followUp: 'What would a broken promise look like?' },
    ],
  },
  {
    id: 'D',
    title: 'What makes the experience',
    becomes: 'Brand rules, and facts with a verifier',
    questions: [
      { id: 'D1', question: 'How should the covered, heated patio be described?', followUp: 'Seasons or weather where it shines? Anything to avoid claiming?' },
      { id: 'D2', question: "How does the menu change, and how far ahead do you know what's coming?", followUp: 'Who confirms a dish is available before it is promoted?' },
      { id: 'D3', question: 'What role do the chef and pastry program play in the brand?', followUp: 'Is the chef comfortable appearing in photos, video or short interviews?' },
      { id: 'D4', question: "How important is wine to The Pocket's identity?", followUp: 'Wine dinners, pairings, a sommelier story?' },
      { id: 'D5', question: 'What does personal hospitality mean at The Pocket?', followUp: "A guest story that captures it, if you're comfortable sharing?" },
      { id: 'D6', question: 'How do the Inn and the restaurant relate, and how should that be described?', followUp: 'Who handles referrals between them?' },
    ],
  },
  {
    id: 'E',
    title: 'Events and offers',
    becomes: 'Facts (with dates and a verifier) and brand rules',
    questions: [
      { id: 'E1', question: 'What private events or special occasions do you want more of? Which do you not want?', followUp: 'Group sizes, dates or occasions that work best?' },
      { id: 'E2', question: 'How do you feel about promotions and discounts?', followUp: 'Anything that would cheapen the brand? Anything acceptable (wine dinner pricing, seasonal menus)?' },
      { id: 'E3', question: 'What is coming up in the next three months that should be promoted?', followUp: 'Who confirms dates, prices and capacity?' },
    ],
  },
  {
    id: 'F',
    title: 'Boundaries and approvals',
    becomes: 'Brand rules and approval settings',
    questions: [
      { id: 'F1', question: 'What should marketing never say or show?', followUp: 'Claims, comparisons with competitors, guests in photos, prices?' },
      { id: 'F2', question: 'Who must approve what before it goes public?', followUp: "Does food need the chef's check? Does anything need ownership's sign-off?" },
      { id: 'F3', question: 'Are you comfortable with either manager approving a post they wrote themselves?', followUp: 'Should anything always need a second person?' },
      { id: 'F4', question: 'What should the AI assistant never do, even as a draft?', followUp: 'Topics it should stay away from?' },
    ],
  },
  {
    id: 'G',
    title: 'Goals and measuring success',
    becomes: 'Goals (kept separate from measured results)',
    questions: [
      { id: 'G1', question: 'Six months from now, what would make you say marketing is working?', followUp: 'More locals returning, more visitors, more events, less of your time?' },
      { id: 'G2', question: 'How much time per week can someone realistically give to marketing, and who?', followUp: 'Is there a natural marketing lead on staff?' },
      { id: 'G3', question: 'What information do you already have about reservations and where guests come from?', followUp: 'Toast or Tock reports you could share in aggregate?' },
    ],
  },
  {
    id: 'H',
    title: 'Closing',
    becomes: 'Notes',
    questions: [
      { id: 'H1', question: "Is there anything about The Pocket we haven't asked that marketing must get right?" },
      { id: 'H2', question: 'Who else should we talk to (ownership, kitchen, front of house)?' },
    ],
  },
];

export const INTERVIEW_QUESTIONS: InterviewQuestion[] = INTERVIEW_SECTIONS.flatMap((s) => s.questions);
const QUESTION_IDS = new Set(INTERVIEW_QUESTIONS.map((q) => q.id));

/** A guide question (A1) or a follow-up to one (A1.f1, A1.f2...). */
export const isInterviewQuestionId = (id: string) => {
  const m = /^([A-H]\d)(?:\.f([1-9]))?$/.exec(id);
  return !!m && QUESTION_IDS.has(m[1]!);
};

export const startInterviewSchema = z.object({
  intervieweeName: z.string().trim().min(1, 'Who is being interviewed?').max(120),
  intervieweeRole: z.string().trim().max(120).optional(),
  /** They agreed to detailed notes being kept. Required to use the app for the interview. */
  notesConsent: z.literal(true, { message: 'Ask permission to take notes first' }),
  /** They agreed that answers may be sent to the AI service for follow-ups and summaries. */
  aiConsent: z.boolean(),
});

export const saveAnswerSchema = z.object({
  questionId: z.string().refine(isInterviewQuestionId, 'Unknown question'),
  /** The exact wording asked, for follow-up questions. Guide questions use the guide's wording. */
  questionText: z.string().trim().max(1000).optional(),
  answer: z.string().trim().max(8000),
});

export const followUpSchema = z.object({ questionId: z.string().refine(isInterviewQuestionId, 'Unknown question') });

export const saveInterviewProposalSchema = z.object({
  extractionId: z.string().uuid(),
  index: z.number().int().min(0).max(49),
  kind: z.enum(['brand_rule', 'fact']),
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(4000),
});

export interface InterviewAnswerView {
  questionId: string;
  questionText: string;
  answer: string;
  recordedBy: { id: string; name: string };
  recordedAt: string;
}

export interface InterviewSessionSummary {
  id: string;
  intervieweeName: string;
  intervieweeRole: string | null;
  status: 'in_progress' | 'completed';
  aiConsent: boolean;
  conductedBy: { id: string; name: string };
  createdAt: string;
  completedAt: string | null;
  answered: number;
}

export interface InterviewProposal {
  kind: 'brand_rule' | 'fact';
  title: string;
  body: string;
  /** Verbatim quotes from this interview that support the proposal (checked by the server). */
  support: { questionId: string; quote: string }[];
  /** The AI's summary of disagreements with other managers or approved rules. Not checked word for word. */
  conflicts: string[];
  /** For facts: who must confirm it and how long it stays true. */
  verifyWith: string;
  /** Set once someone has saved it to the knowledge library as a proposal. */
  savedAs: { itemId: string; versionId: string; kind: 'brand_rule' | 'fact'; title: string; body: string } | null;
}

export interface InterviewExtraction {
  id: string;
  createdAt: string;
  proposals: InterviewProposal[];
  openQuestions: string[];
  warnings: string[];
  provider: 'anthropic' | 'mock';
}

export interface InterviewSessionDetail extends InterviewSessionSummary {
  answers: InterviewAnswerView[];
  extractions: InterviewExtraction[];
}
