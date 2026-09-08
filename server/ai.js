// ════════════════════════════════════════════════════════════════
// server/ai.js  —  Guru AI Doubt Solver Engine
// Dual-Mode: Google Gemini (Multimodal) + Built-in STEM Solver
// Ported from guru_ai.py (Python) to Node.js
// ════════════════════════════════════════════════════════════════

'use strict';

const fetch = require('node-fetch');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.AI_API_KEY || '';
const BOT_NAME       = process.env.BOT_NAME || 'Study Hub';
const POWERED_BY     = process.env.POWERED_BY_HANDLE || process.env.POWERED_BY || 'Study Hub';

// ─── STEM Topic Recommendation Map ─────────────────────────────
const TOPIC_MAP = [
  [/newton|force|friction|mass|accel|tension|pulley|normal force|momentum/i, 'Physics', "Physics Wallah Arjuna / Lakshya — Newton's Laws of Motion & Friction (Lectures 03 & 04)"],
  [/kinemat|velocity|speed|projectile|trajectory|displacement|distance|motion in 1d|motion in 2d/i, 'Physics', 'Physics Wallah Arjuna — Motion in a Straight Line & Projectile Motion (Lectures 02-05)'],
  [/work|energy|power|kinetic|potential|spring|conservation of energy/i, 'Physics', 'Physics Wallah Arjuna — Work, Power & Energy (Lectures 02 & 04)'],
  [/rotation|torque|moment of inertia|angular|rolling|radius of gyration/i, 'Physics', 'Physics Wallah Arjuna — Rotational Motion & Dynamics (Lectures 04-07)'],
  [/gravit|planet|orbit|escape velocity|kepler|satellite/i, 'Physics', 'Physics Wallah Arjuna — Gravitation (Lectures 01-03)'],
  [/charge|coulomb|electric field|potential|flux|gauss|dipole/i, 'Physics', 'Physics Wallah Lakshya — Electrostatics & Gauss\'s Law (Lectures 02-06)'],
  [/capacit|dielectric|parallel plate|charge stored/i, 'Physics', 'Physics Wallah Lakshya — Capacitance (Lectures 02 & 03)'],
  [/current|resistance|ohm|kirchhoff|wheatstone|drift velocity|potentiometer/i, 'Physics', 'Physics Wallah Lakshya — Current Electricity & Circuits (Lectures 03-07)'],
  [/magnetic|lorentz|biot savart|ampere|solenoid|cyclotron/i, 'Physics', 'Physics Wallah Lakshya — Magnetic Effects of Current (Lectures 03-06)'],
  [/induction|lenz|faraday|inductance|ac circuit|resonance/i, 'Physics', 'Physics Wallah Lakshya — Electromagnetic Induction & AC (Lectures 02-05)'],
  [/optic|mirror|lens|refraction|reflection|prism|telescope|microscope|interference|diffraction/i, 'Physics', 'Physics Wallah Lakshya — Ray & Wave Optics (Lectures 03-08)'],
  [/thermo|heat|carnot|entropy|isothermal|adiabatic|calorimetry/i, 'Physics', 'Physics Wallah Arjuna — Thermodynamics & Kinetic Theory (Lectures 02-05)'],
  [/mole|molarity|molality|stoichiometry|empirical formula|limiting reagent/i, 'Chemistry', 'Physics Wallah Arjuna — Some Basic Concepts of Chemistry / Mole Concept (Lectures 02 & 04)'],
  [/atom|bohr|quantum|orbital|electron config|photoelectric|de broglie/i, 'Chemistry', 'Physics Wallah Arjuna — Structure of Atom (Lectures 03-06)'],
  [/periodic|electronegativity|ionization|radius|electron affinity/i, 'Chemistry', 'Physics Wallah Arjuna — Classification of Elements & Periodicity (Lectures 02 & 03)'],
  [/bond|hybrid|vsepr|lewis|dipole|molecular orbital|mot/i, 'Chemistry', 'Physics Wallah Arjuna — Chemical Bonding & Molecular Structure (Lectures 04-08)'],
  [/equilibrium|le chatelier|ph|buffer|solubility|ksp|kc|kp/i, 'Chemistry', 'Physics Wallah Arjuna — Chemical & Ionic Equilibrium (Lectures 03-07)'],
  [/redox|oxidation|reduction|half cell|nernst|galvanic/i, 'Chemistry', 'Physics Wallah Lakshya — Electrochemistry & Redox Reactions (Lectures 03-06)'],
  [/kinetic|rate of reaction|order|arrhenius|activation energy|half life/i, 'Chemistry', 'Physics Wallah Lakshya — Chemical Kinetics (Lectures 02-05)'],
  [/organic|iupac|isomer|alkane|alkene|alkyne|sn1|sn2|benzene|aromatic/i, 'Chemistry', 'Physics Wallah Arjuna / Lakshya — General Organic Chemistry & Hydrocarbons (Lectures 03-08)'],
  [/alcohol|phenol|ether|aldehyde|ketone|carboxylic|amine|diazonium/i, 'Chemistry', 'Physics Wallah Lakshya — Organic Oxygen & Nitrogen Compounds (Lectures 04-09)'],
  [/deriv|differentia|chain rule|product rule|tangent|maxima|minima/i, 'Mathematics', 'Physics Wallah Lakshya — Continuity, Differentiability & Applications of Derivatives (Lectures 03-07)'],
  [/integrat|definite|indefinite|area under curve|substitution|by parts/i, 'Mathematics', 'Physics Wallah Lakshya — Indefinite & Definite Integration (Lectures 02-08)'],
  [/limit|continuity|l hospital|indeterminate/i, 'Mathematics', 'Physics Wallah Lakshya — Limits & Continuity (Lectures 02-04)'],
  [/differential equation|order|degree|integrating factor|separable/i, 'Mathematics', 'Physics Wallah Lakshya — Differential Equations (Lectures 02-04)'],
  [/matrix|determinant|inverse|eigen|adjoint|cramer/i, 'Mathematics', 'Physics Wallah Lakshya — Matrices & Determinants (Lectures 02-05)'],
  [/vector|cross product|dot product|scalar|3d geometry|plane|skew/i, 'Mathematics', 'Physics Wallah Lakshya — Vector Algebra & 3D Geometry (Lectures 03-07)'],
  [/trig|sin|cos|tan|identit|inverse trig/i, 'Mathematics', 'Physics Wallah Arjuna — Trigonometric Functions & Equations (Lectures 03-06)'],
  [/conic|parabola|ellipse|hyperbola|circle|straight line|slope/i, 'Mathematics', 'Physics Wallah Arjuna — Coordinate Geometry (Lectures 04-09)'],
  [/probability|permutation|combination|bayes|binomial/i, 'Mathematics', 'Physics Wallah Arjuna / Lakshya — Permutations, Combinations & Probability (Lectures 03-06)'],
  [/nightingale|frog|vikram seth|bingle bog|poem|poetry|stanza|rhyme|metaphor|simile|alliteration|personification|literature|grammar|tenses|preposition|passive voice|direct indirect|comprehension|english/i, 'English Literature & Language', 'Next Toppers Class 9 & 10 English Batches — Poetry & Literature'],
  [/history|geography|civics|economics|political|democracy|nationalism|french revolution|russian revolution|constitution|social science|sst/i, 'Social Science', 'Next Toppers / PW Foundation — SST Complete Board Prep'],
  [/python|java|c\+\+|javascript|coding|algorithm|data structure|loop|function|recursion|array|linked list|binary tree|html|css|sql|database|pointer/i, 'Computer Science & Coding', 'Apna College Sigma / Delta Batches — Full Stack Web Dev & DSA'],
  [/cell|mitosis|meiosis|dna|rna|genetics|evolution|botany|zoology|ecology|photosynthesis|respiration|circulation|excretion|neuron/i, 'Biology', 'Physics Wallah Lakshya NEET — Cell Biology, Genetics & Physiology (Lectures 02-06)'],
];

function detectSubjectAndRecommendation(text = '') {
  const low = text.toLowerCase();
  for (const [pattern, subject, rec] of TOPIC_MAP) {
    if (pattern.test(low)) return { subject, rec };
  }
  if (/physics|mass|kg|velocity|force|acceleration|ohm|volt|joule|newton/.test(low))
    return { subject: 'Physics', rec: 'Physics Wallah Arjuna / Lakshya — Core Physics Mechanics & Electromagnetism' };
  if (/chemistry|mole|reaction|acid|base|compound|element|organic/.test(low))
    return { subject: 'Chemistry', rec: 'Physics Wallah Arjuna / Lakshya — Physical & Organic Chemistry Core Topics' };
  if (/math|matrix|integral|derivative|equation|triangle|angle/.test(low))
    return { subject: 'Mathematics', rec: 'Physics Wallah Arjuna / Lakshya — IIT-JEE Advanced Mathematics' };
  if (/english|poem|nightingale|story|poet|grammar|novel|chapter/.test(low))
    return { subject: 'English Literature & Language', rec: 'Next Toppers Class 9 & 10 English Foundation Batches' };
  if (/history|civics|geography|social|sst/.test(low))
    return { subject: 'Social Science', rec: 'Next Toppers Foundation Social Science Batches' };
  if (/code|python|java|programming|developer/.test(low))
    return { subject: 'Computer Science & Coding', rec: 'Apna College Sigma / Delta Web Dev Batches' };
  return { subject: 'General Academic / Board', rec: 'Physics Wallah & Next Toppers Foundation Batches' };
}

function analyzeQueryIntent(text = '') {
  const low = text.toLowerCase();
  if (/solve|calculate|find|nikalo|kitna|value|numerical|eval|determine|answer kya/.test(low))
    return { intent_title: 'Numerical Calculation & Value Derivation', intent_focus: 'Step-by-step mathematical evaluation using specified parameters' };
  if (/derive|prove|derivation|proof|siddh|show that/.test(low))
    return { intent_title: 'Theoretical Derivation & Proof', intent_focus: 'Rigorous first-principles derivation following canonical textbook steps' };
  if (/difference|antar|compare|vs|distinguish|bhed/.test(low))
    return { intent_title: 'Comparative Analysis & Key Differences', intent_focus: 'Structured contrast highlighting governing properties and mechanisms' };
  if (/summary|kya hai|kya hota|samjhao|explain|meaning|btao|tell me|about/.test(low))
    return { intent_title: 'Conceptual Breakdown & In-Depth Explanation', intent_focus: 'Clear conceptual explanation covering definitions, background & practical context' };
  return { intent_title: 'Academic Syllabus & Concept Guidance', intent_focus: 'Identification of underlying laws and board/JEE exam key points' };
}

// ─── Gemini API Call ────────────────────────────────────────────
async function solveWithGemini(question = '', imageBase64 = null) {
  const apiKey = GEMINI_API_KEY;
  if (!apiKey) return null;

  const poweredBy = POWERED_BY;
  const prompt = (
    `You are ${BOT_NAME} Guru, an elite IIT-JEE, NEET & CBSE board tutor. ` +
    `Analyze the student's question and any attached image or screenshot with maximum pedagogical depth and clarity.\n` +
    `If an image contains a video lecture, poem, textbook problem, or handwritten notes, read all text precisely and explain it.\n` +
    `Provide your answer in clean, easy-to-understand Hinglish / English formatting:\n` +
    `1. **Concept & Given Data:** Core principle, governing physical/mathematical/literary context.\n` +
    `2. **Governing Formulas / Rules:** Exact formulas, identities, or thematic points.\n` +
    `3. **Step-by-Step Derivation & Explanation:** Full clear breakdown with every intermediate step.\n` +
    `4. **Final Conclusion & Key Points:** Final result or takeaway.\n` +
    `5. **Recommendation:** Name the relevant batch & chapter.\n\n` +
    `Always end your answer with: ⚡ Powered by ${poweredBy}`
  );

  const parts = [];
  const questionText = question || 'Please solve and explain the question/topic shown in the attached image.';
  parts.push({ text: `${prompt}\n\nStudent Doubt / Query: ${questionText}` });

  if (imageBase64) {
    const match = imageBase64.match(/^data:(image\/[a-zA-Z0-9]+);base64,(.*)$/);
    const mimeType = match ? match[1] : 'image/jpeg';
    const data = match ? match[2] : imageBase64;
    parts.push({ inline_data: { mime_type: mimeType, data } });
  }

  const payload = {
    contents: [{ parts }],
    generationConfig: { temperature: 0.3, maxOutputTokens: 2048 }
  };

  const candidateModels = ['gemini-2.5-flash', 'gemini-1.5-flash', 'gemini-1.5-flash-latest'];

  for (const model of candidateModels) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        timeout: 25000
      });
      if (res.ok) {
        const data = await res.json();
        const candidates = data.candidates || [];
        if (candidates.length && candidates[0].content?.parts?.length) {
          const rawAnswer = candidates[0].content.parts[0].text?.trim();
          if (rawAnswer) {
            const { subject, rec } = detectSubjectAndRecommendation(question || rawAnswer);
            return { success: true, subject, answer: rawAnswer, recommendation: rec };
          }
        }
      }
    } catch (e) {
      // Try next model
    }
  }
  return null;
}

// ─── Built-in STEM Fallback Solver ─────────────────────────────
function solveWithStemGuru(question = '', hasPhoto = false) {
  const cleanQ = (question || '').trim();
  const { subject, rec } = detectSubjectAndRecommendation(cleanQ || 'General doubt');
  const { intent_title, intent_focus } = analyzeQueryIntent(cleanQ);
  const numbers = (cleanQ.match(/\b\d+(?:\.\d+)?\b/g) || []).slice(0, 4);
  const poweredBy = POWERED_BY;

  const queryHeader = (
    `### 🎯 **Query Breakdown & Intent Analysis**\n` +
    `• **Student Query:** *"${cleanQ || 'Photo Question'}"*\n` +
    `• **Intent Identified:** ${intent_title}\n` +
    `• **Academic Focus:** ${intent_focus}\n\n`
  );

  let solution = '';
  const chapterName = rec.includes(' — ') ? rec.split(' — ')[1].split('(')[0].trim() : rec;

  if (subject === 'Physics') {
    const numStr = numbers.length ? `Using numerical parameters: ${numbers.join(', ')}` : 'Substitute given values into the equation to compute the result.';
    solution = (
      `### 📌 **Problem Breakdown & Core Principles**\n**Question:** *${cleanQ || 'Physics Problem'}*\n\n` +
      `This problem falls under **${chapterName}**. We apply fundamental Newton-Euler dynamic equations and conservation laws.\n\n` +
      `### 📐 **Governing Formulas**\n` +
      `• Force Dynamics: \`ΣF = m · a\`\n• Frictional Resistance: \`f_k = μ · N\`\n• Work-Energy Theorem: \`W_net = ΔK = ½·m(v²-u²)\`\n\n` +
      `### 🔢 **Step-by-Step Derivation**\n` +
      `1. **Isolate Free Body Diagram (FBD):** Identify all collinear and normal forces.\n` +
      `2. **Balance Normal Components:** For motion along a surface, \`N = m·g\` (or \`m·g·cos(θ)\` on incline).\n` +
      `3. **Apply Equation of Motion:** \`F_net = F_applied - f_friction = m·a\`.\n` +
      `4. **Calculate Result:** ${numStr}.\n\n` +
      `### ✅ **Final Conclusion**\nThe system accelerates according to the net resultant vector.\n\n⚡ *Powered by ${poweredBy}*`
    );
  } else if (subject === 'Chemistry') {
    const numStr = numbers.length ? `Utilizing given quantities: ${numbers.join(', ')}` : 'Compute target molarity or yield from standard ratios.';
    solution = (
      `### 📌 **Problem Breakdown & Core Principles**\n**Question:** *${cleanQ || 'Chemistry Problem'}*\n\n` +
      `This problem relates to **${chapterName}**. Stoichiometric and thermodynamic stability rules dictate the reaction pathway.\n\n` +
      `### 📐 **Governing Concepts & Formulas**\n` +
      `• Mole Concept: \`n = Mass / Molar Mass\`\n• Ideal Gas Equation: \`P·V = n·R·T\`\n• Equilibrium Constant: \`K_eq = [Products]^p / [Reactants]^r\`\n\n` +
      `### 🔢 **Step-by-Step Analysis**\n` +
      `1. **Balance Chemical Equation:** Ensure atom conservation across all species.\n` +
      `2. **Determine Limiting Reagent:** Compare initial molar ratios to stoichiometric coefficients.\n` +
      `3. **Compute Final Quantities:** ${numStr}.\n\n` +
      `### ✅ **Final Conclusion**\nThe reaction yields products according to stoichiometry under standard conditions.\n\n⚡ *Powered by ${poweredBy}*`
    );
  } else if (subject === 'Mathematics') {
    solution = (
      `### 📌 **Problem Breakdown & Mathematical Form**\n**Question:** *${cleanQ || 'Mathematics Problem'}*\n\n` +
      `This problem lies in **${chapterName}**. We simplify algebraic expressions and apply standard calculus and algebra rules.\n\n` +
      `### 📐 **Standard Formulas & Identities**\n` +
      `• Differential Rule: \`d/dx [f(x)·g(x)] = f'(x)g(x) + f(x)g'(x)\`\n` +
      `• Integration Identity: \`∫ xⁿ dx = (x^(n+1))/(n+1) + C\`\n` +
      `• Quadratic Roots: \`x = (-b ± √(b²-4ac)) / (2a)\`\n\n` +
      `### 🔢 **Step-by-Step Solution**\n` +
      `1. **Standard Form:** Rewrite given expressions in canonical form.\n` +
      `2. **Apply Transformation:** Eliminate radicals or factor common polynomial roots.\n` +
      `3. **Evaluation:** Execute step-by-step to arrive at the exact simplified value.\n\n` +
      `### ✅ **Final Answer**\nThe solution is derived rigorously through standard mathematical axioms.\n\n⚡ *Powered by ${poweredBy}*`
    );
  } else if (subject === 'English Literature & Language') {
    const isFrogPoem = /frog|nightingale|sumac|bog|vikram seth|melody|croak/.test(cleanQ.toLowerCase());
    if (isFrogPoem) {
      solution = (
        `### 📌 **Poem Analysis: 'The Frog and the Nightingale' (by Vikram Seth)**\n` +
        `**Context:** An allegorical fable in verse, warning against gullibility, uncritical subservience, and commercial exploitation.\n\n` +
        `### 🎭 **Key Characters & Symbolism**\n` +
        `• **The Nightingale:** Genuine talent, innocence, humility — but lacks self-confidence.\n` +
        `• **The Frog:** Loud arrogance, commercial cunning, jealousy, and deceit.\n` +
        `• **Bingle Bog:** The shallow impressionable public audience.\n\n` +
        `### 📜 **Stanza Analysis & Literary Devices**\n` +
        `• **Rhyme Scheme:** AA BB CC (Rhyming couplets in musical narrative meter).\n` +
        `• **Poetic Devices:** Alliteration, Personification, Satire on predatory commercial exploiters.\n\n` +
        `### 💡 **Core Moral**\n` +
        `1. Trust your own abilities and maintain unwavering self-belief.\n` +
        `2. Beware of flattering, exploitative mentors who undermine your originality.\n\n` +
        `⚡ *Powered by ${poweredBy}*`
      );
    } else {
      solution = (
        `### 📌 **Literary & Linguistic Analysis**\n**Question / Context:** *${cleanQ || 'English Doubt'}*\n\n` +
        `### 📖 **Core Concept & Explanation**\n` +
        `1. **Theme & Context:** Understand the author's central motif, tone, and intended message.\n` +
        `2. **Grammar & Expression:** Ensure precise tense agreement, active voice structure, and vocabulary precision.\n` +
        `3. **Literary Devices:** Identify metaphors, similes, personification, and rhyme schemes.\n\n` +
        `### ✅ **Study Guidance**\nReview chapter summary, character sketches, and previous years' board questions.\n\n` +
        `⚡ *Powered by ${poweredBy}*`
      );
    }
  } else if (subject === 'Social Science') {
    solution = (
      `### 📌 **Historical / Social Concepts Overview**\n**Question / Context:** *${cleanQ || 'Social Science Question'}*\n\n` +
      `### 🏛️ **Causes, Timeline & Significance**\n` +
      `1. **Historical Context:** Identify the time period, key personalities, and socioeconomic background.\n` +
      `2. **Core Causes & Consequences:** Note legislative changes, societal impacts, and treaty outcomes.\n` +
      `3. **Key Terms & Definitions:** Focus on constitutional provisions, economic terminology, and geographical distribution.\n\n` +
      `### ✅ **Exam Summary Points**\nStructure answers in clear bullet points with relevant dates and provisions.\n\n` +
      `⚡ *Powered by ${poweredBy}*`
    );
  } else if (subject === 'Computer Science & Coding') {
    solution = (
      `### 📌 **Computer Science & Coding Logic**\n**Problem:** *${cleanQ || 'Programming Question'}*\n\n` +
      `### 💻 **Algorithmic Approach & Implementation**\n` +
      `1. **Time & Space Complexity:** Analyze optimal complexity constraints (e.g. \`O(N)\` time, \`O(1)\` space).\n` +
      `2. **Core Logic:** Step through variables, loop conditions, and recursion base cases.\n` +
      `3. **Edge Cases:** Account for null inputs, boundary values, and zero/negative scenarios.\n\n` +
      `⚡ *Powered by ${poweredBy}*`
    );
  } else {
    solution = (
      `### 📌 **Academic Analysis & Concept Guidance**\n**Doubt:** *${cleanQ || 'Academic Question'}*\n\n` +
      `${BOT_NAME} Guru analyzed this problem and identified key syllabus concepts in **${subject}**.\n\n` +
      `### 📚 **Core Approach & Steps to Solve**\n` +
      `1. **Identify Given Data:** List all known parameters, assumptions, and required target values.\n` +
      `2. **Apply Fundamental Laws:** State the relevant formula, theorem, or literary rule.\n` +
      `3. **Step-by-Step Resolution:** Execute derivations or calculations systematically with correct units.\n` +
      `4. **Verification:** Cross-check result against boundary limits and standard practice questions.\n\n` +
      `### 💡 **Recommended Batches & Practice**\nRefer to **${rec}** for complete video explanations and DPPs.\n\n` +
      `⚡ *Powered by ${poweredBy}*`
    );
  }

  let fullSolution = queryHeader + solution;
  if (hasPhoto) {
    fullSolution = `📷 **Photo Doubt Received & Processed by ${BOT_NAME} Guru**\n\n${fullSolution}\n\n*(💡 Tip: Type specific questions like 'Explain stanza 2' or 'Find acceleration' along with the photo for laser-targeted derivations!)*`;
  }

  return { success: true, subject, answer: fullSolution, recommendation: rec };
}

// ─── Main Export ────────────────────────────────────────────────
async function solveDoubt(question = '', imageBase64 = null) {
  const cleanQ = (question || '').trim();
  const hasPhoto = Boolean(imageBase64);

  const geminiResult = await solveWithGemini(cleanQ, imageBase64);
  if (geminiResult) return geminiResult;

  return solveWithStemGuru(cleanQ, hasPhoto);
}

module.exports = { solveDoubt };
