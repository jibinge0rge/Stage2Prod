export const ROUTES = [
  { path: '/', navKey: 'overview', title: 'Overview', subtitle: 'Jira transitions driving branch merges', icon: 'navbar-dashboard.svg', label: 'Overview', group: 'orchestration' },
  { path: '/pipeline', navKey: 'pipeline', title: 'Ticket pipeline', subtitle: 'Every ticket the orchestrator is tracking, and where its code sits', icon: 'navbar-campaign-progress.svg', label: 'Ticket pipeline', group: 'orchestration' },
  { path: '/staging', navKey: 'staging', title: 'Staging sandbox', subtitle: 'Ephemeral QA branch — safe to discard at any point', icon: 'navbar-workspace.svg', label: 'Staging sandbox', group: 'orchestration' },
  { path: '/log', navKey: 'log', title: 'Event log', subtitle: 'Append-only record of detected transitions and git writes', icon: 'navbar-history.svg', label: 'Event log', group: 'orchestration' },
  { path: '/untracked', navKey: 'untracked', title: 'Untracked changes', subtitle: "Open PRs and staging merges that don't reference any tracked ticket", icon: 'navbar-campaign-progress.svg', label: 'Untracked changes', group: 'orchestration' },
  { path: '/settings', navKey: 'settings', title: 'Rules & polling', subtitle: 'How Jira statuses map to merge actions, and how often Jira is checked', icon: 'navbar-remediation.svg', label: 'Rules & polling', group: 'configure' },
  { path: '/repos', navKey: 'repos', title: 'Repositories', subtitle: 'Which GitHub repos Stage2Prod watches and matches tickets against', icon: 'navbar-workspace.svg', label: 'Repositories', group: 'configure' },
];
