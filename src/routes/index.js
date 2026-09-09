const express = require('express');
const { createHealthRouter } = require('./health');
const { createTicketsRouter } = require('./tickets');
const { createEventsRouter } = require('./events');
const { createBranchesRouter } = require('./branches');
const { createStagingRouter } = require('./staging');
const { createReposRouter } = require('./repos');
const { createGithubReposRouter } = require('./githubRepos');
const { createUntrackedRouter } = require('./untracked');

function mountRoutes(app, ctx) {
  const api = express.Router();
  api.use(createHealthRouter(ctx));
  api.use(createTicketsRouter(ctx));
  api.use(createEventsRouter(ctx));
  api.use(createBranchesRouter(ctx));
  api.use(createStagingRouter(ctx));
  api.use(createReposRouter(ctx));
  api.use(createGithubReposRouter(ctx));
  api.use(createUntrackedRouter(ctx));
  app.use('/api', api);
}

module.exports = { mountRoutes };
