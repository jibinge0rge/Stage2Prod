const { overallCheckStatus } = require('../../src/lib/checkStatus');

describe('overallCheckStatus', () => {
  it('is null when GitHub has zero statuses and zero check runs', () => {
    expect(overallCheckStatus({ combinedState: 'pending', statuses: [], checkRuns: [] })).toBeNull();
  });

  it('is pending when a check run is still in progress', () => {
    expect(
      overallCheckStatus({
        combinedState: 'pending',
        statuses: [],
        checkRuns: [{ status: 'in_progress', conclusion: null }],
      })
    ).toBe('pending');
  });

  it('is passing when check runs completed successfully even if combined state is pending', () => {
    expect(
      overallCheckStatus({
        combinedState: 'pending',
        statuses: [],
        checkRuns: [{ status: 'completed', conclusion: 'success' }],
      })
    ).toBe('passing');
  });

  it('is failing when any check run failed', () => {
    expect(
      overallCheckStatus({
        combinedState: 'success',
        statuses: [{ state: 'success' }],
        checkRuns: [{ status: 'completed', conclusion: 'failure' }],
      })
    ).toBe('failing');
  });
});
