const {
  defaultStatusMap,
  normalizeStatusMap,
  effectiveStatusMap,
  handlerForStatus,
  stageForJiraStatus,
  jiraStatusForStage,
} = require('../../src/lib/statusHandlerMap');

describe('statusHandlerMap (lifecycle stages)', () => {
  it('defaults cover the five stages', () => {
    const map = defaultStatusMap();
    expect(map.open.jiraStatus).toBe('Open');
    expect(map.in_progress.jiraStatus).toBe('In Progress');
    expect(map.in_qa.jiraStatus).toBe('In QA');
    expect(map.ready_for_release.jiraStatus).toBe('Ready for Release');
    expect(map.done.jiraStatus).toBe('Done');
  });

  it('normalizes stage entries and match aliases', () => {
    expect(
      normalizeStatusMap({
        open: { jiraStatus: 'To Do', match: ['Open', 'Backlog'] },
        in_progress: 'Doing',
      })
    ).toEqual({
      open: { jiraStatus: 'To Do', match: ['To Do', 'Open', 'Backlog'] },
      in_progress: { jiraStatus: 'Doing', match: ['Doing'] },
    });
  });

  it('ignores legacy Jira→action maps', () => {
    expect(normalizeStatusMap({ 'Ready for QA': 'toStaging', Done: 'toDevelop' })).toBeNull();
  });

  it('maps Jira statuses to stages and handlers', () => {
    const map = {
      in_qa: { jiraStatus: 'In QA', match: ['In QA'] },
      ready_for_release: { jiraStatus: 'Ready for Release', match: ['Approved'] },
    };
    expect(stageForJiraStatus('In QA', map)).toBe('in_qa');
    expect(stageForJiraStatus('Approved', map)).toBe('ready_for_release');
    expect(handlerForStatus('In QA', map)).toBe('toStaging');
    expect(handlerForStatus('Approved', map)).toBe('toDevelop');
    expect(handlerForStatus('QA Failed', map)).toBeNull();
  });

  it('resolves the Jira status name to transition to for a stage', () => {
    expect(jiraStatusForStage('in_progress', null)).toBe('In Progress');
    expect(jiraStatusForStage('done', { done: { jiraStatus: 'Closed' } })).toBe('Closed');
  });

  it('effectiveStatusMap fills missing stages from defaults', () => {
    const effective = effectiveStatusMap({ in_qa: { jiraStatus: 'QA' } });
    expect(effective.in_qa.jiraStatus).toBe('QA');
    expect(effective.open.jiraStatus).toBe('Open');
  });
});
