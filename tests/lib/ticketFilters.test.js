const { isToDo, isUnderDevelopment, matchesTicketFilter, filterTickets } = require('../../web/src/lib/ticketFilters.js');

describe('isUnderDevelopment', () => {
  it('matches Jira In Progress that has not reached staging', () => {
    expect(isUnderDevelopment({ jiraStatus: 'In Progress', pipelineState: 'unmerged' })).toBe(true);
  });

  it('excludes tickets already on staging or production', () => {
    expect(isUnderDevelopment({ jiraStatus: 'In Progress', pipelineState: 'staging' })).toBe(false);
    expect(isUnderDevelopment({ jiraStatus: 'In Development', pipelineState: 'develop' })).toBe(false);
  });
});

describe('isToDo', () => {
  it('matches To Do / Open / Backlog that has not left development', () => {
    expect(isToDo({ jiraStatus: 'To Do', pipelineState: 'unmerged' })).toBe(true);
    expect(isToDo({ jiraStatus: 'Backlog', pipelineState: 'unmerged' })).toBe(true);
  });

  it('excludes To Do tickets already on staging', () => {
    expect(isToDo({ jiraStatus: 'To Do', pipelineState: 'staging' })).toBe(false);
  });
});

describe('matchesTicketFilter', () => {
  const tickets = [
    { key: 'A', jiraStatus: 'To Do', pipelineState: 'unmerged' },
    { key: 'B', jiraStatus: 'In Progress', pipelineState: 'unmerged' },
    { key: 'C', jiraStatus: 'In QA', pipelineState: 'staging' },
    { key: 'D', jiraStatus: 'Done', pipelineState: 'develop' },
  ];

  it('slices by to do, in progress, staging, and production', () => {
    expect(filterTickets(tickets, 'to_do').map((t) => t.key)).toEqual(['A']);
    expect(filterTickets(tickets, 'in_progress').map((t) => t.key)).toEqual(['B']);
    expect(filterTickets(tickets, 'staging').map((t) => t.key)).toEqual(['C']);
    expect(filterTickets(tickets, 'develop').map((t) => t.key)).toEqual(['D']);
  });

  it('returns everything for all', () => {
    expect(filterTickets(tickets, 'all')).toHaveLength(4);
    expect(matchesTicketFilter(tickets[0], 'all')).toBe(true);
  });
});
