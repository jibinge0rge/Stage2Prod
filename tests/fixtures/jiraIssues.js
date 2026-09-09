function makeIssue({ key, status, summary = 'Test summary', updated = '2026-04-20T14:00:00.000Z', assignee = null }) {
  return {
    key,
    fields: {
      summary,
      status: { name: status },
      assignee: assignee ? { displayName: assignee, avatarUrls: { '48x48': null } } : null,
      updated,
      sprint: null,
    },
  };
}

function searchResult(issues) {
  return { issues, total: issues.length };
}

module.exports = { makeIssue, searchResult };
