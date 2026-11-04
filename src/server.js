const app = require('./app');

if (process.env.NODE_ENV === 'production' && !process.env.SESSION_SECRET) {
  console.error('SESSION_SECRET must be set in production.');
  process.exit(1);
}

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => {
  console.log(`StockFlow running at http://localhost:${port}`);
});
