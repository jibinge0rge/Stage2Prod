const {
  isUnderDevelopment,
  isToDo,
  matchesTicketFilter,
  filterTickets,
  buildTicketFilters,
  stageForTicket,
} = require('../../web/src/lib/ticketFilters.js');

describe('stage filters', () => {
  const map = {
    open: { jiraStatus: 'Open', match: ['Open', 'To Do'] },
    in_progress: { jiraStatus: 'In Progress', match: ['In Progress', 'In Development'] },
    in_qa: { jiraStatus: 'In QA', match: ['In QA'] },
    ready_for_release: { jiraStatus: 'Ready for Release', match: ['Ready for Release'] },
    done: { jiraStatus: 'Done', match: ['Done'] },
  };

  const tickets = [
    { key: 'A', jiraStatus: 'To Do', pipelineState: 'unmerged' },
    { key: 'B', jiraStatus: 'In Progress', pipelineState: 'unmerged' },
    { key: 'C', jiraStatus: 'In QA', pipelineState: 'staging' },
    { key: 'D', jiraStatus: 'Ready for Release', pipelineState: 'queued' },
    { key: 'E', jiraStatus: 'Done', pipelineState: 'develop' },
  ];

  it('classifies tickets by mapped Jira status', () => {
    expect(stageForTicket(tickets[0], map)).toBe('open');
    expect(stageForTicket(tickets[1], map)).toBe('in_progress');
    expect(stageForTicket(tickets[2], map)).toBe('in_qa');
    expect(stageForTicket(tickets[3], map)).toBe('ready_for_release');
    expect(stageForTicket(tickets[4], map)).toBe('done');
  });

  it('filters by the five lifecycle stages only', () => {
    expect(filterTickets(tickets, 'open', map).map((t) => t.key)).toEqual(['A']);
    expect(filterTickets(tickets, 'in_progress', map).map((t) => t.key)).toEqual(['B']);
    expect(filterTickets(tickets, 'in_qa', map).map((t) => t.key)).toEqual(['C']);
    expect(filterTickets(tickets, 'ready_for_release', map).map((t) => t.key)).toEqual(['D']);
    expect(filterTickets(tickets, 'done', map).map((t) => t.key)).toEqual(['E']);
  });

  it('buildTicketFilters does not list arbitrary Jira statuses', () => {
    const filters = buildTicketFilters(tickets, { statusHandlerMap: map });
    expect(filters.map((f) => f.id)).toEqual([
      'all',
      'open',
      'in_progress',
      'in_qa',
      'ready_for_release',
      'done',
    ]);
  });

  it('isUnderDevelopment / isToDo follow stage mapping', () => {
    expect(isToDo(tickets[0], map)).toBe(true);
    expect(isUnderDevelopment(tickets[1], map)).toBe(true);
    expect(isUnderDevelopment(tickets[2], map)).toBe(false);
  });

  it('matchesTicketFilter all returns everything', () => {
    expect(filterTickets(tickets, 'all', map)).toHaveLength(5);
    expect(matchesTicketFilter(tickets[0], 'all', map)).toBe(true);
  });
});
