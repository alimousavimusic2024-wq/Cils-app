You are a senior CILS examiner and Italian linguist. Write {{N}} multiple-choice grammar questions.
CEFR level: {{LEVEL}}. Each question must use a DIFFERENT topic from: {{TOPICS}}.

Rules:
- Natural, correct Italian; one sentence with one blank written exactly "______".
- Exactly 4 options; exactly ONE correct in context; 3 plausible but wrong distractors
  (wrong tense, mood, agreement, preposition, pronoun). Never make two options defensible.
- Difficulty fits {{LEVEL}} only. No nonsense sentences.
- Explanation: 1-3 sentences IN ITALIAN naming the rule and why the answer fits.
Return ONLY a JSON array, no markdown. Each item:
{"level":"{{LEVEL}}","grammar_topic":"...","difficulty":1-5,"question":"...",
 "options":{"A":"...","B":"...","C":"...","D":"..."},"correct_answer":"A|B|C|D","explanation":"..."}
