const personalInfoPatterns = [
  /\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b/i,
  /\b(?:instagram|insta|snapchat|snap)\s*[:@]?\s*[\w.-]{2,}\b/i,
  /(?:\+?\d[\d\s().-]{7,}\d)/,
];

export function containsPersonalInfo(text: string): boolean {
  return personalInfoPatterns.some((pattern) => pattern.test(text));
}
