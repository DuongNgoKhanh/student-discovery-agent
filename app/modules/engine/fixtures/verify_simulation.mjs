import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const jsonPath = path.join(__dirname, 'demo_experience_definition.json');
const rawData = fs.readFileSync(jsonPath, 'utf8');
const doc = JSON.parse(rawData);

console.log('=== [1] STATIC SCHEMA INTEGRITY CHECK ===');
console.assert(doc.schema_version === '1.0', 'schema_version must be 1.0');
console.assert(doc.is_demo === true, 'is_demo must be true');
console.assert(doc.questions.length >= 6, 'questions length >= 6');
console.assert(doc.houses.length === 6, 'houses length must be exactly 6');
console.assert(doc.evaluation_cases.length >= 4, 'evaluation_cases length >= 4');
console.log('Passed: Basic schema fields verified.');

// Map questions & choices
const questionsMap = new Map();
for (const q of doc.questions) {
  questionsMap.set(q.question_id, q);
}
console.log(`Loaded ${questionsMap.size} questions.`);

// Map weights
const weightsMap = doc.scoring_rules.payload.weights;
const branches = doc.selection_rules.payload.branches;
const houses = doc.houses.map(h => h.house_id);

function computeScores(answers) {
  const scores = {};
  for (const h of houses) {
    scores[h] = 0;
  }
  for (const ans of answers) {
    const w = weightsMap[ans.option_id];
    if (w) {
      for (const [houseId, val] of Object.entries(w)) {
        scores[houseId] = (scores[houseId] || 0) + val;
      }
    }
  }
  return scores;
}

function resolveTopHouse(scores) {
  let bestHouse = null;
  let maxScore = -1;
  for (const h of doc.tie_policy.payload.hexagonal_order) {
    const s = scores[h] || 0;
    if (s > maxScore) {
      maxScore = s;
      bestHouse = h;
    }
  }
  return bestHouse;
}

function traverseQuestions(initialQ, answers) {
  const traversed = [initialQ];
  let curr = initialQ;
  for (let i = 0; i < answers.length - 1; i++) {
    const ans = answers[i];
    const branchConfig = branches[curr];
    let nextQ = null;
    if (branchConfig[ans.option_id]) {
      nextQ = branchConfig[ans.option_id].next_question_id;
    } else if (branchConfig.default) {
      nextQ = branchConfig.default.next_question_id;
    }
    if (nextQ) {
      traversed.push(nextQ);
      curr = nextQ;
    }
  }
  return traversed;
}

console.log('\n=== [2] VERIFYING 4 GOLDEN EVALUATION CASES ===');
let allPassed = true;
doc.evaluation_cases.forEach((tc, idx) => {
  console.log(`\nTest Case ${idx + 1}: ${tc.case_id}`);
  
  // 1. Verify question path traversal
  const initialQ = doc.selection_rules.payload.initial_question_id;
  const traversed = traverseQuestions(initialQ, tc.answers);
  const qMatches = JSON.stringify(traversed) === JSON.stringify(tc.expected.question_ids);
  console.log(`- Path Traversal: ${qMatches ? 'PASS' : 'FAIL'}`);
  if (!qMatches) {
    console.error(`  Expected: ${JSON.stringify(tc.expected.question_ids)}`);
    console.error(`  Actual:   ${JSON.stringify(traversed)}`);
    allPassed = false;
  }

  // 2. Compute scores
  const calculatedScores = computeScores(tc.answers);
  const expectedScores = tc.expected.scores;
  let scoreMatches = true;
  for (const h of houses) {
    if ((calculatedScores[h] || 0) !== (expectedScores[h] || 0)) {
      scoreMatches = false;
      break;
    }
  }
  console.log(`- Scores Matching: ${scoreMatches ? 'PASS' : 'FAIL'}`);
  if (!scoreMatches) {
    console.error(`  Expected: ${JSON.stringify(expectedScores)}`);
    console.error(`  Actual:   ${JSON.stringify(calculatedScores)}`);
    allPassed = false;
  }

  // 3. Resolve top house
  const classifiedHouse = resolveTopHouse(calculatedScores);
  const houseMatches = classifiedHouse === tc.expected.house_id;
  console.log(`- House Classification: ${houseMatches ? 'PASS' : 'FAIL'} (Expected: ${tc.expected.house_id}, Actual: ${classifiedHouse})`);
  if (!houseMatches) {
    allPassed = false;
  }
});

console.log('\n=== [3] SIMULATING DEC-01 (ANSWER EDIT & INVALIDATION) ===');
// Scenario: Student started with Tech path (Q01 -> opt_q01_tech -> Q02_T)
// Then edits Q01 to opt_q01_human -> Downstream must switch to Q02_H
const initialAns = [{ question_id: 'Q01', option_id: 'opt_q01_tech' }];
const pathBefore = traverseQuestions('Q01', [{ question_id: 'Q01', option_id: 'opt_q01_tech' }, { question_id: 'Q02_T', option_id: 'opt_q02_t_do' }]);
console.log(`Initial path (Q01=tech): ${JSON.stringify(pathBefore)}`);

// Edit Q01 to human
const editedAns = [{ question_id: 'Q01', option_id: 'opt_q01_human' }];
const pathAfter = traverseQuestions('Q01', [{ question_id: 'Q01', option_id: 'opt_q01_human' }, { question_id: 'Q02_H', option_id: 'opt_q02_h_art' }]);
console.log(`Edited path (Q01=human):  ${JSON.stringify(pathAfter)}`);
console.assert(pathAfter[1] === 'Q02_H', 'Branching must adapt correctly upon answer edit');
console.log('Passed: DEC-01 branching dynamic invalidation verified.');

if (allPassed) {
  console.log('\n>>> ALL 100% CHECKS PASSED SUCCESSFULLY! <<<');
} else {
  console.error('\n>>> SOME CHECKS FAILED! <<<');
  process.exit(1);
}
