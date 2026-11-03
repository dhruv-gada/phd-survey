// Seconds each student gets per question. When it runs out, the question is skipped.
const TIME_LIMIT = 45;

// Single source of truth for the survey. Shared by the server (validation +
// aggregation) and the browser (rendering), served at /questions.js.
const QUESTIONS = [
  {
    id: "q1",
    type: "single",
    title: "Your first-choice path after the PhD",
    hint: "Pick one",
    options: [
      { id: "academia", label: "Academia (incl. postdoctoral research)" },
      { id: "industry", label: "Industry" },
      { id: "startup", label: "Found or join an early startup" },
      { id: "government", label: "Government or national lab research" },
      { id: "other", label: "Other" },
    ],
    otherId: "other",
  },
  {
    id: "q2",
    type: "matrix",
    title: "Are there enough content-rich courses to help you prepare for your final goals?",
    hint: "Answer for each area",
    rows: [
      { id: "engineering", label: "Engineering" },
      { id: "biology", label: "Biology" },
      { id: "professional", label: "Professional" },
    ],
    options: [
      { id: "yes", label: "Yes" },
      { id: "somewhat", label: "Somewhat" },
      { id: "no", label: "No" },
    ],
  },
  {
    id: "q3",
    type: "multi",
    title: "How can our program help your publication / patent output?",
    hint: "Select all that apply",
    options: [
      { id: "collab", label: "More collaborative opportunities" },
      { id: "faculty", label: "More faculty time" },
      { id: "conferences", label: "Free conference attendance" },
      { id: "funding", label: "Increased lab funding" },
      { id: "bureaucracy", label: "Less bureaucracy / paperwork time" },
    ],
  },
  {
    id: "q4",
    type: "multi",
    title: "Which skills or professional experiences would you most like to focus on?",
    hint: "Select all that apply",
    options: [
      { id: "teaching", label: "Teaching" },
      { id: "communication", label: "Communication" },
      { id: "grants", label: "Grant writing" },
      { id: "mentorship", label: "Mentorship" },
      { id: "networking", label: "Networking" },
      { id: "internship", label: "Internship during PhD" },
    ],
  },
];

if (typeof module !== "undefined") module.exports = { QUESTIONS, TIME_LIMIT };
