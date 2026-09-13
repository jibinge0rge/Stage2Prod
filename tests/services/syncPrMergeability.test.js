const { createTestDb, seedTicket } = require('../setup');
const { PIPELINE_STATES } = require('../../src/lib/constants');
const {
  syncPipelineWithPrMergeability,
  reconcileMergeConflicts,
} = require('../../src/services/syncPrMergeability');

describe('syncPipelineWithPrMergeability', () => {
  it('promotes staging_queued to conflict when PR is dirty', async () => {
    const { ticketsRepo, reposRepo } = createTestDb();
    reposRepo.add('acme', 'widgets', { stagingBranch: 'staging', productionBranch: 'main' });
    seedTicket(ticketsRepo, {
      key: 'PROJ-1',
      pipelineState: PIPELINE_STATES.STAGING_QUEUED,
      repoOwner: 'acme',
      repoName: 'widgets',
    });
    ticketsRepo.setGithubFacts('PROJ-1', { prNumber: 12, prState: 'open' });

    const row = ticketsRepo.get('PROJ-1');
    const github = {
      getPr: vi.fn().mockResolvedValue({
        state: 'open',
        mergeable: false,
        mergeableState: 'dirty',
        base: 'staging',
      }),
    };

    const next = await syncPipelineWithPrMergeability(row, { ticketsRepo, reposRepo, github });
    expect(next).toBe(PIPELINE_STATES.CONFLICT);
    expect(ticketsRepo.get('PROJ-1').pipeline_state).toBe(PIPELINE_STATES.CONFLICT);
  });

  it('restores conflict to staging_queued when GitHub reports mergeable again', async () => {
    const { ticketsRepo, reposRepo } = createTestDb();
    reposRepo.add('acme', 'widgets', { stagingBranch: 'staging', productionBranch: 'main' });
    seedTicket(ticketsRepo, {
      key: 'PROJ-1',
      pipelineState: PIPELINE_STATES.CONFLICT,
      repoOwner: 'acme',
      repoName: 'widgets',
    });
    ticketsRepo.setGithubFacts('PROJ-1', { prNumber: 12, prState: 'open' });

    const row = ticketsRepo.get('PROJ-1');
    const github = {
      getPr: vi.fn().mockResolvedValue({
        state: 'open',
        mergeable: true,
        mergeableState: 'clean',
        base: 'staging',
      }),
    };

    const next = await syncPipelineWithPrMergeability(row, { ticketsRepo, reposRepo, github });
    expect(next).toBe(PIPELINE_STATES.STAGING_QUEUED);
    expect(ticketsRepo.get('PROJ-1').pipeline_state).toBe(PIPELINE_STATES.STAGING_QUEUED);
  });

  it('reconcileMergeConflicts updates in-memory row objects for API responses', async () => {
    const { ticketsRepo, reposRepo } = createTestDb();
    reposRepo.add('acme', 'widgets', { stagingBranch: 'staging', productionBranch: 'main' });
    seedTicket(ticketsRepo, {
      key: 'PROJ-1',
      pipelineState: PIPELINE_STATES.STAGING_QUEUED,
      repoOwner: 'acme',
      repoName: 'widgets',
    });
    ticketsRepo.setGithubFacts('PROJ-1', { prNumber: 12, prState: 'open' });

    const rows = [ticketsRepo.get('PROJ-1')];
    const repoResolver = {
      getClient: () => ({
        getPr: vi.fn().mockResolvedValue({
          state: 'open',
          mergeable: false,
          mergeableState: 'dirty',
          base: 'staging',
        }),
      }),
    };

    await reconcileMergeConflicts(rows, { ticketsRepo, reposRepo, repoResolver });
    expect(rows[0].pipeline_state).toBe(PIPELINE_STATES.CONFLICT);
  });
});
