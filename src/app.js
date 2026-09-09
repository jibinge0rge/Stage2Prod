const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const { mountRoutes } = require('./routes');
const { requestLogger } = require('./middleware/requestLogger');
const { errorHandler } = require('./middleware/errorHandler');

function createApp(ctx) {
  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use(requestLogger);

  mountRoutes(app, ctx);

  const webDist = path.join(__dirname, '..', 'web', 'dist');
  if (fs.existsSync(webDist)) {
    app.use(express.static(webDist));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api')) return next();
      res.sendFile(path.join(webDist, 'index.html'));
    });
  }

  app.use((req, res) => res.status(404).json({ error: 'not_found', message: `no route for ${req.method} ${req.path}` }));
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
