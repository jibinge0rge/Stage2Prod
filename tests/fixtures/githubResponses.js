function branch(name, sha = 'abc1234') {
  return { name, commit: { sha } };
}

function openPull({ number, headRef, baseRef = 'develop', sha = 'def5678' }) {
  return { number, head: { ref: headRef, sha }, base: { ref: baseRef } };
}

function checkRunsResponse(overall) {
  if (overall === 'passing') return { check_runs: [{ status: 'completed', conclusion: 'success' }] };
  if (overall === 'failing') return { check_runs: [{ status: 'completed', conclusion: 'failure' }] };
  return { check_runs: [{ status: 'in_progress', conclusion: null }] };
}

function combinedStatusResponse(overall) {
  if (overall === 'passing') return { state: 'success' };
  if (overall === 'failing') return { state: 'failure' };
  return { state: 'pending' };
}

module.exports = { branch, openPull, checkRunsResponse, combinedStatusResponse };
