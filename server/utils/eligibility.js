// utils/eligibility.js
// Compares ONE user's profile with ONE scheme and decides:
//   'eligible' -> every rule the scheme has is met
//   'possible' -> no rule fails, but some profile fields it needs are empty
//   'not'      -> at least one rule fails
// It also writes plain-English sentences explaining WHY (the "gap indicator"), e.g.
//   "Your family income meets the requirement, but this scholarship is only for
//    undergraduate students."

// Words used when we talk about education levels in sentences
const EDUCATION_WORDS = {
  class10: 'Class 10',
  class12: 'Class 12',
  diploma: 'diploma',
  ug: 'undergraduate',
  pg: 'postgraduate'
};

// "SC,ST" -> ['SC', 'ST']   ("" -> [])
function toList(text) {
  return (text || '').split(',').map((item) => item.trim()).filter(Boolean);
}

// ['a'] -> "a",  ['a','b'] -> "a and b",  ['a','b','c'] -> "a, b and c"
function joinWords(items, word = 'and') {
  if (items.length <= 1) return items.join('');
  return items.slice(0, -1).join(', ') + ' ' + word + ' ' + items[items.length - 1];
}

function capitalize(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// 250000 -> "₹2,50,000" (Indian number format)
function rupees(amount) {
  return '₹' + Number(amount).toLocaleString('en-IN');
}

function isEmpty(value) {
  return value === null || value === undefined || value === '';
}

// '2005-03-10' -> age in full years today
function ageFromDob(dob) {
  const [year, month, day] = dob.split('-').map(Number);
  const today = new Date();
  let age = today.getFullYear() - year;
  const hadBirthdayThisYear =
    today.getMonth() + 1 > month || (today.getMonth() + 1 === month && today.getDate() >= day);
  if (!hadBirthdayThisYear) age--;
  return age;
}

function checkEligibility(profile, scheme) {
  profile = profile || {};
  const word = scheme.type === 'welfare' ? 'scheme' : 'scholarship';

  // Every rule the scheme has adds one entry here:
  //   label       -> used in "Your <label> meets the requirement"
  //   requirement -> what the scheme needs, e.g. "Family income up to ₹2,50,000 per year"
  //   result      -> 'met' | 'failed' | 'missing'
  //   problem     -> the reason, only when result is 'failed'
  //   askFor      -> used in "Add your <askFor> to your profile" (when the field is empty)
  const checks = [];
  function add(label, requirement, result, problem, askFor) {
    checks.push({ label, requirement, result, problem, askFor: askFor || label });
  }

  // 1. State
  const states = toList(scheme.allowed_states);
  if (states.length > 0) {
    const need = `Resident of ${joinWords(states, 'or')}`;
    if (isEmpty(profile.state)) add('state', need, 'missing');
    else if (states.includes(profile.state)) add('state', need, 'met');
    else add('state', need, 'failed', `this ${word} is only for residents of ${joinWords(states, 'or')}`);
  }

  // 2. Category (General / OBC / SC / ST / EWS)
  const categories = toList(scheme.allowed_categories);
  if (categories.length > 0) {
    const need = `${joinWords(categories, 'or')} category`;
    if (isEmpty(profile.category)) add('category', need, 'missing');
    else if (categories.includes(profile.category)) add('category', need, 'met');
    else add('category', need, 'failed', `this ${word} is only for the ${joinWords(categories, 'or')} category`);
  }

  // 3. Education level
  const levels = toList(scheme.allowed_education);
  if (levels.length > 0) {
    const levelWords = joinWords(levels.map((level) => EDUCATION_WORDS[level] || level), 'or');
    const need = `Currently a ${levelWords} student`;
    if (isEmpty(profile.education_level)) add('education level', need, 'missing');
    else if (levels.includes(profile.education_level)) add('education level', need, 'met');
    else add('education level', need, 'failed', `this ${word} is only for ${levelWords} students`);
  }

  // 4. Gender
  if (scheme.gender && scheme.gender !== 'any') {
    const need = `${capitalize(scheme.gender)} applicants only`;
    if (isEmpty(profile.gender)) add('gender', need, 'missing');
    else if (profile.gender === scheme.gender) add('gender', need, 'met');
    else add('gender', need, 'failed', `this ${word} is only for ${scheme.gender} applicants`);
  }

  // 5. Family income (must be at or below the limit)
  if (!isEmpty(scheme.max_income)) {
    const need = `Family income up to ${rupees(scheme.max_income)} per year`;
    if (isEmpty(profile.annual_income)) add('family income', need, 'missing');
    else if (profile.annual_income <= scheme.max_income) add('family income', need, 'met');
    else add('family income', need, 'failed',
      `the family income limit is ${rupees(scheme.max_income)} per year (yours is ${rupees(profile.annual_income)})`);
  }

  // 6. Marks (must be at or above the minimum)
  if (!isEmpty(scheme.min_marks)) {
    const need = `At least ${scheme.min_marks}% marks`;
    if (isEmpty(profile.marks_percent)) add('marks', need, 'missing');
    else if (profile.marks_percent >= scheme.min_marks) add('marks', need, 'met');
    else add('marks', need, 'failed', `it needs at least ${scheme.min_marks}% marks (you have ${profile.marks_percent}%)`);
  }

  // 7. Age (worked out from date of birth)
  const hasMinAge = !isEmpty(scheme.min_age);
  const hasMaxAge = !isEmpty(scheme.max_age);
  if (hasMinAge || hasMaxAge) {
    let range;
    if (hasMinAge && hasMaxAge) range = `aged ${scheme.min_age} to ${scheme.max_age}`;
    else if (hasMinAge) range = `aged ${scheme.min_age} or above`;
    else range = `aged up to ${scheme.max_age}`;
    const need = capitalize(range);

    if (isEmpty(profile.date_of_birth)) {
      add('age', need, 'missing', null, 'date of birth');
    } else {
      const age = ageFromDob(profile.date_of_birth);
      const tooYoung = hasMinAge && age < scheme.min_age;
      const tooOld = hasMaxAge && age > scheme.max_age;
      if (!tooYoung && !tooOld) add('age', need, 'met');
      else add('age', need, 'failed', `it is only for people ${range} (you are ${age})`);
    }
  }

  // 8. Disability
  if (scheme.disability_required === 1) {
    const need = 'Persons with a disability only';
    if (isEmpty(profile.has_disability)) add('disability status', need, 'missing');
    else if (profile.has_disability === 1) add('disability status', need, 'met');
    else add('disability status', need, 'failed', `this ${word} is only for persons with a disability`);
  }

  // ---- Turn the checks into a status and sentences ----
  const met = checks.filter((c) => c.result === 'met').map((c) => c.label);
  const failed = checks.filter((c) => c.result === 'failed').map((c) => c.problem);
  const missing = checks.filter((c) => c.result === 'missing').map((c) => c.askFor);

  // "Your family income meets the requirement" / "Your state and category meet the requirements"
  let metSentence = '';
  if (met.length === 1) metSentence = `Your ${met[0]} meets the requirement`;
  if (met.length > 1) metSentence = `Your ${joinWords(met)} meet the requirements`;

  let status;
  let summary;
  if (failed.length > 0) {
    status = 'not';
    summary = metSentence
      ? `${metSentence}, but ${joinWords(failed)}.`
      : `${capitalize(joinWords(failed))}.`;
  } else if (missing.length > 0) {
    status = 'possible';
    const ask = `Add your ${joinWords(missing)} to your profile to confirm.`;
    summary = metSentence ? `${metSentence} so far. ${ask}` : ask;
  } else {
    status = 'eligible';
    summary = checks.length === 0
      ? `This ${word} has no special conditions, so anyone can apply.`
      : `You meet every requirement (${joinWords(met)}).`;
  }

  // Criterion-by-criterion list for the scheme detail page:
  // { criterion, requirement, result: 'pass' | 'fail' | 'unknown', text }
  const criteria = checks.map((c) => {
    if (c.result === 'met') {
      return { criterion: capitalize(c.label), requirement: c.requirement, result: 'pass',
        text: `Your ${c.label} meets the requirement.` };
    }
    if (c.result === 'failed') {
      return { criterion: capitalize(c.label), requirement: c.requirement, result: 'fail',
        text: `${capitalize(c.problem)}.` };
    }
    return { criterion: capitalize(c.label), requirement: c.requirement, result: 'unknown',
      text: `Add your ${c.askFor} to your profile.` };
  });

  return { status, summary, criteria };
}

module.exports = { checkEligibility, toList, joinWords, rupees };
