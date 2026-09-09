const { config } = require('../config');

function requireApiToken(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || token !== config.API_TOKEN) {
    return res.status(401).json({ error: 'unauthorized', message: 'valid Bearer API_TOKEN required' });
  }
  return next();
}

module.exports = { requireApiToken };
