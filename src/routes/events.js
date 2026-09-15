const express = require('express');

function createEventsRouter({ eventsRepo }) {
  const router = express.Router();

  router.get('/events', async (req, res, next) => {
    try {
      const { ticketKey, outcome, since, repo } = req.query;
      const limit = Math.min(Number(req.query.limit) || 50, 500);
      const offset = Number(req.query.offset) || 0;
      const result = await eventsRepo.list({ ticketKey, outcome, since, repo, limit, offset });
      res.json({ ...result, limit, offset });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

module.exports = { createEventsRouter };
