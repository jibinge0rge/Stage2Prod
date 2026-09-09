const express = require('express');

function createEventsRouter({ eventsRepo }) {
  const router = express.Router();

  router.get('/events', (req, res) => {
    const { ticketKey, outcome, since, repo } = req.query;
    const limit = Math.min(Number(req.query.limit) || 50, 500);
    const offset = Number(req.query.offset) || 0;
    const result = eventsRepo.list({ ticketKey, outcome, since, repo, limit, offset });
    res.json({ ...result, limit, offset });
  });

  return router;
}

module.exports = { createEventsRouter };
